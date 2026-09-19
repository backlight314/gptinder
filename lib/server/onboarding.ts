import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  draftSchema,
  questionSchema,
  shareableSchema,
  preferencesSchema,
  surveySchema,
  consentSchema,
  defaultPreferences,
  type User,
  type MeResponse,
} from '../domain'
import { scoreTipi } from '../scoring'
import { collections, transaction } from './db'
import { generateStructured, validateReferences } from './ai'
import { AppError, requireValue } from './errors'
import { styleSchema } from '../import-domain'

export const surveyInput = z.object({
  revision: z.number().int().min(0),
  survey: z.array(z.number().int().min(0).max(7)).length(10),
  preferences: preferencesSchema,
  consent: consentSchema,
  submit: z.boolean(),
})
export async function getMe(user: User): Promise<MeResponse> {
  const c = await collections()
  const [interview, profile, preferences, evidence, badges, style] =
    await Promise.all([
      c.interviews.findOne({ userId: user._id }),
      user.profileVersionId
        ? c.profiles.findOne({ _id: user.profileVersionId })
        : null,
      user.preferenceVersionId
        ? c.preferences.findOne({ _id: user.preferenceVersionId })
        : null,
      c.evidence.find({ userId: user._id }).limit(10).toArray(),
      c.badges
        .find(
          {
            userId: user._id,
            status: 'active',
            expiresAt: { $gt: new Date() },
          },
          {
            projection: {
              _id: 1,
              expiresAt: 1,
              status: 1,
              profileUrl: 1,
            },
          },
        )
        .toArray(),
      user.styleVersionId
        ? c.styles.findOne({
            _id: user.styleVersionId,
            invalidatedAt: { $exists: false },
          })
        : null,
    ])
  return {
    user: { _id: user._id, displayName: user.displayName, demo: user.demo },
    interview,
    profile,
    preferences,
    evidence,
    badges,
    style,
  }
}
export async function createInterview(userId: string) {
  const c = await collections()
  await c.interviews.updateOne(
    { userId },
    {
      $setOnInsert: {
        _id: randomUUID(),
        userId,
        revision: 0,
        stage: 'survey',
        survey: Array(10).fill(0),
        preferences: defaultPreferences(),
        answers: [],
        createdAt: new Date(),
      },
    },
    { upsert: true },
  )
}
export async function saveSurvey(
  userId: string,
  input: z.infer<typeof surveyInput>,
) {
  if (input.submit && !surveySchema.safeParse(input.survey).success)
    throw new AppError(400, 'Answer all ten survey items before continuing.')
  const c = await collections()
  await transaction(async (session) => {
    const result = await c.interviews.updateOne(
      { userId, revision: input.revision, stage: 'survey' },
      {
        $set: {
          survey: input.survey,
          preferences: input.preferences,
          stage: input.submit ? 'question_pending' : 'survey',
        },
        $inc: { revision: 1 },
      },
      { session },
    )
    if (!result.modifiedCount)
      throw new AppError(
        409,
        'Your interview changed. Reload the saved version before continuing.',
      )
    await c.consents.insertOne(
      {
        _id: randomUUID(),
        userId,
        flags: input.consent,
        createdAt: new Date(),
      },
      { session },
    )
  })
  return c.interviews.findOne({ userId })
}
export async function answerQuestion(
  userId: string,
  revision: number,
  text: string,
) {
  const c = await collections()
  const interview = requireValue(
    await c.interviews.findOne({ userId, revision, stage: 'answer_pending' }),
    'This question has already changed. Reload to continue.',
  )
  if (!interview.currentQuestion || interview.answers.length >= 5)
    throw new AppError(409, 'No question is awaiting an answer.')
  const result = await c.interviews.updateOne(
    { _id: interview._id, revision, stage: 'answer_pending' },
    {
      $push: {
        answers: {
          id: `answer_${interview.answers.length + 1}`,
          question: interview.currentQuestion,
          text,
        },
      },
      $set: {
        stage:
          interview.answers.length === 4 ? 'draft_pending' : 'question_pending',
      },
      $unset: { currentQuestion: '' },
      $inc: { revision: 1 },
    },
  )
  if (!result.modifiedCount)
    throw new AppError(
      409,
      'This answer was already saved. Reload to continue.',
    )
  return c.interviews.findOne({ userId })
}
export async function advanceInterview(userId: string) {
  const c = await collections()
  const leaseId = randomUUID()
  const now = new Date()
  const interview = await c.interviews.findOneAndUpdate(
    {
      userId,
      stage: { $in: ['question_pending', 'draft_pending'] },
      $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }],
    },
    { $set: { leaseId, leaseUntil: new Date(Date.now() + 60000) } },
    { returnDocument: 'after' },
  )
  if (!interview) return requireValue(await c.interviews.findOne({ userId }))
  try {
    const consent = requireValue(
      await c.consents.findOne({ userId }, { sort: { createdAt: -1 } }),
    )
    if (!consent.flags.aiProcessing)
      throw new AppError(403, 'AI processing consent is required.')
    const evidence = consent.flags.importedInformation
      ? await c.evidence.find({ userId, approved: true }).limit(10).toArray()
      : []
    const approvedClaims = consent.flags.importedInformation
      ? await c.claims.find({ userId, status: 'approved' }).limit(24).toArray()
      : []
    const approvedSources = consent.flags.importedInformation
      ? await c.imports.find({ userId, status: 'approved' }).limit(3).toArray()
      : []
    const references = [
      'survey',
      'preferences',
      ...interview.answers.map((a) => a.id),
      ...evidence.map((e) => e._id),
      ...approvedClaims.map((e) => e._id),
    ]
    const context = {
      survey: interview.survey,
      scores: scoreTipi(interview.survey),
      preferences: interview.preferences,
      answers: interview.answers,
      evidence: evidence.map((e) => ({
        id: e._id,
        source: e.source,
        excerpt: e.excerpt,
      })),
      approvedClaims: approvedClaims.map((e) => ({
        id: e._id,
        text: e.text,
        category: e.category,
      })),
      unresolvedImportQuestions: approvedSources.flatMap(
        (source) => source.draft?.uncertainty ?? [],
      ),
      remainingQuestions: 5 - interview.answers.length,
      allowedEvidenceIds: references,
    }
    const pendingQuestion = interview.stage === 'question_pending'
    if (pendingQuestion && interview.answers.length >= 5)
      throw new AppError(409, 'The five-question budget is exhausted.')
    const output = pendingQuestion
      ? await generateStructured(
          questionSchema,
          "Ask exactly one adaptive clarification, using earlier answers to avoid repetition. Distinguish the person's own style from what they want in a partner. Use only allowedEvidenceIds. This adds context and is not a validated adaptive personality test.",
          context,
        )
      : await generateStructured(
          draftSchema,
          'Draft a shareable profile grounded in the supplied evidence. Use only allowedEvidenceIds. Separate supported descriptions from unresolved questions. Features describe the person, never their desired partner; use null when unknown. Do not convert TIPI scores mechanically into dating features. Never infer numerical compatibility features from emoji, vocabulary, message length or stylistic claims. Professional facts, credentials and occupational status support conversation topics only, never personality or dating-feature inference. Omit raw excerpts, private facts and survey scores from the shareable summary.',
          context,
        )
    validateReferences(output.evidenceIds, references)
    await c.interviews.updateOne(
      { _id: interview._id, revision: interview.revision, leaseId },
      {
        $set: pendingQuestion
          ? {
              stage: 'answer_pending',
              currentQuestion: questionSchema.parse(output),
            }
          : { stage: 'review', draft: draftSchema.parse(output) },
        $unset: { leaseId: '', leaseUntil: '' },
        $inc: { revision: 1 },
      },
    )
    return c.interviews.findOne({ userId })
  } catch (error) {
    await c.interviews.updateOne(
      { _id: interview._id, leaseId },
      { $unset: { leaseId: '', leaseUntil: '' } },
    )
    throw error
  }
}
export const approvalInput = z.object({
  revision: z.number().int(),
  profile: shareableSchema,
  preferences: preferencesSchema,
  communicationStyle: styleSchema,
  avatarSeed: z.string().min(1).max(100),
  confirmed: z.literal(true),
})
export async function approveProfile(
  userId: string,
  input: z.infer<typeof approvalInput>,
) {
  const c = await collections()
  return transaction(async (session) => {
    const user = requireValue(
      await c.users.findOne({ _id: userId }, { session }),
    )
    const interview = requireValue(
      await c.interviews.findOne({ userId }, { session }),
    )
    if (interview.stage === 'approved' && user.profileVersionId)
      return { profileVersionId: user.profileVersionId }
    if (
      interview.revision !== input.revision ||
      interview.stage !== 'review' ||
      interview.answers.length !== 5
    )
      throw new AppError(
        409,
        'Finish the interview and reload your draft before approving.',
      )
    const profileVersionId = randomUUID()
    const preferenceVersionId = randomUUID()
    const lastProfile = await c.profiles.findOne(
      { userId },
      { sort: { version: -1 }, session },
    )
    const lastPreference = await c.preferences.findOne(
      { userId },
      { sort: { version: -1 }, session },
    )
    const currentStyle = user.styleVersionId
      ? requireValue(
          await c.styles.findOne(
            {
              _id: user.styleVersionId,
              userId,
              invalidatedAt: { $exists: false },
            },
            { session },
          ),
        )
      : null
    const lastStyle = await c.styles.findOne(
      { userId },
      { sort: { version: -1 }, session },
    )
    const styleVersionId = randomUUID()
    const approvedSources = await c.imports
      .find({ userId, status: 'approved' }, { session })
      .toArray()
    const sourceIds = approvedSources.map((source) => source._id)
    await c.styles.insertOne(
      {
        _id: styleVersionId,
        userId,
        version: (lastStyle?.version ?? 0) + 1,
        settings: input.communicationStyle,
        sourceIds,
        sampleIds: currentStyle?.sampleIds ?? [],
        ...(currentStyle?.approvedPreviewId
          ? { approvedPreviewId: currentStyle.approvedPreviewId }
          : {}),
        createdAt: new Date(),
      },
      { session },
    )
    for (const id of sourceIds) {
      if (
        !(
          await c.imports.updateOne(
            { _id: id, userId, status: 'approved' },
            { $inc: { revision: 1 } },
            { session },
          )
        ).modifiedCount
      )
        throw new AppError(
          409,
          'An imported source changed. Review your draft again.',
        )
    }
    const claims = await c.claims
      .find({ userId, sourceId: { $in: sourceIds } }, { session })
      .toArray()
    const approvedEvidence = await c.evidence
      .find({ userId, approved: true }, { session })
      .toArray()
    const approvedEvidenceIds = [
      ...claims.map((e) => e._id),
      ...approvedEvidence.map((e) => e._id),
    ]
    await c.profiles.insertOne(
      {
        _id: profileVersionId,
        userId,
        version: (lastProfile?.version ?? 0) + 1,
        shareable: input.profile,
        surveyScores: scoreTipi(interview.survey),
        approvedAt: new Date(),
        avatarSeed: input.avatarSeed,
        styleVersionId,
        approvedEvidenceIds,
        sourceIds,
      },
      { session },
    )
    await c.preferences.insertOne(
      {
        _id: preferenceVersionId,
        userId,
        version: (lastPreference?.version ?? 0) + 1,
        dimensions: input.preferences,
        ...(lastPreference ? { previousVersionId: lastPreference._id } : {}),
        createdAt: new Date(),
      },
      { session },
    )
    await c.users.updateOne(
      { _id: userId },
      { $set: { profileVersionId, preferenceVersionId, styleVersionId } },
      { session },
    )
    await c.interviews.updateOne(
      { _id: interview._id },
      { $set: { stage: 'approved' }, $inc: { revision: 1 } },
      { session },
    )
    return { profileVersionId }
  })
}
