import { MongoClient } from 'mongodb'

const mongoUri = process.env.MONGODB_URI
const databaseName = process.env.MONGODB_DB || 'gptinder'
const userId = process.env.MIGRATION_USER_ID || 'usr_jaimin_patel_007'
const displayName = process.env.MIGRATION_DISPLAY_NAME || 'Jaimin Patel'

if (!mongoUri) throw new Error('MONGODB_URI is not configured')

const client = new MongoClient(mongoUri, { appName: 'gptinder-schema-migration' })
await client.connect()

try {
  const database = client.db(databaseName)
  const existingNames = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name))
  const sourceProfilesName = existingNames.has('social_profiles')
    ? 'social_profiles'
    : existingNames.has('legacy_social_profiles')
      ? 'legacy_social_profiles'
      : null

  if (!sourceProfilesName) throw new Error('No existing social profile collection was found')

  const legacyProfiles = await database.collection(sourceProfilesName).find({}).toArray()
  const identities = legacyProfiles.map((profile) => `${profile.platform}:${String(profile.handle).toLowerCase()}`).sort()
  const expectedIdentities = ['linkedin:jaimin-patel007', 'x:jaiminpate25520']
  if (identities.length !== expectedIdentities.length || identities.some((identity, index) => identity !== expectedIdentities[index])) {
    throw new Error(`Migration expected only ${expectedIdentities.join(', ')} but found ${identities.join(', ')}`)
  }

  const now = new Date()
  await database.collection('users').updateOne(
    { _id: userId },
    {
      $set: { displayName, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

  const profileCollections = {
    linkedin: 'linkedin_profiles',
    instagram: 'instagram_profiles',
    x: 'x_profiles',
  }
  const profileIdMap = new Map()

  for (const legacyProfile of legacyProfiles) {
    const targetName = profileCollections[legacyProfile.platform]
    if (!targetName) throw new Error(`Unsupported legacy platform: ${legacyProfile.platform}`)
    const raw = { ...(legacyProfile.sourceData || {}) }
    delete raw._id
    delete raw.userId
    delete raw.syncedAt
    delete raw.provider
    delete raw.warnings
    delete raw.importMetadata
    const identity = raw.id ? { id: raw.id } : { userId }
    const stored = await database.collection(targetName).findOneAndUpdate(
      identity,
      { $set: { ...raw, userId, syncedAt: now } },
      { upsert: true, returnDocument: 'after' },
    )
    if (!stored) throw new Error(`Failed to migrate ${legacyProfile.platform} profile`)
    profileIdMap.set(legacyProfile._id.toHexString(), stored._id)
  }

  const posts = database.collection('social_posts')
  const legacyPosts = await posts.find({}).toArray()
  for (const post of legacyPosts) {
    const newProfileId = profileIdMap.get(post.profileId?.toHexString())
    if (!newProfileId) throw new Error(`Post ${post._id} has no migrated profile`)
    await posts.replaceOne(
      { _id: post._id },
      {
        _id: post._id,
        userId,
        profileId: newProfileId,
        platform: post.platform,
        externalId: post.externalId,
        url: post.url ?? null,
        text: post.text || '',
        publishedAt: post.publishedAt || null,
        raw: post.raw || post.sourceData || {},
        syncedAt: now,
      },
    )
  }

  const postIdMap = new Map(
    (await posts.find({}, { projection: { _id: 1, platform: 1, externalId: 1 } }).toArray())
      .map((post) => [`${post.platform}:${post.externalId}`, post._id]),
  )
  const comments = database.collection('social_comments')
  const legacyComments = await comments.find({}).toArray()
  for (const comment of legacyComments) {
    const newProfileId = profileIdMap.get(comment.profileId?.toHexString())
    if (!newProfileId) throw new Error(`Comment ${comment._id} has no migrated profile`)
    await comments.replaceOne(
      { _id: comment._id },
      {
        _id: comment._id,
        userId,
        profileId: newProfileId,
        postId: postIdMap.get(`${comment.platform}:${comment.postExternalId}`) || null,
        platform: comment.platform,
        externalId: comment.externalId,
        parentCommentId: null,
        text: comment.text || '',
        publishedAt: comment.publishedAt || null,
        author: {
          name: comment.author?.name ?? comment.authorName ?? null,
          username: comment.author?.username ?? comment.authorHandle ?? null,
        },
        raw: comment.raw || comment.sourceData || {},
        syncedAt: now,
      },
    )
  }

  const archivePairs = [
    ['social_profiles', 'legacy_social_profiles'],
    ['social_profile_sections', 'legacy_social_profile_sections'],
    ['profile_imports', 'legacy_profile_imports'],
    ['profile_media.files', 'legacy_profile_media.files'],
    ['profile_media.chunks', 'legacy_profile_media.chunks'],
  ]
  const namesBeforeArchive = new Set((await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name))
  for (const [from, to] of archivePairs) {
    if (!namesBeforeArchive.has(from)) continue
    if (namesBeforeArchive.has(to)) throw new Error(`Cannot archive ${from}: ${to} already exists`)
    await database.collection(from).rename(to)
  }

  await Promise.all([
    database.collection('users').createIndex({ displayName: 1 }, { name: 'users_display_name' }),
    ...Object.values(profileCollections).flatMap((name) => [
      database.collection(name).createIndex({ userId: 1 }, { unique: true, name: 'profile_user_unique' }),
      database.collection(name).createIndex(
        { id: 1 },
        { unique: true, name: 'profile_external_id_unique', partialFilterExpression: { id: { $type: 'string' } } },
      ),
    ]),
    posts.createIndex({ platform: 1, externalId: 1 }, { unique: true, name: 'platform_post_unique' }),
    posts.createIndex({ userId: 1, publishedAt: -1 }, { name: 'user_posts_recent' }),
    comments.createIndex({ platform: 1, externalId: 1 }, { unique: true, name: 'platform_comment_unique' }),
    comments.createIndex({ postId: 1, publishedAt: 1 }, { name: 'post_comments_ordered' }),
  ])

  const primaryCollections = ['users', 'linkedin_profiles', 'instagram_profiles', 'x_profiles', 'social_posts', 'social_comments']
  const counts = Object.fromEntries(await Promise.all(primaryCollections.map(async (name) => [name, await database.collection(name).countDocuments()])))
  console.log(JSON.stringify({ userId, displayName, counts, archived: archivePairs.map(([, to]) => to) }, null, 2))
} finally {
  await client.close()
}
