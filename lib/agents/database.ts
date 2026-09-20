import 'server-only'
import type { Db } from 'mongodb'
import { getMongoDatabase as connectedDatabase } from '@/lib/mongodb'

let indexes: Promise<void> | undefined

type IndexSpec = {
  collection: string
  key: Record<string, 1 | -1>
  name: string
  unique?: boolean
}

const indexSpecs: IndexSpec[] = [
  { collection: 'user_profiles', key: { profileVersionId: 1 }, name: 'profile_version_unique', unique: true },
  { collection: 'voice_profiles', key: { voiceProfileVersionId: 1 }, name: 'voice_profile_version_unique', unique: true },
  { collection: 'agent_messages', key: { encounterId: 1, sequence: 1 }, name: 'message_sequence_unique', unique: true },
  { collection: 'agent_reactions', key: { encounterId: 1, inputMessageId: 1, ownerUserId: 1 }, name: 'reaction_message_owner_unique', unique: true },
  { collection: 'agent_voice_prompts', key: { encounterId: 1, ownerUserId: 1 }, name: 'voice_prompt_owner_unique', unique: true },
  { collection: 'interpreter_adaptations', key: { userId: 1, version: -1 }, name: 'adaptation_user_version_unique', unique: true },
  { collection: 'interpreter_adaptations', key: { userId: 1, sourceEncounterId: 1 }, name: 'adaptation_source_encounter_unique', unique: true },
  { collection: 'conversation_encounters', key: { createdAt: -1, _id: -1 }, name: 'encounters_recent', },
]

function sameKey(left: Record<string, unknown> | undefined, right: Record<string, 1 | -1>) {
  if (!left) return false
  const leftEntries = Object.entries(left)
  const rightEntries = Object.entries(right)
  return leftEntries.length === rightEntries.length
    && rightEntries.every(([field, direction]) => left[field] === direction)
}

async function ensureIndex(database: Db, spec: IndexSpec) {
  const collection = database.collection(spec.collection)
  const existing = await collection.listIndexes().toArray().catch(error => {
    if (error && typeof error === 'object' && 'codeName' in error && error.codeName === 'NamespaceNotFound') return []
    throw error
  })
  const matching = existing.find(index => sameKey(index.key as Record<string, unknown> | undefined, spec.key))
  if (matching) {
    if (spec.unique && matching.unique !== true) {
      throw new Error(`Index ${spec.collection}.${spec.name} must be unique`)
    }
    return
  }
  await collection.createIndex(spec.key, { name: spec.name, ...(spec.unique ? { unique: true } : {}) })
}

export async function getMongoDatabase() {
  const database = await connectedDatabase()
  indexes ??= Promise.all(indexSpecs.map(spec => ensureIndex(database, spec)))
    .then(() => undefined)
    .catch(error => { indexes = undefined; throw error })
  await indexes
  return database
}
