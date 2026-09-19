import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  PREVIEW_SCENARIOS,
  previewTextSchema,
  type PreviewRecord,
} from '../import-domain'
import { scoreTipi } from '../scoring'
import { styleDistance, copiesPrivatePassage } from '../style-safety'
import { collections, transaction } from './db'
import { generateStructured } from './ai'
import { requireValue, AppError } from './errors'
import { auditStyleOutput, loadStyleContext, STYLE_INSTRUCTION } from './style'

export const previewInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('generate'),
    scenario: z.number().int().min(0).max(2),
  }),
  z.object({
    action: z.literal('review'),
    previewId: z.string().uuid(),
    choice: z.enum(['baseline', 'enhanced']),
    editedText: z.string().trim().min(1).max(1000),
    baselineResemblance: z.number().int().min(1).max(5),
    enhancedResemblance: z.number().int().min(1).max(5),
    attributionCorrect: z.boolean(),
    unsupportedClaims: z.number().int().min(0).max(20),
    disclosureOrCopying: z.boolean(),
  }),
])
export async function generatePreview(userId: string, scenarioIndex: number) {
  const c = await collections()
  const user = requireValue(await c.users.findOne({ _id: userId }))
  const interview = requireValue(await c.interviews.findOne({ userId }))
  if (interview.stage !== 'review')
    throw new AppError(
      409,
      'Finish the five questions to preview your draft before approval.',
    )
  const style = await loadStyleContext(userId, user.styleVersionId)
  const scenario = PREVIEW_SCENARIOS[scenarioIndex]
  const baselineContext = {
    surveyScores: scoreTipi(interview.survey),
    explicitPartnerPreferences: interview.preferences,
    scenario,
  }
  const enhancedContext = {
    ...baselineContext,
    personality: interview.draft?.summary,
    interests: style.approvedInterests,
    style: style.settings,
  }
  // Independent requests execute together, keeping this short preview within its route budget.
  const [baseline, enhanced] = await Promise.all([
    generateStructured(
      previewTextSchema,
      'Write a short first-person response to the scenario using survey context and explicit preferences only. Do not invent personal history.',
      baselineContext,
      { attempts: 1 },
    ),
    generateStructured(
      previewTextSchema,
      `Write a short first-person response to the scenario. ${STYLE_INSTRUCTION}`,
      { ...enhancedContext, privateWritingExamples: style.examples },
      { attempts: 1 },
    ),
  ])
  const [baseAudit, enhancedAudit] = await Promise.all([
    auditStyleOutput(baseline.text, baselineContext, style.privateTexts),
    auditStyleOutput(enhanced.text, enhancedContext, style.privateTexts),
  ])
  const preview: PreviewRecord = {
    _id: randomUUID(),
    userId,
    sourceIds: style.sourceIds,
    styleVersionId: user.styleVersionId ?? null,
    scenario,
    baseline: baseline.text,
    enhanced: enhanced.text,
    metrics: {
      baselineUnsupportedClaims: baseAudit.unsupportedClaims,
      enhancedUnsupportedClaims: enhancedAudit.unsupportedClaims,
      baselineDisclosures: baseAudit.disclosures,
      enhancedDisclosures: enhancedAudit.disclosures,
      baselineCopyDetected: baseAudit.copyDetected,
      enhancedCopyDetected: enhancedAudit.copyDetected,
      holdoutCount: style.holdout.length,
      holdoutStyleDistance: style.holdout.length
        ? {
            baseline: styleDistance(baseline.text, style.holdout)!,
            enhanced: styleDistance(enhanced.text, style.holdout)!,
          }
        : null,
      attribution: 'user-confirmed-self',
    },
    createdAt: new Date(),
  }
  // The owner may inspect a flagged candidate, but it cannot become an approved style example.
  await transaction(async (session) => {
    for (const id of style.sourceIds) {
      const active = await c.imports.updateOne(
        { _id: id, userId, status: 'approved' },
        { $inc: { revision: 1 } },
        { session },
      )
      if (!active.modifiedCount)
        throw new AppError(
          409,
          'An imported source changed. Generate a fresh preview.',
        )
    }
    await c.previews.insertOne(preview, { session })
  })
  return preview
}
export async function reviewPreview(
  userId: string,
  input: Extract<z.infer<typeof previewInput>, { action: 'review' }>,
) {
  const c = await collections()
  const preview = requireValue(
    await c.previews.findOne({
      _id: input.previewId,
      userId,
      invalidatedAt: { $exists: false },
    }),
  )
  if (preview.review) return { saved: true }
  const style = await loadStyleContext(
    userId,
    preview.styleVersionId ?? undefined,
  )
  if (copiesPrivatePassage(input.editedText, style.privateTexts))
    throw new AppError(
      400,
      'The edited response copies a private passage. Please paraphrase it.',
    )
  const review = {
    choice: input.choice,
    editedText: input.editedText,
    baselineResemblance: input.baselineResemblance,
    enhancedResemblance: input.enhancedResemblance,
    attributionCorrect: input.attributionCorrect,
    unsupportedClaims: input.unsupportedClaims,
    disclosureOrCopying: input.disclosureOrCopying,
  }
  return transaction(async (session) => {
    const user = requireValue(
      await c.users.findOne({ _id: userId }, { session }),
    )
    if (user.profileVersionId)
      throw new AppError(409, 'Review previews before approving your profile.')
    if ((user.styleVersionId ?? null) !== preview.styleVersionId)
      throw new AppError(
        409,
        'Your approved style changed. Generate a fresh preview.',
      )
    for (const id of preview.sourceIds) {
      if (
        !(
          await c.imports.updateOne(
            { _id: id, status: 'approved', userId },
            { $inc: { revision: 1 } },
            { session },
          )
        ).modifiedCount
      )
        throw new AppError(409, 'An imported source was deleted.')
    }
    const recorded = await c.previews.updateOne(
      {
        _id: preview._id,
        invalidatedAt: { $exists: false },
        review: { $exists: false },
      },
      { $set: { review } },
      { session },
    )
    if (!recorded.modifiedCount) return { saved: true }
    const chosenProblems =
      input.choice === 'enhanced'
        ? preview.metrics.enhancedUnsupportedClaims +
          preview.metrics.enhancedDisclosures +
          Number(preview.metrics.enhancedCopyDetected)
        : preview.metrics.baselineUnsupportedClaims +
          preview.metrics.baselineDisclosures +
          Number(preview.metrics.baselineCopyDetected)
    if (
      preview.styleVersionId &&
      input.attributionCorrect &&
      !input.disclosureOrCopying &&
      input.unsupportedClaims === 0 &&
      chosenProblems === 0
    ) {
      const current = requireValue(
        await c.styles.findOne(
          {
            _id: preview.styleVersionId,
            userId,
            invalidatedAt: { $exists: false },
          },
          { session },
        ),
      )
      const latest = await c.styles.findOne(
        { userId },
        { session, sort: { version: -1 } },
      )
      const id = randomUUID()
      await c.styles.insertOne(
        {
          ...current,
          _id: id,
          version: (latest?.version ?? 0) + 1,
          approvedPreviewId: preview._id,
          createdAt: new Date(),
        },
        { session },
      )
      await c.users.updateOne(
        { _id: userId },
        { $set: { styleVersionId: id } },
        { session },
      )
    }
    return { saved: true }
  })
}
