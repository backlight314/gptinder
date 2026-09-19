import 'server-only'
import { collections, transaction } from './db'
import { requireValue, AppError } from './errors'
import { generateStructured, validateReferences } from './ai'
import { turnSchema, explanationSchema, type MatchResult } from '../domain'
import { ALGORITHM_VERSION, scoreCompatibility } from '../scoring'
import { loadStyleContext, auditStyleOutput, STYLE_INSTRUCTION } from './style'

export const DATE_SCENARIO =
  'Plan a first Saturday afternoon date. Discuss the activity, social setting, and how much advance planning you each prefer.'
export async function claimEncounter(encounterId: string, runId: string) {
  const c = await collections()
  return Boolean(
    await c.encounters.findOneAndUpdate(
      {
        _id: encounterId,
        $or: [
          { status: 'pending_start', workflowRunId: { $exists: false } },
          { status: 'running', workflowRunId: runId },
        ],
      },
      {
        $set: { status: 'running', workflowRunId: runId },
        $unset: { error: '', dispatchLeaseUntil: '' },
      },
      { returnDocument: 'after' },
    ),
  )
}
async function inputs(encounterId: string, runId: string) {
  const c = await collections()
  const encounter = requireValue(
    await c.encounters.findOne({
      _id: encounterId,
      workflowRunId: runId,
      status: 'running',
    }),
  )
  const profiles = []
  const preferences = []
  for (const p of encounter.participants) {
    const profile = requireValue(
      await c.profiles.findOne({
        _id: p.profileVersionId,
        userId: p.userId,
        invalidatedAt: { $exists: false },
      }),
    )
    profiles.push({
      id: profile._id,
      userId: p.userId,
      name: p.name,
      styleVersionId: profile.styleVersionId,
      ...profile.shareable,
    })
    preferences.push(
      requireValue(
        await c.preferences.findOne({
          _id: p.preferenceVersionId,
          userId: p.userId,
        }),
      ),
    )
  }
  return { c, encounter, profiles, preferences }
}
export async function persistTurn(
  encounterId: string,
  runId: string,
  turnNumber: number,
) {
  if (!Number.isInteger(turnNumber) || turnNumber < 1 || turnNumber > 6)
    throw new AppError(400, 'Invalid turn.')
  const { c, encounter, profiles, preferences } = await inputs(
    encounterId,
    runId,
  )
  if (await c.messages.findOne({ encounterId, turnNumber })) return
  const transcript = await c.messages
    .find({ encounterId, turnNumber: { $lt: turnNumber } })
    .sort({ turnNumber: 1 })
    .toArray()
  if (transcript.length !== turnNumber - 1)
    throw new AppError(409, 'Earlier conversation turns are missing.')
  const speaker = (turnNumber - 1) % 2
  const allowed = profiles.map((p) => p.id)
  const style = await loadStyleContext(
    profiles[speaker].userId,
    profiles[speaker].styleVersionId,
  )
  const approvedContext = {
    scenario: DATE_SCENARIO,
    speaker: profiles[speaker],
    partner: profiles[1 - speaker],
    explicitPartnerPreferences: preferences[speaker].dimensions,
    approvedInterests: style.approvedInterests,
  }
  const output = await generateStructured(
    turnSchema,
    `Represent only the assigned speaker, in first person. Choose propose, clarify, agree or disagree. Ground the turn in approved shareable context and dialogue. Use at least one allowed profile ID as evidenceIds. Do not invent an actual date outcome. ${STYLE_INSTRUCTION}`,
    {
      ...approvedContext,
      communicationStyle: style.settings,
      privateWritingExamples: style.examples,
      transcript: transcript.map((t) => ({ speaker: t.speaker, text: t.text })),
      turnNumber,
      totalTurns: 6,
      allowedEvidenceIds: allowed,
    },
  )
  validateReferences(output.evidenceIds, allowed)
  if (!output.evidenceIds.length)
    throw new AppError(503, 'A grounded turn needs a profile reference.')
  if (style.privateTexts.length) {
    const audit = await auditStyleOutput(
      output.text,
      approvedContext,
      style.privateTexts,
    )
    if (audit.copyDetected || audit.disclosures || audit.unsupportedClaims)
      throw new AppError(
        503,
        'Generated response did not pass the private-sample review.',
      )
  }
  await transaction(async (session) => {
    const current = requireValue(
      await c.encounters.findOne(
        { _id: encounterId, workflowRunId: runId, status: 'running' },
        { session },
      ),
    )
    if (
      await c.profiles.countDocuments(
        {
          _id: { $in: current.participants.map((p) => p.profileVersionId) },
          invalidatedAt: { $exists: true },
        },
        { session },
      )
    )
      throw new AppError(409, 'An imported source was deleted.')
    // Touch the encounter to serialize against source-deletion invalidation.
    await c.encounters.updateOne(
      { _id: encounterId },
      { $set: { dispatchLeaseUntil: new Date() } },
      { session },
    )
    await c.messages.updateOne(
      { encounterId, turnNumber },
      {
        $setOnInsert: {
          _id: `${encounterId}:${turnNumber}`,
          encounterId,
          turnNumber,
          speaker: encounter.participants[speaker].userId,
          ...output,
          createdAt: new Date(),
        },
      },
      { upsert: true, session },
    )
  })
}
export async function finishEncounter(encounterId: string, runId: string) {
  if (
    await (
      await collections()
    ).encounters.findOne({
      _id: encounterId,
      workflowRunId: runId,
      status: 'complete',
    })
  )
    return
  const { c, encounter, profiles, preferences } = await inputs(
    encounterId,
    runId,
  )
  if (!(await c.results.findOne({ encounterId }))) {
    const transcript = await c.messages
      .find({ encounterId })
      .sort({ turnNumber: 1 })
      .toArray()
    if (transcript.length !== 6)
      throw new AppError(409, 'All six turns must exist before scoring.')
    const directions = Object.fromEntries(
      encounter.participants.map((p, i) => [
        p.userId,
        scoreCompatibility(preferences[i].dimensions, profiles[1 - i].features),
      ]),
    )
    // Explanations see numerical fits and approved text, never raw survey/evidence.
    const explanations = await generateStructured(
      explanationSchema,
      'Explain strengths and possible friction from the supplied deterministic feature fits and approved conversation. Do not recalculate scores or claim probability of relationship success. Name uncertainty and missing coverage. Do not fabricate shared interests.',
      {
        profiles,
        directions,
        transcript: transcript.map((t) => ({
          speaker: t.speaker,
          text: t.text,
        })),
      },
    )
    const result: MatchResult = {
      _id: encounterId,
      encounterId,
      algorithmVersion: ALGORITHM_VERSION,
      inputVersions: encounter.participants,
      directions,
      explanations,
      createdAt: new Date(),
    }
    await transaction(async (session) => {
      const active = await c.encounters.findOne(
        { _id: encounterId, workflowRunId: runId, status: 'running' },
        { session },
      )
      if (!active) throw new AppError(409, 'Encounter was invalidated.')
      await c.encounters.updateOne(
        { _id: encounterId },
        { $set: { dispatchLeaseUntil: new Date() } },
        { session },
      )
      await c.results.updateOne(
        { encounterId },
        { $setOnInsert: result },
        { upsert: true, session },
      )
    })
  }
  await c.encounters.updateOne(
    { _id: encounterId, workflowRunId: runId, status: 'running' },
    { $set: { status: 'complete', completedAt: new Date() } },
  )
}
export async function failEncounter(encounterId: string, runId: string) {
  await (
    await collections()
  ).encounters.updateOne(
    { _id: encounterId, workflowRunId: runId, status: 'running' },
    {
      $set: {
        status: 'failed',
        error:
          'The conversation could not finish after retries. You can retry from the saved turns.',
      },
    },
  )
}
