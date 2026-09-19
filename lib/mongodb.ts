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
      database.collection('users').createIndex(
        { displayName: 1 },
        { name: 'users_display_name' },
      ),
      database.collection('personas').createIndex(
        { userId: 1, slot: 1 },
        { unique: true, name: 'persona_user_slot_unique' },
      ),
      ...(['linkedin_profiles', 'instagram_profiles', 'x_profiles'] as const).map((name) =>
        database.collection(name).createIndex(
          { userId: 1 },
          { unique: true, name: 'profile_user_unique' },
        ),
      ),
      ...(['linkedin_profiles', 'instagram_profiles', 'x_profiles'] as const).map((name) =>
        database.collection(name).createIndex(
          { id: 1 },
          {
            unique: true,
            name: 'profile_external_id_unique',
            partialFilterExpression: { id: { $type: 'string' } },
          },
        ),
      ),
      database.collection('social_posts').createIndex(
        { platform: 1, externalId: 1 },
        { unique: true, name: 'platform_post_unique' },
      ),
      database.collection('social_posts').createIndex(
        { profileId: 1, publishedAt: -1 },
        { name: 'profile_posts_recent' },
      ),
      database.collection('social_comments').createIndex(
        { platform: 1, externalId: 1 },
        { unique: true, name: 'platform_comment_unique' },
      ),
      database.collection('social_comments').createIndex(
        { postId: 1, publishedAt: 1 },
        { name: 'post_comments_ordered' },
      ),
    ]).then(() => undefined)
  }

  await global.__gptinderMongoIndexesPromise
  return database
}
