import 'server-only'

import { getMongoDatabase } from '@/lib/agents/database'
import type { EncounterParticipant } from '@/lib/encounters/store'
import type { FrozenProfile, PersonKey } from '@/lib/psychology/schemas'
import { storedAdaptationSchema, type DateOutcome, type StoredAdaptation } from './schemas'

type StringIdDocument = { _id: string; [key: string]: any }

export const ADAPTATION_PROMPT_VERSION = 'reaction-adaptation-v1'

function feedbackId(encounterId: string) {
  return `${encounterId}:feedback`
}

export async function recordEncounterFeedback(encounterId: string, outcome: DateOutcome) {
  const database = await getMongoDatabase()
  const encounter = await database.collection<StringIdDocument>('conversation_encounters').findOne({ _id: encounterId })
  if (!encounter) throw new Error('Encounter not found')
  if (encounter.status !== 'complete') throw new Error('The conversation is not complete yet')
  const existing = await database.collection<StringIdDocument>('encounter_feedback').findOne({ _id: feedbackId(encounterId) })
  if (existing) return { recorded: false, outcome: existing.outcome as DateOutcome, status: existing.status as string }
  try { await database.collection<StringIdDocument>('encounter_feedback').insertOne({
    _id: feedbackId(encounterId), encounterId, metInPerson: true, outcome,
    status: 'pending', reportedAt: new Date(),
  })
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error
    return recordEncounterFeedback(encounterId, outcome)
  }
  return { recorded: true, outcome, status: 'pending' }
}

export async function claimFeedback(encounterId: string, workflowRunId: string) {
  const database = await getMongoDatabase()
  return Boolean(await database.collection<StringIdDocument>('encounter_feedback').findOneAndUpdate(
    { _id: feedbackId(encounterId), $or: [{ status: { $in: ['pending', 'failed'] } }, { status: 'learning', workflowRunId }] },
    { $set: { status: 'learning', workflowRunId, updatedAt: new Date() } },
    { returnDocument: 'after' },
  ))
}

export async function settleFeedback(encounterId: string, status: 'applied' | 'failed', error?: string) {
  const database = await getMongoDatabase()
  await database.collection<StringIdDocument>('encounter_feedback').updateOne(
    { _id: feedbackId(encounterId) },
    { $set: { status, error: error ?? null, updatedAt: new Date() } },
  )
}

export async function loadFeedbackContext(encounterId: string) {
  const database = await getMongoDatabase()
  const [encounter, feedback] = await Promise.all([
    database.collection<StringIdDocument>('conversation_encounters').findOne({ _id: encounterId }),
    database.collection<StringIdDocument>('encounter_feedback').findOne({ _id: feedbackId(encounterId) }),
  ])
  if (!encounter) throw new Error('Encounter not found')
  if (!feedback) throw new Error('Feedback was not recorded')
  const messages = await database.collection<StringIdDocument>('agent_messages').find({ encounterId }).sort({ sequence: 1 }).project({
    _id: 1, sequence: 1, speakerUserId: 1, speakerKey: 1, action: 1, text: 1,
  }).toArray()
  const reactions = await database.collection<StringIdDocument>('agent_reactions').find({ encounterId }).sort({ createdAt: 1 }).project({
    _id: 1, ownerUserId: 1, inputMessageId: 1, interpretation: 1,
  }).toArray()
  // Learning needs the frozen psychology profile only, so an encounter stored before later features can still be reported on.
  const participants = encounter.participants as EncounterParticipant[]
  const profileDocuments = await database.collection('user_profiles').find({
    profileVersionId: { $in: participants.map(participant => participant.profileVersionId) },
  }).toArray()
  const profiles = Object.fromEntries(participants.map(participant => {
    const profile = profileDocuments.find(item => item.profileVersionId === participant.profileVersionId)
    if (!profile) throw new Error(`Frozen profile missing for ${participant.userId}`)
    const { _id, createdAt, ...data } = profile
    void _id
    void createdAt
    return [participant.key, data as FrozenProfile]
  })) as Record<PersonKey, FrozenProfile>
  return {
    participants,
    outcome: feedback.outcome as DateOutcome,
    messages, reactions, profiles,
  }
}

export async function latestAdaptation(userId: string): Promise<StoredAdaptation | null> {
  const database = await getMongoDatabase()
  const document = await database.collection<StringIdDocument>('interpreter_adaptations')
    .find({ userId }).sort({ version: -1 }).limit(1).next()
  if (!document) return null
  const parsed = storedAdaptationSchema.safeParse(document)
  return parsed.success ? parsed.data : null
}

export async function adaptationForEncounter(userId: string, encounterId: string) {
  const database = await getMongoDatabase()
  return database.collection('interpreter_adaptations').findOne({ userId, sourceEncounterId: encounterId })
}

export async function adaptationByVersionId(adaptationVersionId: string): Promise<StoredAdaptation | null> {
  const database = await getMongoDatabase()
  const document = await database.collection<StringIdDocument>('interpreter_adaptations').findOne({ adaptationVersionId })
  if (!document) return null
  const parsed = storedAdaptationSchema.safeParse(document)
  return parsed.success ? parsed.data : null
}

export async function saveAdaptation(encounterId: string, adaptation: StoredAdaptation, model?: string) {
  const database = await getMongoDatabase()
  // A unique version key detects concurrent writers; a workflow retry re-reads the latest version.
  // https://www.mongodb.com/docs/manual/core/write-operations-atomicity/
  await database.collection<StringIdDocument>('interpreter_adaptations').updateOne(
    { _id: adaptation.adaptationVersionId, sourceEncounterId: encounterId },
    { $setOnInsert: {
      _id: adaptation.adaptationVersionId, ...adaptation, sourceEncounterId: encounterId,
      model: model || process.env.OPENAI_REACTION_MODEL || process.env.OPENAI_MODEL || process.env.OPENAI_MODEL_A || 'gpt-5.6-luna',
      promptVersion: ADAPTATION_PROMPT_VERSION, createdAt: new Date(),
    } },
    { upsert: true },
  )
  return adaptation.adaptationVersionId
}

export async function listEncounters(limit: number, offset = 0) {
  const database = await getMongoDatabase()
  const encounters = await database.collection<StringIdDocument>('conversation_encounters')
    .find({}).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit)
    .project({ _id: 1, status: 1, participants: 1, createdAt: 1, compatibility: 1 })
    .toArray()
  const encounterIds = encounters.map(encounter => encounter._id)
  const [counts, feedback] = await Promise.all([
    database.collection<StringIdDocument>('agent_messages').aggregate([
      { $match: { encounterId: { $in: encounterIds } } },
      { $group: { _id: '$encounterId', messageCount: { $sum: 1 } } },
    ]).toArray(),
    database.collection<StringIdDocument>('encounter_feedback').find({ encounterId: { $in: encounterIds } }).toArray(),
  ])
  const countByEncounter = new Map(counts.map(item => [item._id, item.messageCount as number]))
  const feedbackByEncounter = new Map(feedback.map(item => [item.encounterId as string, item]))
  return encounters.map(encounter => {
    const stored = feedbackByEncounter.get(encounter._id)
    return {
      encounterId: encounter._id,
      status: encounter.status as string,
      createdAt: (encounter.createdAt as Date | undefined)?.toISOString() ?? null,
      participants: (encounter.participants as EncounterParticipant[]).map(({ key, userId, name }) => ({ key, userId, name })),
      messageCount: countByEncounter.get(encounter._id) ?? 0,
      compatibility: encounter.compatibility ? { label: encounter.compatibility.label, score: encounter.compatibility.score } : null,
      feedback: stored ? { outcome: stored.outcome as DateOutcome, status: stored.status as string } : null,
    }
  })
}
