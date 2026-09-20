import 'server-only'
import { getMongoDatabase as connectedDatabase } from '@/lib/mongodb'

let indexes: Promise<void> | undefined

export async function getMongoDatabase() {
  const database = await connectedDatabase()
  indexes ??= Promise.all([
    database.collection('user_profiles').createIndex({ profileVersionId: 1 }, { unique: true }),
    database.collection('agent_messages').createIndex({ encounterId: 1, sequence: 1 }, { unique: true }),
    database.collection('agent_reactions').createIndex({ encounterId: 1, inputMessageId: 1, ownerUserId: 1 }, { unique: true }),
    database.collection('interpreter_adaptations').createIndex({ userId: 1, version: -1 }, { unique: true }),
    database.collection('interpreter_adaptations').createIndex({ userId: 1, sourceEncounterId: 1 }, { unique: true }),
    database.collection('conversation_encounters').createIndex({ createdAt: -1, _id: -1 }),
  ]).then(() => undefined).catch(error => { indexes = undefined; throw error })
  await indexes
  return database
}
