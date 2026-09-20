import 'server-only'

import { createHash } from 'node:crypto'
import { ObjectId } from 'mongodb'
import { getMongoDatabase } from '@/lib/mongodb'
import { agentContextView, ensureMinimalAgentContext, initializeNewAgentContext } from '@/lib/agent-contexts/store'
import { refreshPersonaPrefill } from '@/lib/persona-prefill'
import type { SocialImportPayload, SocialPlatform, SocialProfilePhoto } from '@/lib/social-types'

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

function sameHandle(first: string | null, second: string | null) {
  if (!first || !second) return false
  return first.replace(/^@/, '').trim().toLowerCase() === second.replace(/^@/, '').trim().toLowerCase()
}

export async function storeSocialProfilePhoto(payload: SocialProfilePhoto, userId: string) {
  const database = await getMongoDatabase()
  const now = new Date()
  await database.collection(PROFILE_COLLECTIONS[payload.platform]).updateOne(
    { userId },
    {
      $set: {
        userId,
        sourceUrl: payload.sourceUrl,
        url: payload.sourceUrl,
        handle: payload.handle,
        avatarUrl: payload.avatarUrl,
        cachedAvatar: {
          contentType: payload.profileImage.contentType,
          data: Buffer.from(payload.profileImage.bytes).toString('base64'),
          sourceUrl: payload.profileImage.sourceUrl,
          cachedAt: now,
        },
        profileSourceData: payload.profileSourceData,
        syncedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
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

  const userWrite = await database.collection<{ _id: string; displayName: string; createdAt: Date; updatedAt: Date }>('users').updateOne(
    { _id: userId },
    {
      $set: { displayName: payload.profile.name, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  let agentContext = await ensureMinimalAgentContext(userId, database)

  // The lookup above may have resolved a previous import by its stable URL or
  // account. Keep updating that record even when a later scrape starts
  // returning an external id that the original scrape did not provide.
  // Otherwise the id filter would miss the existing record and an upsert would
  // violate the one-profile-per-user constraint.
  const profileFilter = existingProfile?._id
    ? { _id: existingProfile._id }
    : rawProfile.id
      ? { id: rawProfile.id }
      : { userId }
  const profileFields: Record<string, unknown> = {
    ...rawProfile,
    platform: payload.profile.platform,
    avatarUrl: payload.profile.avatarUrl,
    userId,
    syncedAt: now,
  }
  if (payload.profileImage) {
    profileFields.cachedAvatar = {
      contentType: payload.profileImage.contentType,
      data: Buffer.from(payload.profileImage.bytes).toString('base64'),
      sourceUrl: payload.profileImage.sourceUrl,
      cachedAt: now,
    }
  }
  const profileResult = await profileCollection.findOneAndUpdate(
    profileFilter,
    { $set: profileFields },
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
        replaceOne: {
          filter: { platform: payload.profile.platform, externalId: post.externalId },
          replacement: {
            userId,
            profileId,
            platform: payload.profile.platform,
            externalId: post.externalId,
            url: post.url,
            text: post.text,
            kind: post.kind,
            imageUrl: post.imageUrl,
            publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
            likeCount: post.likeCount,
            commentCount: post.commentCount,
            viewCount: post.viewCount,
            raw: sourceData,
            syncedAt: now,
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
              authorUserId: sameHandle(comment.authorHandle, payload.profile.handle) ? userId : null,
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

  const sections = database.collection('social_profile_sections')
  const importedSections = uniqueByExternalId(payload.sections)
  if (importedSections.length) {
    await sections.bulkWrite(
      importedSections.map(({ sourceData, ...section }) => ({
        updateOne: {
          filter: { userId, platform: payload.profile.platform, externalId: section.externalId },
          update: {
            $set: {
              userId,
              profileId,
              platform: payload.profile.platform,
              externalId: section.externalId,
              kind: section.kind,
              heading: section.heading,
              text: section.text,
              position: section.position,
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
  await sections.deleteMany({
    profileId,
    externalId: { $nin: importedSections.map((section) => section.externalId) },
  })

  await refreshPersonaPrefill({
    userId,
    name: payload.profile.name,
    profileTexts: [payload.profile.bio, payload.profile.headline].filter((value): value is string => Boolean(value)),
    posts: importedPosts.map(post => post.text),
  })

  if (userWrite.upsertedCount === 1) agentContext = await initializeNewAgentContext(userId, database)

  return {
    userId,
    profileId: profileId.toHexString(),
    storedPostCount: importedPosts.length,
    storedCommentCount: importedComments.length,
    storedSectionCount: payload.sections.length,
    storedProfileImage: Boolean(payload.profile.avatarUrl),
    storedCoverImage: Boolean(payload.profile.coverImageUrl),
    agentContext: agentContextView(agentContext),
    userCreated: userWrite.upsertedCount === 1,
  }
}
