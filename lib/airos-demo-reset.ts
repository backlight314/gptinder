import 'server-only'

import { getMongoDatabase } from '@/lib/mongodb'

const AIROS_COLLECTIONS = [
  'airos_connections',
  'airos_profile_observations',
  'airos_imports',
  'airos_profile_analyses',
  'airos_rate_limits',
  'airos_profiles',
] as const

export async function resetAirosDemoData() {
  const database = await getMongoDatabase()
  const userIds = (await database.collection<{ userId?: string }>('airos_profiles')
    .find({ userId: { $type: 'string' } }, { projection: { _id: 0, userId: 1 } })
    .toArray())
    .map((profile) => profile.userId)
    .filter((userId): userId is string => Boolean(userId))

  const deleted: Record<string, number> = {}
  if (userIds.length) {
    // Keep the provider profile documents: they contain the cached profile
    // photos and are safe to reuse when the same badge is imported for the
    // next demo. Posts, messages, and generated text are still demo data.
    for (const collection of ['social_comments', 'social_posts', 'discord_messages', 'whatsapp_messages', 'user_text_samples']) {
      deleted[collection] = (await database.collection(collection).deleteMany({ userId: { $in: userIds } })).deletedCount
    }
    deleted.users = (await database.collection<{ _id: string }>('users').deleteMany({ _id: { $in: userIds } })).deletedCount
  }

  for (const collection of AIROS_COLLECTIONS) {
    deleted[collection] = (await database.collection(collection).deleteMany({})).deletedCount
  }

  return { deleted, profileUserCount: userIds.length }
}
