import 'server-only'

import { Db, MongoClient } from 'mongodb'

declare global {
  // eslint-disable-next-line no-var
  var __airosMongoClientPromise: Promise<MongoClient> | undefined
  // eslint-disable-next-line no-var
  var __airosMongoIndexesPromise: Promise<void> | undefined
}

function getMongoClientPromise() {
  const uri = process.env.MONGODB_URI

  if (!uri) {
    throw new Error('MONGODB_URI is not configured')
  }

  if (!global.__airosMongoClientPromise) {
    const client = new MongoClient(uri, {
      appName: 'airos',
      maxPoolSize: 10,
    })
    global.__airosMongoClientPromise = client.connect()
  }

  return global.__airosMongoClientPromise
}

export async function getMongoDatabase(): Promise<Db> {
  const client = await getMongoClientPromise()
  const databaseName = process.env.MONGODB_DB || 'gptinder'
  const database = client.db(databaseName)

  if (!global.__airosMongoIndexesPromise) {
    global.__airosMongoIndexesPromise = Promise.all([
      database.collection('users').createIndex(
        { displayName: 1 },
        { name: 'users_display_name' },
      ),
      database.collection('personas').createIndex(
        { userId: 1, slot: 1 },
        { unique: true, name: 'persona_user_slot_unique' },
      ),
      database.collection('agent_contexts').createIndex(
        { userId: 1 },
        { unique: true, name: 'agent_context_user_unique' },
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
      database.collection('social_comments').createIndex(
        { userId: 1, authorUserId: 1, publishedAt: -1 },
        { name: 'user_authored_comments_recent' },
      ),
      database.collection('social_profile_sections').createIndex(
        { userId: 1, platform: 1, externalId: 1 },
        { unique: true, name: 'profile_section_user_platform_external_unique' },
      ),
      database.collection('airos_profiles').createIndex(
        { badgeId: 1 },
        { unique: true, name: 'airos_profile_badge_unique' },
      ),
      database.collection('airos_profiles').createIndex(
        { lastImportedAt: -1, badgeId: 1 },
        { name: 'airos_profiles_recent' },
      ),
      database.collection('airos_profiles').createIndex(
        { name: 1 },
        { name: 'airos_profiles_name' },
      ),
      database.collection('airos_connections').createIndex(
        { pairKey: 1 },
        { unique: true, name: 'airos_connection_pair_unique' },
      ),
      database.collection('airos_connections').createIndex(
        { badgeIds: 1, lastObservedAt: -1 },
        { name: 'airos_connections_badge_recent' },
      ),
      database.collection('airos_profile_observations').createIndex(
        { sourceBadgeId: 1, observedAt: -1 },
        { name: 'airos_observations_source_recent' },
      ),
      database.collection('airos_profile_observations').createIndex(
        { targetBadgeId: 1, observedAt: -1 },
        { name: 'airos_observations_target_recent' },
      ),
      database.collection('airos_imports').createIndex(
        { importId: 1 },
        { unique: true, name: 'airos_import_id_unique' },
      ),
      database.collection('airos_profile_analyses').createIndex(
        { badgeId: 1 },
        { unique: true, name: 'airos_analysis_badge_unique' },
      ),
      database.collection('airos_rate_limits').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0, name: 'airos_rate_limits_ttl' },
      ),
    ]).then(() => undefined)
  }

  await global.__airosMongoIndexesPromise
  return database
}
