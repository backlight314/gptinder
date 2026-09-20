import 'server-only'

import { retrievePersonaContext } from '@/lib/agents/retrieval'
import { randomUUID } from 'node:crypto'
import { getMongoDatabase } from '@/lib/agents/database'
import { buildFrozenProfile } from '@/lib/psychology/profile'
import { manualPersonaSchema, type FrozenProfile, type PersonKey, type SocialInterpretation } from '@/lib/psychology/schemas'
import { adaptationByVersionId, latestAdaptation } from '@/lib/learning/store'
import type { StoredAdaptation } from '@/lib/learning/schemas'
import { snapshotRequiredAgentContext } from '@/lib/agent-contexts/store'
import type { AgentContextSnapshot } from '@/lib/agent-contexts/schemas'

export const DEFAULT_SCENARIO = 'Plan a first Saturday afternoon date while discussing the activity, social setting, communication style, and advance planning.'

export type EncounterParticipant = {
  key: PersonKey
  userId: string
  name: string
  profileVersionId: string
  adaptationVersionId: string | null
  agentContextRevision: number
}
type StringIdDocument = { _id: string; [key: string]: any }

export async function createEncounter(input: {
  participants: Record<PersonKey, { userId: string }>
  turns: number
}) {
  const database = await getMongoDatabase()
  const encounterId = `enc_${randomUUID()}`
  const personas = await Promise.all((['a', 'b'] as const).map(async key => {
    const document = await database.collection('personas').findOne(
      { userId: input.participants[key].userId, slot: key },
      { projection: { _id: 0, name: 1, bio: 1, traits: 1, interests: 1, style: 1, values: 1, lifeGoals: 1, relationshipPreferences: 1 } },
    )
    const parsed = manualPersonaSchema.safeParse(document)
    if (!parsed.success) throw new Error(`Approved persona missing for participant ${key}`)
    return parsed.data
  }))
  const profiles = (['a', 'b'] as const).map((key, index) => buildFrozenProfile(input.participants[key].userId, personas[index]))
  const accountContextEntries = await Promise.all((['a', 'b'] as const).map(async (key) => [
    key,
    await snapshotRequiredAgentContext(input.participants[key].userId, database),
  ] as const))
  const accountContexts = Object.fromEntries(accountContextEntries) as Record<PersonKey, AgentContextSnapshot>
  await Promise.all(profiles.map(profile => database.collection('user_profiles').updateOne(
      { profileVersionId: profile.profileVersionId },
      { $setOnInsert: { ...profile, createdAt: new Date() } },
      { upsert: true },
    )))
  const retrievedContext = Object.fromEntries(await Promise.all((['a', 'b'] as const).map(async (key, index) => [key, await retrievePersonaContext(key, personas[index])])))
  // The learned weighting is frozen with the profiles so a running encounter cannot change mid conversation.
  const adaptations = await Promise.all(profiles.map(profile => latestAdaptation(profile.userId)))
  const participants: EncounterParticipant[] = profiles.map((profile, index) => ({
    key: index === 0 ? 'a' : 'b', userId: profile.userId, name: profile.name,
    profileVersionId: profile.profileVersionId,
    adaptationVersionId: adaptations[index]?.adaptationVersionId ?? null,
    agentContextRevision: accountContexts[index === 0 ? 'a' : 'b'].revision,
  }))
  await database.collection<StringIdDocument>('conversation_encounters').insertOne({
    _id: encounterId, status: 'pending_start', scenario: DEFAULT_SCENARIO,
    turns: input.turns, participants, accountContexts, retrievedContext, temporaryState: { a: null, b: null }, createdAt: new Date(),
  })
  return encounterId
}

export async function loadEncounter(encounterId: string) {
  const database = await getMongoDatabase()
  const encounter = await database.collection<StringIdDocument>('conversation_encounters').findOne({ _id: encounterId })
  if (!encounter) throw new Error('Encounter not found')
  const profileDocuments = await database.collection('user_profiles').find({
    profileVersionId: { $in: encounter.participants.map((item: EncounterParticipant) => item.profileVersionId) },
  }).toArray()
  const profiles = Object.fromEntries(encounter.participants.map((participant: EncounterParticipant) => {
    const profile = profileDocuments.find(item => item.profileVersionId === participant.profileVersionId)
    if (!profile) throw new Error(`Frozen profile missing for ${participant.userId}`)
    const { _id, createdAt, ...data } = profile
    void _id
    void createdAt
    return [participant.key, data as FrozenProfile]
  })) as Record<PersonKey, FrozenProfile>
  const accountContexts = encounter.accountContexts as Record<PersonKey, AgentContextSnapshot> | undefined
  for (const key of ['a', 'b'] as const) {
    const context = accountContexts?.[key]
    if (!context || !Number.isInteger(context.revision) || context.revision < 0 || typeof context.compiledPrompt !== 'string' || !context.compiledPrompt.trim())
      throw new Error(`Frozen agent context missing for participant ${key}`)
  }
  const adaptationEntries = await Promise.all(encounter.participants.map(async (participant: EncounterParticipant) => {
    const adaptation = participant.adaptationVersionId ? await adaptationByVersionId(participant.adaptationVersionId) : null
    return [participant.key, adaptation] as const
  }))
  const adaptations = Object.fromEntries(adaptationEntries) as Record<PersonKey, StoredAdaptation | null>
  return { database, encounter, profiles, accountContexts: accountContexts as Record<PersonKey, AgentContextSnapshot>, adaptations }
}

export async function claimEncounter(encounterId: string, workflowRunId: string) {
  const database = await getMongoDatabase()
  return Boolean(await database.collection<StringIdDocument>('conversation_encounters').findOneAndUpdate(
    { _id: encounterId, $or: [{ status: 'pending_start' }, { status: 'running', workflowRunId }] },
    { $set: { status: 'running', workflowRunId, updatedAt: new Date() } },
    { returnDocument: 'after' },
  ))
}

export async function saveReaction(input: {
  encounterId: string
  ownerUserId: string
  inputMessageId: string
  profileVersionId: string
  adaptationVersionId: string | null
  interpretation: SocialInterpretation
  model: string
}) {
  const database = await getMongoDatabase()
  const promptVersion = 'social-interpreter-v2'
  const reactionId = `${input.encounterId}:reaction:${input.inputMessageId}:${input.ownerUserId}`
  await database.collection<StringIdDocument>('agent_reactions').updateOne(
    { encounterId: input.encounterId, inputMessageId: input.inputMessageId, ownerUserId: input.ownerUserId, promptVersion },
    { $setOnInsert: {
      _id: reactionId, ...input, fourLensAnalysis: input.interpretation.fourLensAnalysis,
      temporaryState: input.interpretation.temporaryState,
      model: input.model, promptVersion, createdAt: new Date(),
    } },
    { upsert: true },
  )
  return reactionId
}

export async function saveMessage(input: {
  encounterId: string
  sequence: number
  speakerUserId: string
  speakerKey: PersonKey
  reactionId: string | null
  agentContextRevision: number
  action: string
  text: string
  profileEvidenceIds: string[]
  reactionEvidenceIds: string[]
  lensUsage: unknown
  model: string
}) {
  const database = await getMongoDatabase()
  const messageId = `${input.encounterId}:message:${input.sequence}`
  await database.collection<StringIdDocument>('agent_messages').updateOne(
    { encounterId: input.encounterId, sequence: input.sequence },
    { $setOnInsert: { _id: messageId, ...input, promptVersion: 'persona-speaker-v2', createdAt: new Date() } },
    { upsert: true },
  )
  return messageId
}
