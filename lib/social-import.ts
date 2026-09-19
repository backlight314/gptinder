import 'server-only'

import { extractInstagramWithApify, extractLinkedInWithApify, extractXWithApify } from '@/lib/apify-linkedin'
import { SocialImportError } from '@/lib/social-errors'
import type {
  ImportedPersona,
  NormalizedSocialPost,
  NormalizedSocialProfile,
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

const stopWords = new Set([
  'about', 'after', 'again', 'also', 'been', 'being', 'from', 'have', 'into', 'just',
  'more', 'most', 'that', 'their', 'there', 'these', 'they', 'this', 'very', 'what',
  'when', 'where', 'which', 'with', 'would', 'your', 'https', 'www', 'com', 'the',
  'and', 'for', 'you', 'are', 'our', 'but', 'not', 'was', 'were', 'has', 'had',
])

function personaFromImport(
  profile: NormalizedSocialProfile,
  posts: NormalizedSocialPost[],
  color: 'coral' | 'violet',
): ImportedPersona {
  const corpus = [profile.bio, ...posts.map((post) => post.text)].join(' ')
  const words = corpus.toLowerCase().match(/[a-z][a-z'-]{2,}/g) || []
  const counts = new Map<string, number>()
  for (const word of words) {
    if (!stopWords.has(word)) counts.set(word, (counts.get(word) || 0) + 1)
  }

  const interests = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([word]) => word)
  const lower = corpus.toLowerCase()
  const traitSignals: Array<[string, RegExp]> = [
    ['Creative', /\b(art|design|music|photo|film|write|build|create)\w*\b/],
    ['Adventurous', /\b(travel|trip|hike|explore|adventure|food)\w*\b/],
    ['Ambitious', /\b(founder|career|business|launch|growth|work)\w*\b/],
    ['Thoughtful', /\b(learn|think|reflect|idea|book|research)\w*\b/],
    ['Social', /\b(friend|community|team|people|together|event)\w*\b/],
  ]
  const traits = traitSignals.filter(([, pattern]) => pattern.test(lower)).map(([trait]) => trait).slice(0, 3)
  while (traits.length < 3) {
    for (const fallback of ['Curious', 'Expressive', 'Open-minded']) {
      if (!traits.includes(fallback)) {
        traits.push(fallback)
        break
      }
    }
  }

  const averageLength = posts.length
    ? posts.reduce((total, post) => total + post.text.length, 0) / posts.length
    : profile.bio.length
  const style = averageLength > 220
    ? 'Detailed and reflective'
    : /[!?]{2,}|[\u{1F300}-\u{1FAFF}]/u.test(corpus)
      ? 'Energetic and expressive'
      : 'Concise and conversational'

  return {
    name: profile.name,
    handle: `@${profile.handle}`,
    traits,
    interests: interests.length ? interests : ['conversation', 'new experiences', 'connection'],
    style,
    bio: profile.bio || `Public ${profile.platform} profile with ${posts.length} imported posts.`,
    color,
  }
}

export async function importPublicProfile(
  input: string,
  color: 'coral' | 'violet',
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
    persona: personaFromImport(extracted.profile, extracted.posts, color),
  }
}
