import 'server-only'

import type { Db, MongoClient } from 'mongodb'
import { getClient } from './server/db'
import { databaseEnv } from './server/env'

const indexPromises = new WeakMap<MongoClient, Map<string, Promise<void>>>()

export async function getMongoDatabase(): Promise<Db> {
  const client = await getClient()
  const database = client.db(databaseEnv().MONGODB_DB)
  let byDatabase = indexPromises.get(client)
  if (!byDatabase) {
    byDatabase = new Map()
    indexPromises.set(client, byDatabase)
  }
  let pending = byDatabase.get(database.databaseName)
  if (!pending) {
    pending = Promise.all([
      database
        .collection('social_profiles')
        .createIndex(
          { platform: 1, handle: 1 },
          { unique: true, name: 'platform_handle_unique' },
        ),
      database
        .collection('social_posts')
        .createIndex(
          { profileId: 1, externalId: 1 },
          { unique: true, name: 'profile_post_unique' },
        ),
      database
        .collection('social_posts')
        .createIndex(
          { profileId: 1, publishedAt: -1 },
          { name: 'profile_posts_recent' },
        ),
      database
        .collection('social_comments')
        .createIndex(
          { profileId: 1, postExternalId: 1, externalId: 1 },
          { unique: true, name: 'profile_post_comment_unique' },
        ),
      database
        .collection('social_profile_sections')
        .createIndex(
          { profileId: 1, externalId: 1 },
          { unique: true, name: 'profile_section_unique' },
        ),
      database
        .collection('social_profile_sections')
        .createIndex(
          { profileId: 1, kind: 1, position: 1 },
          { name: 'profile_sections_ordered' },
        ),
      database
        .collection('profile_imports')
        .createIndex({ createdAt: -1 }, { name: 'imports_recent' }),
      database
        .collection('badge_profile_imports')
        .createIndex(
          { createdAt: -1 },
          { name: 'badge_profile_imports_recent' },
        ),
    ])
      .then(() => undefined)
      .catch((error) => {
        byDatabase.delete(database.databaseName)
        throw error
      })
    byDatabase.set(database.databaseName, pending)
  }
  await pending
  return database
}
