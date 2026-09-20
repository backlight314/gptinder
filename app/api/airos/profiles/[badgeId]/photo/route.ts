import { NextResponse } from 'next/server'
import { normalizeBadgeId } from '@/lib/airos-directory'
import { getMongoDatabase } from '@/lib/mongodb'
import { profilePhoto, SAFE_PROFILE_IMAGE_TYPES, safeProviderPhotoUrl } from '@/lib/profile-photo'

export const runtime = 'nodejs'

type Platform = 'linkedin' | 'instagram' | 'x'
type CachedAvatar = { contentType?: unknown; data?: unknown }

function cachedImage(value: unknown): { contentType: string; bytes: Uint8Array } | null {
  if (!value || typeof value !== 'object') return null
  const cached = value as CachedAvatar
  if (typeof cached.contentType !== 'string' || !SAFE_PROFILE_IMAGE_TYPES.has(cached.contentType)) return null
  if (typeof cached.data !== 'string' || cached.data.length > 7_000_000) return null
  try {
    const bytes = new Uint8Array(Buffer.from(cached.data, 'base64'))
    return bytes.length > 0 && bytes.length <= 5_000_000 ? { contentType: cached.contentType, bytes } : null
  } catch {
    return null
  }
}

function imageResponse(bytes: Uint8Array, contentType: string) {
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function GET(_request: Request, context: { params: Promise<{ badgeId: string }> }) {
  const badgeId = normalizeBadgeId((await context.params).badgeId)
  if (!badgeId) return NextResponse.json({ error: 'Profile photo not found.' }, { status: 404 })

  const database = await getMongoDatabase()
  const profile = await database.collection('airos_profiles').findOne(
    { badgeId },
    { projection: { _id: 0, userId: 1, linkedin: 1, instagram: 1, x: 1 } },
  )
  if (!profile) return NextResponse.json({ error: 'Profile photo not found.' }, { status: 404 })

  const sources: Array<{ collection: string; platform: Platform; link: unknown }> = [
    { collection: 'linkedin_profiles', platform: 'linkedin', link: profile.linkedin },
    { collection: 'x_profiles', platform: 'x', link: profile.x },
    { collection: 'instagram_profiles', platform: 'instagram', link: profile.instagram },
  ]

  for (const source of sources) {
    const link = typeof source.link === 'string' ? source.link.replace(/\/$/, '') : null
    const urls = link ? [link, `${link}/`] : []
    const socialProfile = await database.collection(source.collection).findOne({ $or: [
      { userId: profile.userId },
      ...(urls.length ? [{ sourceUrl: { $in: urls } }, { url: { $in: urls } }, { linkedinUrl: { $in: urls } }] : []),
    ] }, { projection: {
      cachedAvatar: 1,
      avatarUrl: 1,
      profilePicUrlHD: 1,
      profilePicUrl: 1,
      profilePicture: 1,
      photo: 1,
      profile_image_url_https: 1,
      profile_image_url: 1,
    } })
    if (!socialProfile) continue

    const cached = cachedImage(socialProfile.cachedAvatar)
    if (cached) return imageResponse(cached.bytes, cached.contentType)

    const rawUrl = profilePhoto(socialProfile)
    const remoteUrl = rawUrl ? safeProviderPhotoUrl(rawUrl, source.platform) : null
    if (!remoteUrl) continue
    try {
      const response = await fetch(remoteUrl, {
        cache: 'no-store',
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
        redirect: 'follow',
        signal: AbortSignal.timeout(10_000),
      })
      const contentType = (response.headers.get('content-type') || '').split(';', 1)[0]?.trim().toLowerCase() || ''
      const declaredSize = Number(response.headers.get('content-length') || '0')
      if (!response.ok || !SAFE_PROFILE_IMAGE_TYPES.has(contentType) || declaredSize > 5_000_000) continue
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.length > 0 && bytes.length <= 5_000_000) return imageResponse(bytes, contentType)
    } catch {
      // Try the next provider, then let the UI use the personalized fallback.
    }
  }

  return NextResponse.json({ error: 'Profile photo not found.' }, { status: 404 })
}
