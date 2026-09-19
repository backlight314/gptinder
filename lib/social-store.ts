import 'server-only'

import { GridFSBucket, ObjectId } from 'mongodb'
import { getMongoDatabase } from '@/lib/mongodb'
import type { SocialImportPayload } from '@/lib/social-types'

export async function storeSocialImport(payload: SocialImportPayload) {
  const database = await getMongoDatabase()
  const now = new Date()
  const profiles = database.collection('social_profiles')

  const profileResult = await profiles.findOneAndUpdate(
    {
      platform: payload.profile.platform,
      handle: payload.profile.handle.toLowerCase(),
    },
    {
      $set: {
        ...payload.profile,
        handle: payload.profile.handle.toLowerCase(),
        provider: 'browserbase',
        sourceData: payload.profileSourceData,
        lastImportedAt: now,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!profileResult)
    throw new Error('MongoDB did not return the stored profile')
  const profileId = profileResult._id as ObjectId
  let storedProfileImage = false
  let storedCoverImage = false

  const storeProfileMedia = async (
    asset: NonNullable<SocialImportPayload['profileImage']>,
    kind: 'avatar' | 'cover',
  ) => {
    const bucket = new GridFSBucket(database, { bucketName: 'profile_media' })
    const upload = bucket.openUploadStream(
      `${payload.profile.platform}/${payload.profile.handle.toLowerCase()}/${kind}`,
      {
        metadata: {
          profileId,
          kind,
          sourceUrl: asset.sourceUrl,
          contentType: asset.contentType,
          capturedAt: now,
        },
      },
    )
    await new Promise<void>((resolve, reject) => {
      upload.once('finish', () => resolve())
      upload.once('error', reject)
      upload.end(Buffer.from(asset.bytes))
    })
    await profiles.updateOne(
      { _id: profileId },
      {
        $set: {
          [`${kind}FileId`]: upload.id,
          [`${kind}StoredAt`]: now,
        },
      },
    )
    const olderFiles = await bucket
      .find({
        'metadata.profileId': profileId,
        'metadata.kind': kind,
        _id: { $ne: upload.id },
      })
      .toArray()
    await Promise.all(olderFiles.map((file) => bucket.delete(file._id)))
  }

  if (payload.profileImage) {
    await storeProfileMedia(payload.profileImage, 'avatar')
    storedProfileImage = true
  }

  if (payload.coverImage) {
    await storeProfileMedia(payload.coverImage, 'cover')
    storedCoverImage = true
  }

  if (payload.posts.length) {
    await database.collection('social_posts').bulkWrite(
      payload.posts.map((post) => ({
        updateOne: {
          filter: { profileId, externalId: post.externalId },
          update: {
            $set: {
              ...post,
              profileId,
              platform: payload.profile.platform,
              importedAt: now,
              updatedAt: now,
              publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await database.collection('social_posts').deleteMany({
    profileId,
    externalId: { $nin: payload.posts.map((post) => post.externalId) },
  })

  if (payload.comments.length) {
    await database.collection('social_comments').bulkWrite(
      payload.comments.map((comment) => ({
        updateOne: {
          filter: {
            profileId,
            postExternalId: comment.postExternalId,
            externalId: comment.externalId,
          },
          update: {
            $set: {
              ...comment,
              profileId,
              platform: payload.profile.platform,
              importedAt: now,
              updatedAt: now,
              publishedAt: comment.publishedAt
                ? new Date(comment.publishedAt)
                : null,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await database.collection('social_comments').deleteMany({
    profileId,
    externalId: { $nin: payload.comments.map((comment) => comment.externalId) },
  })

  if (payload.sections.length) {
    await database.collection('social_profile_sections').bulkWrite(
      payload.sections.map((section) => ({
        updateOne: {
          filter: { profileId, externalId: section.externalId },
          update: {
            $set: {
              ...section,
              profileId,
              platform: payload.profile.platform,
              importedAt: now,
              updatedAt: now,
            },
            $setOnInsert: { createdAt: now },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    )
  }
  await database.collection('social_profile_sections').deleteMany({
    profileId,
    externalId: { $nin: payload.sections.map((section) => section.externalId) },
  })

  await database.collection('profile_imports').insertOne({
    profileId,
    platform: payload.profile.platform,
    handle: payload.profile.handle.toLowerCase(),
    sourceUrl: payload.profile.sourceUrl,
    provider: 'browserbase',
    postCount: payload.posts.length,
    commentCount: payload.comments.length,
    sectionCount: payload.sections.length,
    profileImageStored: storedProfileImage,
    coverImageStored: storedCoverImage,
    status: 'completed',
    createdAt: now,
  })

  return {
    profileId: profileId.toHexString(),
    storedPostCount: payload.posts.length,
    storedCommentCount: payload.comments.length,
    storedSectionCount: payload.sections.length,
    storedProfileImage,
    storedCoverImage,
  }
}
