import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { lessonSchema, type PreferenceUpdate } from '../domain'
import { collections, transaction } from './db'
import { requireValue, AppError } from './errors'
import { requireEncounter } from './encounters'
import { generateStructured } from './ai'

export const feedbackInput = z.object({
  encounterId: z.string().uuid(),
  revision: z.number().int().min(0),
  outcome: z.enum(['positive', 'mixed', 'negative']),
  explanation: z.string().trim().min(1).max(3000),
})
export async function saveFeedback(
  userId: string,
  input: z.infer<typeof feedbackInput>,
) {
  const encounter = await requireEncounter(input.encounterId, userId)
  if (encounter.status !== 'complete')
    throw new AppError(
      409,
      'Wait for this encounter to complete before submitting feedback.',
    )
  const c = await collections()
  const id = `${input.encounterId}:${userId}`
  const now = new Date()
  if (input.revision === 0) {
    try {
      await c.feedback.insertOne({
        _id: id,
        encounterId: input.encounterId,
        authorId: userId,
        outcome: input.outcome,
        explanation: input.explanation,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      })
    } catch (error) {
      if (
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 11000
      )
        throw error
      const previous = requireValue(await c.feedback.findOne({ _id: id }))
      if (
        previous.explanation !== input.explanation ||
        previous.outcome !== input.outcome
      )
        throw new AppError(
          409,
          'Feedback already exists. Reload it before editing.',
        )
    }
  } else {
    const saved = await c.feedback.updateOne(
      { _id: id, authorId: userId, revision: input.revision },
      {
        $set: {
          outcome: input.outcome,
          explanation: input.explanation,
          updatedAt: now,
        },
        $inc: { revision: 1 },
      },
    )
    if (!saved.modifiedCount)
      throw new AppError(409, 'Feedback changed. Reload the latest revision.')
  }
  return c.feedback.findOne({ _id: id })
}
export async function analyzeFeedback(userId: string, feedbackId: string) {
  const c = await collections()
  const feedback = requireValue(
    await c.feedback.findOne({ _id: feedbackId, authorId: userId }),
  )
  const existing = await c.updates.findOne({
    feedbackId,
    feedbackRevision: feedback.revision,
  })
  if (existing) return existing
  const user = requireValue(await c.users.findOne({ _id: userId }))
  const preference = requireValue(
    await c.preferences.findOne({ _id: user.preferenceVersionId, userId }),
  )
  const lesson =
    feedback.explanation.trim().split(/\s+/).length < 4
      ? lessonSchema.parse({
          decision: 'clarify',
          explanation:
            'There is not enough detail to identify a preference lesson.',
          clarification:
            'What specifically worked or felt uncomfortable, and what would you want next time?',
          dimension: null,
          desired: null,
          importance: null,
          supportingQuote: null,
        })
      : await generateStructured(
          lessonSchema,
          "Analyze only the author's feedback and their explicit partner preferences. A negative outcome alone never supports a change. Ask a concrete clarification for vague feedback. Propose at most one specific feature change supported by a verbatim supportingQuote from the explanation. Do not rewrite personality. Keep desired null unless an explicit direction is supported (null means unchanged). Keep importance null unless supported (null means unchanged). If an already-known preference is reinforced, propose one small importance increment, usually +1 capped at 5; do not change desired as well without explicit evidence. Use no_change if no supported lesson exists.",
          {
            feedback: {
              outcome: feedback.outcome,
              explanation: feedback.explanation,
            },
            preferences: preference.dimensions,
          },
        )
  if (lesson.decision === 'propose') {
    if (
      !lesson.dimension ||
      !lesson.supportingQuote ||
      !feedback.explanation.includes(lesson.supportingQuote) ||
      (lesson.desired === null && lesson.importance === null)
    )
      throw new AppError(
        503,
        'The preference proposal was not sufficiently grounded. Retry analysis.',
      )
    const current = preference.dimensions[lesson.dimension]
    if (
      (lesson.desired === null || lesson.desired === current.desired) &&
      (lesson.importance === null || lesson.importance === current.importance)
    ) {
      lesson.decision = 'no_change'
      lesson.explanation =
        'Your current preferences already reflect this lesson.'
    }
  }
  if (lesson.decision === 'clarify' && !lesson.clarification)
    lesson.clarification =
      'What would you prefer to be different on your next date?'
  const update: PreferenceUpdate = {
    _id: randomUUID(),
    userId,
    feedbackId,
    feedbackRevision: feedback.revision,
    expectedVersionId: preference._id,
    lesson,
    status: lesson.decision === 'propose' ? 'proposed' : lesson.decision,
    createdAt: new Date(),
  }
  await c.updates.updateOne(
    { feedbackId, feedbackRevision: feedback.revision },
    { $setOnInsert: update },
    { upsert: true },
  )
  return c.updates.findOne({ feedbackId, feedbackRevision: feedback.revision })
}
export async function confirmPreferenceUpdate(
  userId: string,
  updateId: string,
) {
  const c = await collections()
  return transaction(async (session) => {
    const update = requireValue(
      await c.updates.findOne({ _id: updateId, userId }, { session }),
    )
    if (update.status === 'applied')
      return { preferenceVersionId: update.resultingVersionId }
    const user = requireValue(
      await c.users.findOne({ _id: userId }, { session }),
    )
    const feedback = requireValue(
      await c.feedback.findOne(
        { _id: update.feedbackId, authorId: userId },
        { session },
      ),
    )
    if (update.status !== 'proposed' || !update.lesson.dimension)
      throw new AppError(409, 'There is no proposed change to confirm.')
    if (
      feedback.revision !== update.feedbackRevision ||
      user.preferenceVersionId !== update.expectedVersionId
    )
      throw new AppError(
        409,
        'Feedback or preferences changed. Submit a revised explanation to obtain a fresh proposal.',
      )
    const previous = requireValue(
      await c.preferences.findOne(
        { _id: update.expectedVersionId, userId },
        { session },
      ),
    )
    const dimensions = structuredClone(previous.dimensions)
    const dimension = dimensions[update.lesson.dimension]
    if (update.lesson.desired !== null)
      dimension.desired = update.lesson.desired
    if (update.lesson.importance !== null)
      dimension.importance = update.lesson.importance
    const id = randomUUID()
    await c.preferences.insertOne(
      {
        _id: id,
        userId,
        version: previous.version + 1,
        dimensions,
        previousVersionId: previous._id,
        sourceFeedbackId: feedback._id,
        createdAt: new Date(),
      },
      { session },
    )
    const changed = await c.users.updateOne(
      { _id: userId, preferenceVersionId: previous._id },
      { $set: { preferenceVersionId: id } },
      { session },
    )
    if (!changed.modifiedCount)
      throw new AppError(
        409,
        'Your preferences changed. Refresh before confirming.',
      )
    await c.updates.updateOne(
      { _id: updateId, status: 'proposed' },
      { $set: { status: 'applied', resultingVersionId: id } },
      { session },
    )
    return { preferenceVersionId: id }
  })
}
export async function revertPreferences(
  userId: string,
  targetId: string,
  expectedId: string,
) {
  const c = await collections()
  return transaction(async (session) => {
    const user = requireValue(
      await c.users.findOne({ _id: userId }, { session }),
    )
    if (user.preferenceVersionId !== expectedId)
      throw new AppError(409, 'Preferences changed. Reload before reverting.')
    const target = requireValue(
      await c.preferences.findOne({ _id: targetId, userId }, { session }),
    )
    const current = requireValue(
      await c.preferences.findOne({ _id: expectedId, userId }, { session }),
    )
    const id = randomUUID()
    await c.preferences.insertOne(
      {
        _id: id,
        userId,
        version: current.version + 1,
        dimensions: target.dimensions,
        previousVersionId: current._id,
        createdAt: new Date(),
      },
      { session },
    )
    await c.users.updateOne(
      { _id: userId, preferenceVersionId: expectedId },
      { $set: { preferenceVersionId: id } },
      { session },
    )
    return { preferenceVersionId: id }
  })
}
