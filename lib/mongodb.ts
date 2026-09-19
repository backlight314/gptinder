import 'server-only'

import { Db, MongoClient } from 'mongodb'

declare global {
  // eslint-disable-next-line no-var
  var __gptinderMongoClientPromise: Promise<MongoClient> | undefined
  // eslint-disable-next-line no-var
  var __gptinderMongoIndexesPromise: Promise<void> | undefined
}

function getMongoClientPromise() {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error('MONGODB_URI is not configured')
  }

  if (!global.__gptinderMongoClientPromise) {
    const client = new MongoClient(uri, {
      appName: 'gptinder',
      maxPoolSize: 10,
    })
    global.__gptinderMongoClientPromise = client.connect()
  }

  return global.__gptinderMongoClientPromise
}

export async function getMongoDatabase(): Promise<Db> {
  const client = await getMongoClientPromise()
  const databaseName = process.env.MONGODB_DB || 'gptinder'
  const database = client.db(databaseName)

  if (!global.__gptinderMongoIndexesPromise) {
    global.__gptinderMongoIndexesPromise = Promise.all([
      database.collection('social_profiles').createIndex(
        { platform: 1, handle: 1 },
        { unique: true, name: 'platform_handle_unique' },
      ),
      database.collection('social_posts').createIndex(
        { profileId: 1, externalId: 1 },
        { unique: true, name: 'profile_post_unique' },
      ),
      database.collection('social_posts').createIndex(
        { profileId: 1, publishedAt: -1 },
        { name: 'profile_posts_recent' },
      ),
      database.collection('social_comments').createIndex(
        { profileId: 1, postExternalId: 1, externalId: 1 },
        { unique: true, name: 'profile_post_comment_unique' },
      ),
      database.collection('social_profile_sections').createIndex(
        { profileId: 1, externalId: 1 },
        { unique: true, name: 'profile_section_unique' },
      ),
      database.collection('social_profile_sections').createIndex(
        { profileId: 1, kind: 1, position: 1 },
        { name: 'profile_sections_ordered' },
      ),
      database.collection('profile_imports').createIndex(
        { createdAt: -1 },
        { name: 'imports_recent' },
      ),
    ]).then(() => undefined)
  }

  await global.__gptinderMongoIndexesPromise
  return database
}
