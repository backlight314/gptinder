import 'server-only'

import { createHash } from 'node:crypto'
import Browserbase from '@browserbasehq/sdk'
import { chromium, type Browser, type Page } from 'playwright-core'
import type {
  ImportedPersona,
  NormalizedProfileSection,
  NormalizedSocialComment,
  NormalizedSocialPost,
  NormalizedSocialProfile,
  ProfileImageAsset,
  SocialImportPayload,
  SocialPlatform,
} from '@/lib/social-types'

type PageSnapshot = {
  url: string
  title: string
  description: string
  imageUrl: string | null
  heading: string
  mainText: string
  visibleText: string
  profileFacts: {
    name: string
    headline: string
    location: string
    avatarUrl: string | null
    coverImageUrl: string | null
  }
  articleTexts: string[]
  commentTexts: string[]
  sections: Array<{ heading: string; text: string; position: number }>
  links: Array<{ url: string; text: string }>
  jsonLd: unknown[]
  publishedAt: string | null
  capturedAt: string
}

type LinkedInDetailSnapshot = {
  kind: string
  heading: string
  snapshot: PageSnapshot
}

export class SocialImportError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message)
    this.name = 'SocialImportError'
  }
}

function stableId(...values: Array<string | null | undefined>) {
  return createHash('sha256')
    .update(values.filter(Boolean).join('|'))
    .digest('hex')
    .slice(0, 32)
}

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

function postLimit() {
  const configured = Number.parseInt(process.env.PROFILE_IMPORT_MAX_POSTS || '12', 10)
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 30) : 12
}

function allowedDomains(platform: SocialPlatform) {
  if (platform === 'instagram') return ['instagram.com']
  if (platform === 'linkedin') return ['linkedin.com']
  return ['x.com', 'twitter.com']
}

function contextIdFor(platform: SocialPlatform) {
  if (platform === 'linkedin') return process.env.BROWSERBASE_LINKEDIN_CONTEXT_ID
  if (platform === 'instagram') return process.env.BROWSERBASE_INSTAGRAM_CONTEXT_ID
  return process.env.BROWSERBASE_X_CONTEXT_ID
}

async function scrollPage(page: Page, rounds = 5) {
  for (let index = 0; index < rounds; index += 1) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForTimeout(700)
  }
}

async function expandVisibleComments(page: Page) {
  const pattern = /(view|show|load)\s+(all\s+)?(more\s+|previous\s+)?(comments?|replies)|more replies/i
  for (let round = 0; round < 4; round += 1) {
    const controls = await page.locator('button, [role="button"]').all()
    let clicked = 0
    for (const control of controls.slice(0, 250)) {
      const label = await control.innerText().catch(() => '')
      if (!pattern.test(label) || !await control.isVisible().catch(() => false)) continue
      await control.click({ timeout: 2_000 }).catch(() => undefined)
      clicked += 1
      if (clicked >= 8) break
    }
    if (!clicked) break
    await page.waitForTimeout(600)
  }
}

async function capturePage(
  page: Page,
  url: string,
  scrollRounds = 2,
  expandComments = false,
): Promise<PageSnapshot> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForTimeout(1_500)
    if (expandComments) await expandVisibleComments(page)
    await scrollPage(page, scrollRounds)
    if (expandComments) await expandVisibleComments(page)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown navigation error'
    throw new SocialImportError(`Browserbase could not open ${new URL(url).hostname}: ${message}`, 502)
  }

  return page.evaluate(() => {
    const content = (selector: string) =>
      document.querySelector(selector)?.getAttribute('content')?.trim() || ''
    const clean = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim()
    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .map((node) => {
        try {
          return JSON.parse(node.textContent || '') as unknown
        } catch {
          return null
        }
      })
      .filter((value) => value !== null)
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
      .map((anchor) => ({ url: anchor.href, text: clean(anchor.innerText) }))
      .filter((link) => link.url.startsWith('http'))
      .slice(0, 2_000)
    const articleTexts = Array.from(document.querySelectorAll('article'))
      .map((article) => clean((article as HTMLElement).innerText))
      .filter(Boolean)
      .slice(0, 100)
    const hostname = location.hostname.replace(/^www\./, '')
    const commentSelectors = hostname === 'x.com' || hostname === 'twitter.com'
      ? 'article'
      : hostname === 'linkedin.com'
        ? '[class*="comments-comment-item"], [data-test-id*="comment"]'
        : 'article ul ul li, main ul ul li'
    const commentTexts = Array.from(document.querySelectorAll(commentSelectors))
      .map((node) => clean((node as HTMLElement).innerText))
      .filter((value, index) => value.length > 1 && (hostname !== 'x.com' && hostname !== 'twitter.com' || index > 0))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 500)
    const sections = Array.from(document.querySelectorAll<HTMLElement>('main section, main [data-view-name="profile-card"]'))
      .map((section, position) => ({
        heading: clean(section.querySelector('h2, h3')?.textContent),
        text: clean(section.innerText),
        position,
      }))
      .filter((section) => section.text.length > 2)
      .filter((section, index, values) => values.findIndex((candidate) => candidate.text === section.text) === index)
      .slice(0, 100)
    const time = document.querySelector<HTMLTimeElement>('time[datetime]')
    const main = document.querySelector<HTMLElement>('main')
    const linkedInName = hostname === 'linkedin.com'
      ? clean(document.querySelector('main h1')?.textContent)
      : ''
    const linkedInHeadline = hostname === 'linkedin.com'
      ? clean(document.querySelector<HTMLElement>('main .text-body-medium.break-words')?.innerText)
      : ''
    const linkedInLocation = hostname === 'linkedin.com'
      ? clean(document.querySelector<HTMLElement>('main .text-body-small.inline.t-black--light.break-words')?.innerText)
      : ''
    const linkedInAvatar = hostname === 'linkedin.com'
      ? document.querySelector<HTMLImageElement>(
        'main img.pv-top-card-profile-picture__image--show, main img.pv-top-card-profile-picture__image, main img.profile-photo-edit__preview',
      )?.src || null
      : null
    const linkedInCover = hostname === 'linkedin.com'
      ? document.querySelector<HTMLImageElement>(
        'main img.profile-background-image__image, main .profile-background-image img',
      )?.src || null
      : null

    return {
      url: location.href,
      title: clean(document.title),
      description: content('meta[property="og:description"]') || content('meta[name="description"]'),
      imageUrl: content('meta[property="og:image"]') || null,
      heading: clean(document.querySelector('h1')?.textContent),
      mainText: clean(main?.innerText).slice(0, 120_000),
      visibleText: clean(document.body?.innerText).slice(0, 120_000),
      profileFacts: {
        name: linkedInName,
        headline: linkedInHeadline,
        location: linkedInLocation,
        avatarUrl: linkedInAvatar,
        coverImageUrl: linkedInCover,
      },
      articleTexts,
      commentTexts,
      sections,
      links,
      jsonLd,
      publishedAt: time?.dateTime || time?.getAttribute('datetime') || null,
      capturedAt: new Date().toISOString(),
    }
  })
}

function assertUsableSnapshot(platform: SocialPlatform, snapshot: PageSnapshot) {
  const url = snapshot.url.toLowerCase()
  const title = snapshot.title.toLowerCase()
  const text = snapshot.visibleText.toLowerCase()

  if (platform === 'linkedin') {
    const loginWall = /\/(login|signup|authwall|checkpoint)(\/|\?|$)/.test(url)
      || title === 'join linkedin'
      || text.includes('by clicking agree & join')
      || text.includes('new to linkedin? join now')
    if (loginWall) {
      throw new SocialImportError(
        'LinkedIn returned a login wall. Authenticate the configured Browserbase LinkedIn context, then retry.',
        409,
      )
    }
  }

  if (platform === 'instagram' && (/\/accounts\/login/.test(url) || text.includes('log in to see photos and videos'))) {
    throw new SocialImportError(
      'Instagram returned a login wall. Authenticate the configured Browserbase Instagram context, then retry.',
      409,
    )
  }

  if (platform === 'x' && (/\/i\/flow\/login/.test(url) || text.includes('sign in to x'))) {
    throw new SocialImportError(
      'X returned a login wall. Authenticate the configured Browserbase X context, then retry.',
      409,
    )
  }

  if (snapshot.mainText.length < 40) {
    throw new SocialImportError('The profile page did not expose enough content to import safely.', 422)
  }
}

const linkedInDetailRoutes: Array<{ path: string; kind: string; heading: string }> = [
  { path: 'experience', kind: 'experience', heading: 'Experience' },
  { path: 'education', kind: 'education', heading: 'Education' },
  { path: 'certifications', kind: 'certification', heading: 'Licenses & certifications' },
  { path: 'projects', kind: 'project', heading: 'Projects' },
  { path: 'skills', kind: 'skills', heading: 'Skills' },
  { path: 'volunteering-experiences', kind: 'volunteering', heading: 'Volunteering' },
  { path: 'honors', kind: 'honors', heading: 'Honors & awards' },
]

async function captureLinkedInDetails(page: Page, handle: string) {
  const details: LinkedInDetailSnapshot[] = []
  for (const route of linkedInDetailRoutes) {
    try {
      const snapshot = await capturePage(
        page,
        `https://www.linkedin.com/in/${handle}/details/${route.path}/`,
        4,
      )
      assertUsableSnapshot('linkedin', snapshot)
      if (/page not found|this page doesn.t exist/i.test(snapshot.mainText)) continue
      if (snapshot.mainText.length < 80) continue
      details.push({ kind: route.kind, heading: route.heading, snapshot })
    } catch (error) {
      if (error instanceof SocialImportError && error.status === 409) throw error
      // LinkedIn omits detail routes when a profile has no entries of that kind.
    }
  }
  return details
}

function canonicalPostUrl(rawUrl: string, platform: SocialPlatform): string | null {
  try {
    const url = new URL(rawUrl)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')

    if (platform === 'instagram') {
      if (hostname !== 'instagram.com' || !/^\/(p|reel)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null
    } else if (platform === 'linkedin') {
      if (hostname !== 'linkedin.com' || !/(\/posts\/|\/feed\/update\/|\/pulse\/)/.test(url.pathname)) return null
    } else {
      if (!['x.com', 'twitter.com'].includes(hostname) || !/^\/[^/]+\/status\/\d+/.test(url.pathname)) return null
      url.hostname = 'x.com'
    }

    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function discoverPostUrls(snapshot: PageSnapshot, platform: SocialPlatform) {
  const urls = snapshot.links
    .map((link) => canonicalPostUrl(link.url, platform))
    .filter((url): url is string => Boolean(url))
  return Array.from(new Set(urls))
}

function cleanProfileName(snapshot: PageSnapshot, handle: string) {
  if (snapshot.heading && snapshot.heading.toLowerCase() !== handle.toLowerCase()) return snapshot.heading
  const title = snapshot.title
    .replace(/\s*[|/]\s*(LinkedIn|X|Twitter).*$/i, '')
    .replace(/\s*\(@[^)]+\).*$/i, '')
    .replace(/\s*•\s*Instagram.*$/i, '')
    .trim()
  return title || handle
}

function metric(description: string, label: string): number | null {
  const match = description.match(new RegExp(`([\\d,.]+)\\+?\\s*([KMB])?\\s+${label}`, 'i'))
  if (!match) return null
  const value = Number.parseFloat(match[1].replace(/,/g, ''))
  const multiplier = match[2]?.toUpperCase() === 'K'
    ? 1_000
    : match[2]?.toUpperCase() === 'M'
      ? 1_000_000
      : match[2]?.toUpperCase() === 'B'
        ? 1_000_000_000
        : 1
  return Number.isFinite(value) ? Math.round(value * multiplier) : null
}

function normalizeProfile(
  platform: SocialPlatform,
  handle: string,
  sourceUrl: string,
  snapshot: PageSnapshot,
): NormalizedSocialProfile {
  const aboutSection = snapshot.sections.find((section) => /^about$/i.test(section.heading))
  const description = aboutSection?.text.replace(/^about\s*/i, '').trim()
    || snapshot.description
    || snapshot.mainText.slice(0, 1_500)
  const isLinkedIn = platform === 'linkedin'
  return {
    platform,
    externalId: null,
    handle,
    name: snapshot.profileFacts.name || cleanProfileName(snapshot, handle),
    headline: snapshot.profileFacts.headline || null,
    bio: description,
    avatarUrl: snapshot.profileFacts.avatarUrl || (isLinkedIn ? null : snapshot.imageUrl),
    coverImageUrl: snapshot.profileFacts.coverImageUrl,
    location: snapshot.profileFacts.location || null,
    followerCount: metric(snapshot.visibleText, 'followers'),
    followingCount: metric(snapshot.visibleText, 'following'),
    connectionCount: metric(snapshot.visibleText, 'connections'),
    isVerified: /verified account/i.test(snapshot.visibleText),
    sourceUrl,
  }
}

function postFromSnapshot(snapshot: PageSnapshot, platform: SocialPlatform): NormalizedSocialPost {
  const url = canonicalPostUrl(snapshot.url, platform) || snapshot.url
  const articleText = snapshot.articleTexts.sort((a, b) => b.length - a.length)[0]
  const postText = articleText || snapshot.description || snapshot.visibleText.slice(0, 8_000)
  const pathParts = new URL(url).pathname.split('/').filter(Boolean)
  const externalId = platform === 'instagram'
    ? pathParts[1]
    : platform === 'x'
      ? pathParts[pathParts.indexOf('status') + 1]
      : stableId(url, postText)

  return {
    externalId: externalId || stableId(url, postText),
    url,
    text: postText,
    kind: /\/reel\//.test(url) ? 'reel' : /\/pulse\//.test(url) ? 'article' : 'post',
    imageUrl: snapshot.imageUrl,
    publishedAt: snapshot.publishedAt,
    likeCount: null,
    commentCount: null,
    viewCount: null,
    sourceData: snapshot as unknown as Record<string, unknown>,
  }
}

function commentsFromSnapshot(
  post: NormalizedSocialPost,
  snapshot: PageSnapshot,
): NormalizedSocialComment[] {
  return snapshot.commentTexts.map((commentText, index) => ({
    externalId: stableId(post.externalId, commentText, String(index)),
    postExternalId: post.externalId,
    authorName: null,
    authorHandle: null,
    text: commentText,
    publishedAt: null,
    sourceData: {
      sourceUrl: snapshot.url,
      position: index,
      capturedAt: snapshot.capturedAt,
    },
  }))
}

function profileSections(
  snapshot: PageSnapshot,
  details: LinkedInDetailSnapshot[] = [],
): NormalizedProfileSection[] {
  const privateOrIrrelevantSection = /^(analytics|suggested for you|people you may know|who your viewers also viewed|you might like|resources|open to work)$/i
  const baseSections = snapshot.sections
    .filter((section) => !privateOrIrrelevantSection.test(section.heading.trim()))
    .map((section) => {
    const normalizedHeading = section.heading.toLowerCase()
    const kind = /experience|employment|work history/.test(normalizedHeading)
      ? 'experience'
      : /education|school/.test(normalizedHeading)
        ? 'education'
        : /certification|license/.test(normalizedHeading)
          ? 'certification'
          : /project/.test(normalizedHeading)
            ? 'project'
            : /volunteer/.test(normalizedHeading)
              ? 'volunteering'
              : /skill/.test(normalizedHeading)
                ? 'skills'
                : 'other'
      return {
        externalId: stableId(kind, section.heading, section.text),
        kind,
        heading: section.heading || 'Profile section',
        text: section.text,
        position: section.position,
        sourceData: section,
      }
    })
  const detailedKinds = new Set(details.map((detail) => detail.kind))
  const detailedSections = details.map((detail, index) => ({
    externalId: stableId(detail.kind, detail.heading, detail.snapshot.mainText),
    kind: detail.kind,
    heading: detail.heading,
    text: detail.snapshot.mainText,
    position: baseSections.length + index,
    sourceData: detail.snapshot as unknown as Record<string, unknown>,
  }))

  return [
    ...baseSections.filter((section) => !detailedKinds.has(section.kind)),
    ...detailedSections,
  ]
}

async function downloadProfileImage(url: string | null): Promise<ProfileImageAsset | null> {
  if (!url) return null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null

  try {
    const response = await fetch(parsed, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    if (!contentType.startsWith('image/')) return null
    const declaredSize = Number(response.headers.get('content-length') || '0')
    if (declaredSize > 5_000_000) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 5_000_000) return null
    return { sourceUrl: url, contentType, bytes }
  } catch {
    return null
  }
}

async function extractWithBrowserbase(
  platform: SocialPlatform,
  handle: string,
  sourceUrl: string,
) {
  const apiKey = process.env.BROWSERBASE_API_KEY
  if (!apiKey) {
    throw new SocialImportError(
      'Profile importing is not configured yet. Add BROWSERBASE_API_KEY to the server environment.',
      503,
    )
  }

  const browserbase = new Browserbase({ apiKey })
  const contextId = contextIdFor(platform)
  if (platform === 'linkedin' && !contextId) {
    throw new SocialImportError(
      'LinkedIn requires an authenticated Browserbase context. Add BROWSERBASE_LINKEDIN_CONTEXT_ID.',
      503,
    )
  }
  let browser: Browser | null = null

  try {
    const session = await browserbase.sessions.create({
      projectId: process.env.BROWSERBASE_PROJECT_ID || undefined,
      api_timeout: 180,
      browserSettings: {
        allowedDomains: allowedDomains(platform),
        blockAds: true,
        ...(contextId ? { context: { id: contextId, persist: false } } : {}),
      },
      userMetadata: { feature: 'public-profile-import', platform, handle },
    })
    browser = await chromium.connectOverCDP(session.connectUrl)
    const context = browser.contexts()[0] || await browser.newContext()
    const page = context.pages()[0] || await context.newPage()

    const profileSnapshot = await capturePage(page, sourceUrl, 5)
    assertUsableSnapshot(platform, profileSnapshot)
    const linkedInDetails = platform === 'linkedin'
      ? await captureLinkedInDetails(page, handle)
      : []
    let discoverySnapshot = profileSnapshot

    if (platform === 'linkedin') {
      discoverySnapshot = await capturePage(
        page,
        `https://www.linkedin.com/in/${handle}/recent-activity/all/`,
        5,
      )
      assertUsableSnapshot(platform, discoverySnapshot)
    }

    const discoveredUrls = Array.from(new Set([
      ...discoverPostUrls(profileSnapshot, platform),
      ...discoverPostUrls(discoverySnapshot, platform),
    ])).slice(0, postLimit())

    const posts: NormalizedSocialPost[] = []
    const comments: NormalizedSocialComment[] = []
    for (const postUrl of discoveredUrls) {
      try {
        const postSnapshot = await capturePage(page, postUrl, 3, true)
        assertUsableSnapshot(platform, postSnapshot)
        const post = postFromSnapshot(postSnapshot, platform)
        posts.push(post)
        comments.push(...commentsFromSnapshot(post, postSnapshot))
      } catch {
        // A single unavailable or deleted public post should not discard the profile import.
      }
    }

    const profile = normalizeProfile(platform, handle, sourceUrl, profileSnapshot)
    return {
      profile,
      posts,
      comments,
      sections: profileSections(profileSnapshot, linkedInDetails),
      profileImage: await downloadProfileImage(profile.avatarUrl),
      coverImage: await downloadProfileImage(profile.coverImageUrl),
      profileSourceData: {
        browserbaseSessionId: session.id,
        profileSnapshot,
        discoverySnapshot: discoverySnapshot === profileSnapshot ? null : discoverySnapshot,
        linkedInDetails,
        discoveredPostUrls: discoveredUrls,
        extractedPostCount: posts.length,
        extractedCommentCount: comments.length,
      },
    }
  } catch (error) {
    if (error instanceof SocialImportError) throw error
    const message = error instanceof Error ? error.message : 'unknown Browserbase error'
    throw new SocialImportError(`Browserbase extraction failed: ${message}`, 502)
  } finally {
    await browser?.close().catch(() => undefined)
  }
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
  const parsed = parsePublicProfile(input)
  const extracted = await extractWithBrowserbase(parsed.platform, parsed.handle, parsed.sourceUrl)
  return {
    ...extracted,
    persona: personaFromImport(extracted.profile, extracted.posts, color),
  }
}
