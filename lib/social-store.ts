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

export async function storeSocialImport(payload: SocialImportPayload, requestedUserId?: string) {
  const database = await getMongoDatabase()
  const now = new Date()
  const profileCollection = database.collection(PROFILE_COLLECTIONS[payload.profile.platform])
  const rawProfile = rawDocument(payload.profileSourceData)
  const platformIdentity = String(rawProfile.id || payload.profile.externalId || payload.profile.handle)
  const profileIdentity = rawProfile.id
    ? { id: rawProfile.id }
    : requestedUserId
      ? { userId: requestedUserId }
      : { userId: '__new_profile__' }

  const existingProfile = await profileCollection.findOne(
    profileIdentity,
    { projection: { userId: 1 } },
  )
  const userId = requestedUserId
    || (typeof existingProfile?.userId === 'string' ? existingProfile.userId : null)
    || personalizedUserId(payload.profile.name, `${payload.profile.platform}:${platformIdentity}`)

  await database.collection<{ _id: string; displayName: string; createdAt: Date; updatedAt: Date }>('users').updateOne(
    { _id: userId },
    {
      $set: { displayName: payload.profile.name, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

  const profileResult = await profileCollection.findOneAndUpdate(
    rawProfile.id ? { id: rawProfile.id } : { userId },
    { $set: { ...rawProfile, userId, syncedAt: now } },
    { upsert: true, returnDocument: 'after' },
  )
  if (!profileResult) throw new Error('MongoDB did not return the stored platform profile')
  const profileId = profileResult._id as ObjectId

  const posts = database.collection('social_posts')
  if (payload.posts.length) {
    await posts.bulkWrite(
      payload.posts.map(({ sourceData, ...post }) => ({
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
    externalId: { $nin: payload.posts.map((post) => post.externalId) },
  })

  const storedPosts = await posts
    .find({ profileId }, { projection: { _id: 1, externalId: 1 } })
    .toArray()
  const postIds = new Map(storedPosts.map((post) => [String(post.externalId), post._id]))

  const comments = database.collection('social_comments')
  if (payload.comments.length) {
    await comments.bulkWrite(
      payload.comments.map(({ sourceData, ...comment }) => ({
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
    externalId: { $nin: payload.comments.map((comment) => comment.externalId) },
  })

  return {
    userId,
    profileId: profileId.toHexString(),
    storedPostCount: payload.posts.length,
    storedCommentCount: payload.comments.length,
    storedSectionCount: payload.sections.length,
    storedProfileImage: Boolean(payload.profile.avatarUrl),
    storedCoverImage: Boolean(payload.profile.coverImageUrl),
  }
}
