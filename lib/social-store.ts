import 'server-only'

import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { getMongoDatabase } from '@/lib/mongodb'
import type { SocialImportPayload, SocialPlatform } from '@/lib/social-types'

const PROFILE_COLLECTIONS: Record<SocialPlatform, string> = {
  linkedin: 'linkedin_profiles',
  instagram: 'instagram_profiles',
  x: 'x_profiles',
}

function personalizedUserId(name: string, identity: string) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'user'
  const suffix = createHash('sha256').update(identity).digest('hex').slice(0, 6)
  return `usr_${slug}_${suffix}`
}

function rawDocument(source: Record<string, unknown>) {
  const raw = { ...source }
  delete raw._id
  delete raw.userId
  delete raw.syncedAt
  delete raw.provider
  delete raw.warnings
  delete raw.importMetadata
  return raw
}

function uniqueByExternalId<T extends { externalId: string }>(items: T[]) {
  const unique = new Map<string, T>()
  for (const item of items) {
    if (!unique.has(item.externalId)) unique.set(item.externalId, item)
  }
  return Array.from(unique.values())
}

export async function storeSocialImport(payload: SocialImportPayload, requestedUserId?: string) {
  const database = await getMongoDatabase()
  const now = new Date()
  const profileCollection = database.collection(PROFILE_COLLECTIONS[payload.profile.platform])
  const rawProfile = rawDocument(payload.profileSourceData)
  const platformIdentity = String(rawProfile.id || payload.profile.externalId || payload.profile.handle)
  const profileIdentity = {
    $or: [
      ...(rawProfile.id ? [{ id: rawProfile.id }] : []),
      { sourceUrl: payload.profile.sourceUrl },
      { url: payload.profile.sourceUrl },
      ...(requestedUserId ? [{ userId: requestedUserId }] : []),
    ],
  }

  const existingProfile = await profileCollection.findOne(
    profileIdentity,
    { projection: { _id: 1, userId: 1 } },
  )
  // An exact external profile identity is the source of truth. This prevents a
  // retry from moving a profile to a newly generated user just because the UI
  // supplied a different local userId.
  const userId = (typeof existingProfile?.userId === 'string' ? existingProfile.userId : null)
    || requestedUserId
    || personalizedUserId(payload.profile.name, `${payload.profile.platform}:${platformIdentity}`)

  await database.collection<{ _id: string; displayName: string; createdAt: Date; updatedAt: Date }>('users').updateOne(
    { _id: userId },
    {
      $set: { displayName: payload.profile.name, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

  const profileFilter = rawProfile.id
    ? { id: rawProfile.id }
    : existingProfile?._id
      ? { _id: existingProfile._id }
      : { userId }
  const profileResult = await profileCollection.findOneAndUpdate(
    profileFilter,
    { $set: { ...rawProfile, userId, syncedAt: now } },
    { upsert: true, returnDocument: 'after' },
  )
  if (!profileResult) throw new Error('MongoDB did not return the stored platform profile')
  const profileId = profileResult._id as ObjectId

  const importedPosts = uniqueByExternalId(payload.posts)
  const importedComments = uniqueByExternalId(payload.comments)

  const posts = database.collection('social_posts')
  if (importedPosts.length) {
    await posts.bulkWrite(
      importedPosts.map(({ sourceData, ...post }) => ({
        updateOne: {
          filter: { platform: payload.profile.platform, externalId: post.externalId },
          update: {
            $set: {
              userId,
              profileId,
              platform: payload.profile.platform,
              externalId: post.externalId,
              url: post.url,
              text: post.text,
              publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
              raw: sourceData,
              syncedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await posts.deleteMany({
    profileId,
    externalId: { $nin: importedPosts.map((post) => post.externalId) },
  })

  const storedPosts = await posts
    .find({ profileId }, { projection: { _id: 1, externalId: 1 } })
    .toArray()
  const postIds = new Map(storedPosts.map((post) => [String(post.externalId), post._id]))

  const comments = database.collection('social_comments')
  if (importedComments.length) {
    await comments.bulkWrite(
      importedComments.map(({ sourceData, ...comment }) => ({
        updateOne: {
          filter: { platform: payload.profile.platform, externalId: comment.externalId },
          update: {
            $set: {
              userId,
              profileId,
              postId: postIds.get(comment.postExternalId) || null,
              platform: payload.profile.platform,
              externalId: comment.externalId,
              parentCommentId: null,
              text: comment.text,
              publishedAt: comment.publishedAt ? new Date(comment.publishedAt) : null,
              author: {
                name: comment.authorName,
                username: comment.authorHandle,
              },
              raw: sourceData,
              syncedAt: now,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await comments.deleteMany({
    profileId,
    externalId: { $nin: importedComments.map((comment) => comment.externalId) },
  })

  return {
    userId,
    profileId: profileId.toHexString(),
    storedPostCount: importedPosts.length,
    storedCommentCount: importedComments.length,
    storedSectionCount: payload.sections.length,
    storedProfileImage: Boolean(payload.profile.avatarUrl),
    storedCoverImage: Boolean(payload.profile.coverImageUrl),
  }
}
