import 'server-only'

import { extractProfilePhotoWithApify } from '@/lib/apify-linkedin'
import { getMongoDatabase } from '@/lib/mongodb'
import { profilePhoto } from '@/lib/profile-photo'
import { parsePublicProfile } from '@/lib/social-import'
import { storeSocialProfilePhoto } from '@/lib/social-store'
import type { AirosProfileDocument } from '@/lib/airos-directory-store'

const PROFILE_COLLECTIONS = {
  linkedin: 'linkedin_profiles',
  x: 'x_profiles',
  instagram: 'instagram_profiles',
} as const

const RETRY_AFTER_MS = 24 * 60 * 60 * 1000

type PhotoResult = {
  badgeId: string
  status: 'found' | 'existing' | 'unavailable' | 'skipped'
  platform?: 'linkedin' | 'instagram' | 'x'
}

async function currentPhoto(profile: AirosProfileDocument) {
  const database = await getMongoDatabase()
  for (const platform of ['linkedin', 'x', 'instagram'] as const) {
    const social = await database.collection(PROFILE_COLLECTIONS[platform]).findOne(
      { userId: profile.userId },
      { projection: { cachedAvatar: 1, avatarUrl: 1, profilePicUrlHD: 1, profilePicUrl: 1, profilePicture: 1, photo: 1, profile_image_url_https: 1, profile_image_url: 1 } },
    )
    if (social?.cachedAvatar || profilePhoto(social)) return platform
  }
  return null
}

async function refreshOne(profile: AirosProfileDocument): Promise<PhotoResult> {
  const existing = await currentPhoto(profile)
  if (existing) return { badgeId: profile.badgeId, status: 'existing', platform: existing }
  if (profile.photoRefreshAttemptedAt && Date.now() - profile.photoRefreshAttemptedAt.getTime() < RETRY_AFTER_MS) {
    return { badgeId: profile.badgeId, status: 'skipped' }
  }

  const database = await getMongoDatabase()
  const links = [profile.linkedin, profile.x, profile.instagram].filter((link): link is string => Boolean(link))
  const errors: string[] = []
  for (const link of links) {
    try {
      const parsed = parsePublicProfile(link)
      const photo = await extractProfilePhotoWithApify(parsed.platform, parsed.handle, parsed.sourceUrl)
      await storeSocialProfilePhoto(photo, profile.userId)
      await database.collection('airos_profiles').updateOne(
        { badgeId: profile.badgeId },
        { $set: { photoRefreshAttemptedAt: new Date(), photoRefreshError: null } },
      )
      return { badgeId: profile.badgeId, status: 'found', platform: parsed.platform }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : 'Photo import failed.')
    }
  }

  await database.collection('airos_profiles').updateOne(
    { badgeId: profile.badgeId },
    { $set: { photoRefreshAttemptedAt: new Date(), photoRefreshError: errors.at(-1) || 'No supported social profile is available.' } },
  )
  return { badgeId: profile.badgeId, status: links.length ? 'unavailable' : 'skipped' }
}

export async function refreshAirosProfilePhotos(badgeIds: string[]) {
  const database = await getMongoDatabase()
  const profiles = await database.collection<AirosProfileDocument>('airos_profiles')
    .find({ badgeId: { $in: badgeIds } })
    .toArray()
  const results: PhotoResult[] = []
  let cursor = 0
  const workers = Array.from({ length: Math.min(4, profiles.length) }, async () => {
    while (cursor < profiles.length) {
      const profile = profiles[cursor]
      cursor += 1
      if (profile) results.push(await refreshOne(profile))
    }
  })
  await Promise.all(workers)
  return {
    requested: badgeIds.length,
    found: results.filter((result) => result.status === 'found').length,
    existing: results.filter((result) => result.status === 'existing').length,
    unavailable: results.filter((result) => result.status === 'unavailable').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    results,
  }
}
