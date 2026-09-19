import 'server-only'

import { extractInstagramWithApify, extractLinkedInWithApify, extractXWithApify } from '@/lib/apify-linkedin'
import { SocialImportError } from '@/lib/social-errors'
import type {
  SocialImportPayload,
  SocialPlatform,
} from '@/lib/social-types'

export { SocialImportError } from '@/lib/social-errors'

export function parsePublicProfile(input: string): {
  platform: SocialPlatform
  handle: string
  sourceUrl: string
} {
  const trimmed = input.trim()
  if (!trimmed) throw new SocialImportError('Enter an Instagram, LinkedIn, or X profile URL.')

  if (/^@[A-Za-z0-9._]{1,30}$/.test(trimmed)) {
    const handle = trimmed.slice(1)
    return {
      platform: 'instagram',
      handle,
      sourceUrl: `https://www.instagram.com/${handle}/`,
    }
  }

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
  } catch {
    throw new SocialImportError('That profile URL is not valid.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  const pathSegments = url.pathname.split('/').filter(Boolean)

  if (hostname === 'instagram.com') {
    const handle = pathSegments[0]
    const reserved = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts'])
    if (!handle || reserved.has(handle.toLowerCase()) || !/^[A-Za-z0-9._]{1,30}$/.test(handle)) {
      throw new SocialImportError('Use a public Instagram profile URL, not a post or reel URL.')
    }

    return {
      platform: 'instagram',
      handle,
      sourceUrl: `https://www.instagram.com/${handle}/`,
    }
  }

  if (hostname === 'linkedin.com') {
    if (pathSegments[0]?.toLowerCase() !== 'in' || !pathSegments[1]) {
      throw new SocialImportError('Use a public LinkedIn person URL such as linkedin.com/in/name.')
    }

    const handle = pathSegments[1]
    return {
      platform: 'linkedin',
      handle,
      sourceUrl: `https://www.linkedin.com/in/${handle}/`,
    }
  }

  if (hostname === 'x.com' || hostname === 'twitter.com') {
    const handle = pathSegments[0]
    const reserved = new Set(['home', 'explore', 'search', 'i', 'settings', 'notifications', 'messages'])
    if (!handle || reserved.has(handle.toLowerCase()) || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
      throw new SocialImportError('Use a public X profile URL such as x.com/handle.')
    }

    return {
      platform: 'x',
      handle,
      sourceUrl: `https://x.com/${handle}`,
    }
  }

  throw new SocialImportError('Only public Instagram, LinkedIn, and X person profiles are supported.')
}

export async function importPublicProfile(
  input: string,
): Promise<SocialImportPayload> {
  if (!process.env.APIFY_TOKEN) {
    throw new SocialImportError(
      'Profile importing is not configured yet. Add APIFY_TOKEN to the server environment.',
      503,
    )
  }

  const parsed = parsePublicProfile(input)
  const extracted = parsed.platform === 'linkedin'
    ? await extractLinkedInWithApify(parsed.handle, parsed.sourceUrl)
    : parsed.platform === 'instagram'
      ? await extractInstagramWithApify(parsed.handle, parsed.sourceUrl)
      : await extractXWithApify(parsed.handle, parsed.sourceUrl)

  return {
    ...extracted,
  }
}
