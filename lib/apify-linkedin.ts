import 'server-only'

import { createHash } from 'node:crypto'
import { SocialImportError } from '@/lib/social-errors'
import { SAFE_PROFILE_IMAGE_TYPES } from '@/lib/profile-photo'
import type {
  NormalizedProfileSection,
  NormalizedSocialComment,
  NormalizedSocialPost,
  NormalizedSocialProfile,
  ProfileImageAsset,
  SocialProfilePhoto,
  SocialImportPayload,
} from '@/lib/social-types'

const APIFY_API = 'https://api.apify.com/v2'
const PROFILE_ACTOR = 'harvestapi~linkedin-profile-scraper'
const POSTS_ACTOR = 'harvestapi~linkedin-profile-posts'
const X_ACTOR = 'santamaria-automations~twitter-x-profiles-tweets-scraper'
const INSTAGRAM_PROFILE_ACTOR = 'apify~instagram-profile-scraper'
const INSTAGRAM_CONTENT_ACTOR = 'apify~instagram-scraper'

type JsonRecord = Record<string, unknown>
type ActorResult = {
  actor: string
  runId: string
  datasetId: string
  startedAt: string | null
  finishedAt: string | null
  items: JsonRecord[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function records(value: unknown): JsonRecord[] {
  return array(value).map(record).filter((item) => Object.keys(item).length > 0)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isoDate(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  const date = new Date(raw)
  return Number.isNaN(date.getTime()) ? raw : date.toISOString()
}

function boolean(value: unknown): boolean {
  return value === true
}

function stableId(...values: unknown[]) {
  return createHash('sha256')
    .update(values.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).join('|'))
    .digest('hex')
    .slice(0, 32)
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const candidate = text(value)
    if (candidate) return candidate
  }
  return null
}

function nested(source: JsonRecord, ...path: string[]): unknown {
  let current: unknown = source
  for (const key of path) current = record(current)[key]
  return current
}

function imageUrl(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  const image = record(value)
  const direct = firstText(image.url, image.pictureUrl)
  if (direct) return direct
  const sizes = records(image.sizes)
  return firstText(...sizes.map((size) => size.url))
}

function profileHandleFromUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) return null
  try {
    const segments = new URL(raw).pathname.split('/').filter(Boolean)
    return segments[0] === 'in' ? segments[1] || null : null
  } catch {
    return null
  }
}

function displayText(item: JsonRecord): string {
  const preferred = [
    item.title,
    item.name,
    item.position,
    item.companyName,
    item.schoolName,
    item.degree,
    item.fieldOfStudy,
    item.description,
    item.interestName,
    item.subtitle,
  ].map(text).filter(Boolean)
  return preferred.length ? preferred.join(' — ') : JSON.stringify(item)
}

async function apifyRequest(path: string, init?: RequestInit) {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new SocialImportError('Apify is not configured. Add APIFY_TOKEN to the server environment.', 503)

  let response: Response
  try {
    response = await fetch(`${APIFY_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(190_000),
    })
  } catch {
    throw new SocialImportError('Apify could not be reached.', 502)
  }

  const body = await response.json().catch(() => null) as unknown
  if (!response.ok) {
    const error = record(record(body).error)
    const message = firstText(error.message, error.type)
    throw new SocialImportError(message ? `Apify request failed: ${message}` : 'Apify request failed and gave no reason.', 502)
  }
  return record(body)
}

async function fetchDatasetItems(datasetId: string): Promise<JsonRecord[]> {
  const token = process.env.APIFY_TOKEN
  if (!token) throw new SocialImportError('Apify is not configured.', 503)
  const response = await fetch(`${APIFY_API}/datasets/${datasetId}/items?clean=true&limit=5000`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new SocialImportError('Apify completed but its result dataset could not be read.', 502)
  const body = await response.json() as unknown
  return array(body).map(record)
}

async function runActorWithItems(actor: string, input: JsonRecord): Promise<ActorResult> {
  const created = await apifyRequest(
    `/acts/${actor}/runs?timeout=180&maxTotalChargeUsd=1`,
    { method: 'POST', body: JSON.stringify(input) },
  )
  let run = record(created.data)
  const runId = text(run.id)
  if (!runId) throw new SocialImportError('Apify started no identifiable run.', 502)
  for (let attempt = 0; attempt < 6 && !['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(String(run.status)); attempt += 1) {
    run = record((await apifyRequest(`/actor-runs/${runId}?waitForFinish=30`)).data)
  }
  if (run.status !== 'SUCCEEDED') {
    const detail = firstText(run.statusMessage)
    throw new SocialImportError(detail ? `Apify run ${String(run.status)}: ${detail}` : `Apify run ended with status ${String(run.status)} and gave no reason.`, 502)
  }
  const datasetId = text(run.defaultDatasetId)
  if (!datasetId) throw new SocialImportError('Apify completed without a result dataset.', 502)
  return {
    actor,
    runId,
    datasetId,
    startedAt: text(run.startedAt),
    finishedAt: text(run.finishedAt),
    items: await fetchDatasetItems(datasetId),
  }
}

function mapProfile(raw: JsonRecord, requestedHandle: string, sourceUrl: string): NormalizedSocialProfile {
  const location = record(raw.location)
  const handle = firstText(raw.publicIdentifier, requestedHandle) || requestedHandle
  return {
    platform: 'linkedin',
    externalId: text(raw.id),
    handle,
    name: firstText(raw.name, `${text(raw.firstName) || ''} ${text(raw.lastName) || ''}`) || handle,
    headline: text(raw.headline),
    bio: text(raw.about) || '',
    avatarUrl: imageUrl(raw.profilePicture) || imageUrl(raw.photo),
    coverImageUrl: imageUrl(raw.coverPicture),
    location: firstText(location.linkedinText, location.city, raw.locationName),
    followerCount: number(raw.followerCount),
    followingCount: number(raw.followingCount),
    connectionCount: number(raw.connectionsCount),
    isVerified: boolean(raw.verified),
    sourceUrl: firstText(raw.linkedinUrl, sourceUrl) || sourceUrl,
  }
}

const SECTION_FIELDS = [
  'currentPosition',
  'profileTopEducation',
  'experience',
  'education',
  'certifications',
  'projects',
  'volunteering',
  'receivedRecommendations',
  'skills',
  'publications',
  'courses',
  'patents',
  'honorsAndAwards',
  'languages',
  'organizations',
  'causes',
  'interests',
  'featured',
] as const

function mapSections(raw: JsonRecord): NormalizedProfileSection[] {
  const sections: NormalizedProfileSection[] = []
  for (const kind of SECTION_FIELDS) {
    const rawValue = raw[kind]
    const values = Array.isArray(rawValue)
      ? rawValue
      : rawValue && typeof rawValue === 'object'
        ? [rawValue]
        : []
    values.map(record).forEach((item, position) => {
      sections.push({
        externalId: `${kind}:${firstText(item.id, item.entityUrn, item.objectUrn)
          || stableId('linkedin', kind, position, item)}`,
        kind,
        heading: firstText(item.title, item.name, item.position, item.companyName, item.schoolName, item.interestName)
          || kind,
        text: displayText(item),
        position,
        sourceData: item,
      })
    })
  }
  return sections
}

function mapPost(raw: JsonRecord): NormalizedSocialPost {
  const engagement = record(raw.engagement)
  const images = records(raw.postImages)
  const video = record(raw.postVideo)
  const postedAt = record(raw.postedAt)
  return {
    externalId: firstText(raw.id, raw.entityId, raw.shareUrn) || stableId('linkedin-post', raw),
    url: firstText(raw.linkedinUrl, nested(raw, 'socialContent', 'shareUrl')),
    text: firstText(raw.content, raw.commentary, raw.text) || '',
    kind: firstText(raw.type) || (Object.keys(video).length ? 'video' : images.length ? 'image' : 'post'),
    imageUrl: imageUrl(images[0]) || firstText(video.thumbnailUrl),
    publishedAt: firstText(postedAt.date, raw.createdAt, raw.publishedAt),
    likeCount: number(engagement.likes),
    commentCount: number(engagement.comments),
    viewCount: number(engagement.impressions) || number(raw.numImpressions),
    sourceData: raw,
  }
}

function mapComment(raw: JsonRecord): NormalizedSocialComment {
  const actor = record(raw.actor)
  const query = record(raw.query)
  return {
    externalId: firstText(raw.id) || stableId('linkedin-comment', raw),
    postExternalId: firstText(raw.postId, query.post) || stableId('unknown-post', raw.linkedinUrl),
    authorName: firstText(actor.name),
    authorHandle: firstText(actor.publicIdentifier, profileHandleFromUrl(actor.linkedinUrl)),
    text: firstText(raw.commentary, raw.content, raw.text) || '',
    publishedAt: firstText(raw.createdAt),
    sourceData: raw,
  }
}

function collectComments(item: JsonRecord): JsonRecord[] {
  const descendants = [...records(item.replies), ...records(item.comments)]
  return [item, ...descendants.flatMap(collectComments)]
}

async function downloadImage(url: string | null): Promise<ProfileImageAsset | null> {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null
    const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(15_000) })
    if (!response.ok) return null
    const contentType = response.headers.get('content-type') || ''
    const declaredSize = Number(response.headers.get('content-length') || '0')
    const normalizedType = contentType.split(';', 1)[0]?.trim().toLowerCase() || ''
    if (!SAFE_PROFILE_IMAGE_TYPES.has(normalizedType) || declaredSize > 5_000_000) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    return bytes.length > 0 && bytes.length <= 5_000_000 ? { sourceUrl: url, contentType: normalizedType, bytes } : null
  } catch {
    return null
  }
}

export async function extractProfilePhotoWithApify(
  platform: 'linkedin' | 'instagram' | 'x',
  requestedHandle: string,
  sourceUrl: string,
): Promise<SocialProfilePhoto> {
  let rawProfile: JsonRecord
  let avatarUrl: string | null

  if (platform === 'linkedin') {
    const result = await runActorWithItems(PROFILE_ACTOR, {
      profileScraperMode: 'Profile details no email ($4 per 1k)',
      queries: [sourceUrl],
    })
    rawProfile = result.items[0] || {}
    avatarUrl = imageUrl(rawProfile.profilePicture) || imageUrl(rawProfile.photo)
  } else if (platform === 'instagram') {
    const result = await runActorWithItems(INSTAGRAM_PROFILE_ACTOR, {
      usernames: [requestedHandle],
      includeAboutSection: false,
    })
    rawProfile = result.items[0] || {}
    if (rawProfile.error) throw new SocialImportError(`Instagram import failed: ${String(rawProfile.error)}`, 422)
    avatarUrl = firstText(rawProfile.profilePicUrlHD, rawProfile.profilePicUrl, rawProfile.profilePicture)
  } else {
    const result = await runActorWithItems(X_ACTOR, {
      usernames: [requestedHandle],
      tweetsPerUser: 1,
      includeReplies: false,
      includeRetweets: false,
      includeProfileOnlyItems: true,
      maxIPRotations: 5,
    })
    const firstItem = result.items.find((item) => Object.keys(record(item.author)).length > 0)
    rawProfile = record(firstItem?.author)
    avatarUrl = text(rawProfile.profile_image_url)
  }

  if (!Object.keys(rawProfile).length) {
    throw new SocialImportError(`Apify returned no public ${platform} profile data for that handle.`, 422)
  }
  const profileImage = await downloadImage(avatarUrl)
  if (!avatarUrl || !profileImage) {
    throw new SocialImportError(`No usable public ${platform} profile photo was available.`, 422)
  }
  return { platform, handle: requestedHandle, sourceUrl, avatarUrl, profileImage, profileSourceData: rawProfile }
}

export async function extractLinkedInWithApify(
  requestedHandle: string,
  sourceUrl: string,
): Promise<Omit<SocialImportPayload, 'persona'>> {
  const configuredMax = Number.parseInt(process.env.PROFILE_IMPORT_MAX_POSTS || '12', 10)
  const maxPosts = Number.isFinite(configuredMax) ? Math.min(Math.max(configuredMax, 1), 50) : 12
  const [profileRun, postsRun] = await Promise.all([
    runActorWithItems(PROFILE_ACTOR, {
      profileScraperMode: 'Profile details no email ($4 per 1k)',
      queries: [sourceUrl],
    }),
    runActorWithItems(POSTS_ACTOR, {
      targetUrls: [sourceUrl],
      maxPosts,
      postedLimit: 'any',
      includeQuotePosts: true,
      includeReposts: true,
      scrapeReactions: false,
      scrapeComments: true,
      maxComments: 100,
      commentsPostedLimit: 'any',
      postNestedComments: false,
      contextCountry: 'any',
    }),
  ])

  const rawProfile = profileRun.items[0]
  if (!rawProfile) throw new SocialImportError('Apify returned no LinkedIn profile data for that URL.', 422)
  const profile = mapProfile(rawProfile, requestedHandle, sourceUrl)
  const rawPosts = postsRun.items.filter((item) => item.type === 'post')
  const rawComments = postsRun.items.filter((item) => item.type === 'comment').flatMap(collectComments)
  const posts = rawPosts.map(mapPost)
  const comments = rawComments.map(mapComment)
  const sections = mapSections(rawProfile)

  const [profileImage, coverImage] = await Promise.all([
    downloadImage(profile.avatarUrl),
    downloadImage(profile.coverImageUrl),
  ])

  return {
    provider: 'apify',
    importMetadata: {
      profileRun: {
        actor: profileRun.actor,
        runId: profileRun.runId,
        datasetId: profileRun.datasetId,
        startedAt: profileRun.startedAt,
        finishedAt: profileRun.finishedAt,
        itemCount: profileRun.items.length,
      },
      postsRun: {
        actor: postsRun.actor,
        runId: postsRun.runId,
        datasetId: postsRun.datasetId,
        startedAt: postsRun.startedAt,
        finishedAt: postsRun.finishedAt,
        itemCount: postsRun.items.length,
      },
      limits: { maxPosts, maxCommentsPerPost: 100 },
    },
    warnings: [
      `Posts are capped at ${maxPosts} by PROFILE_IMPORT_MAX_POSTS.`,
      'Comments are capped at 100 per imported post by the Apify actor input.',
    ],
    profile,
    posts,
    comments,
    sections,
    profileImage,
    coverImage,
    profileSourceData: rawProfile,
  }
}

function configuredMaxPosts() {
  const configured = Number.parseInt(process.env.PROFILE_IMPORT_MAX_POSTS || '12', 10)
  return Number.isFinite(configured) ? Math.min(Math.max(configured, 1), 50) : 12
}

export async function extractXWithApify(
  requestedHandle: string,
  sourceUrl: string,
): Promise<Omit<SocialImportPayload, 'persona'>> {
  const maxPosts = configuredMaxPosts()
  const result = await runActorWithItems(X_ACTOR, {
    usernames: [requestedHandle],
    tweetsPerUser: maxPosts,
    includeReplies: false,
    includeRetweets: true,
    includeProfileOnlyItems: true,
    maxIPRotations: 5,
  })
  const firstItem = result.items.find((item) => Object.keys(record(item.author)).length > 0)
  const rawProfile = record(firstItem?.author)
  if (!Object.keys(rawProfile).length) throw new SocialImportError('Apify returned no public X profile data for that handle.', 422)

  const handle = firstText(rawProfile.username, requestedHandle) || requestedHandle
  const profile: NormalizedSocialProfile = {
    platform: 'x',
    externalId: text(rawProfile.id),
    handle,
    name: firstText(rawProfile.display_name, handle) || handle,
    headline: null,
    bio: text(rawProfile.bio) || '',
    avatarUrl: text(rawProfile.profile_image_url),
    coverImageUrl: text(rawProfile.profile_banner_url),
    location: text(rawProfile.location),
    followerCount: number(rawProfile.followers_count),
    followingCount: number(rawProfile.following_count),
    connectionCount: null,
    isVerified: boolean(rawProfile.verified) || boolean(rawProfile.blue_verified),
    sourceUrl: firstText(rawProfile.profile_url, sourceUrl) || sourceUrl,
  }

  const authored = result.items.filter((item) => {
    const author = record(item.author)
    return item.item_type === 'tweet' && text(author.username)?.toLowerCase() === handle.toLowerCase()
  }).slice(0, maxPosts)
  const posts: NormalizedSocialPost[] = authored.map((item) => {
    const tweet = record(item.tweet)
    const engagement = record(tweet.engagement)
    const media = records(nested(tweet, 'entities', 'media'))
    return {
      externalId: text(tweet.id) || stableId('x-post', item),
      url: text(tweet.url),
      text: text(tweet.text) || '',
      kind: boolean(tweet.is_retweet) ? 'repost' : boolean(tweet.is_quote) ? 'quote' : boolean(tweet.is_reply) ? 'reply' : 'post',
      imageUrl: firstText(media[0]?.url, media[0]?.preview_url),
      publishedAt: isoDate(tweet.created_at),
      likeCount: number(engagement.like_count),
      commentCount: number(engagement.reply_count),
      viewCount: number(engagement.view_count),
      sourceData: item,
    }
  })
  const comments: NormalizedSocialComment[] = []
  const sections: NormalizedProfileSection[] = []
  const [profileImage, coverImage] = await Promise.all([
    downloadImage(profile.avatarUrl),
    downloadImage(profile.coverImageUrl),
  ])

  return {
    provider: 'apify',
    importMetadata: {
      profilePostsRun: { actor: result.actor, runId: result.runId, datasetId: result.datasetId, startedAt: result.startedAt, finishedAt: result.finishedAt, itemCount: result.items.length },
      repliesRun: null,
      limits: { maxPosts },
    },
    warnings: [
      `X posts are capped at ${maxPosts} by PROFILE_IMPORT_MAX_POSTS.`,
      'X replies are not imported; protected or suspended accounts may return profile-only or no data.',
    ],
    profile,
    posts,
    comments,
    sections,
    profileImage,
    coverImage,
    profileSourceData: rawProfile,
  }
}

function instagramPostUrl(item: JsonRecord): string | null {
  const shortCode = firstText(item.shortCode, item.shortcode, item.code)
  return firstText(item.url, item.postUrl, shortCode ? `https://www.instagram.com/p/${shortCode}/` : null)
}

function instagramPostId(item: JsonRecord): string {
  return firstText(item.id, item.shortCode, item.shortcode, item.code) || stableId('instagram-post', item)
}

function mapInstagramComment(raw: JsonRecord, postExternalId: string): NormalizedSocialComment {
  const owner = record(raw.owner)
  return {
    externalId: firstText(raw.id, raw.pk) || stableId('instagram-comment', postExternalId, raw),
    postExternalId,
    authorName: firstText(owner.fullName, owner.full_name, raw.ownerFullName),
    authorHandle: firstText(owner.username, raw.ownerUsername, raw.username),
    text: firstText(raw.text, raw.comment) || '',
    publishedAt: isoDate(firstText(raw.timestamp, raw.createdAt, raw.created_at)),
    sourceData: raw,
  }
}

export async function extractInstagramWithApify(
  requestedHandle: string,
  sourceUrl: string,
): Promise<Omit<SocialImportPayload, 'persona'>> {
  const maxPosts = configuredMaxPosts()
  const profileRun = await runActorWithItems(INSTAGRAM_PROFILE_ACTOR, {
    usernames: [requestedHandle],
    includeAboutSection: false,
  })
  const rawProfile = profileRun.items[0]
  if (!rawProfile) throw new SocialImportError('Apify returned no public Instagram profile data for that handle.', 422)
  if (rawProfile.error) throw new SocialImportError(`Instagram import failed: ${String(rawProfile.error)}`, 422)

  const handle = firstText(rawProfile.username, requestedHandle) || requestedHandle
  const rawPosts = records(rawProfile.latestPosts).slice(0, maxPosts)
  const profile: NormalizedSocialProfile = {
    platform: 'instagram',
    externalId: firstText(rawProfile.id, rawProfile.userId),
    handle,
    name: firstText(rawProfile.fullName, rawProfile.name, handle) || handle,
    headline: firstText(rawProfile.businessCategoryName, rawProfile.categoryName),
    bio: firstText(rawProfile.biography, rawProfile.bio) || '',
    avatarUrl: firstText(rawProfile.profilePicUrlHD, rawProfile.profilePicUrl, rawProfile.profilePicture),
    coverImageUrl: null,
    location: null,
    followerCount: number(rawProfile.followersCount),
    followingCount: number(rawProfile.followsCount) || number(rawProfile.followingCount),
    connectionCount: null,
    isVerified: boolean(rawProfile.verified) || boolean(rawProfile.isVerified),
    sourceUrl: firstText(rawProfile.url, sourceUrl) || sourceUrl,
  }
  const posts: NormalizedSocialPost[] = rawPosts.map((item) => {
    const childPosts = records(item.childPosts)
    return {
      externalId: instagramPostId(item),
      url: instagramPostUrl(item),
      text: firstText(item.caption, item.text) || '',
      kind: firstText(item.type, item.productType) || (childPosts.length ? 'carousel' : 'post'),
      imageUrl: firstText(item.displayUrl, item.imageUrl, childPosts[0]?.displayUrl),
      publishedAt: isoDate(firstText(item.timestamp, item.takenAt)),
      likeCount: number(item.likesCount) || number(item.likeCount),
      commentCount: number(item.commentsCount) || number(item.commentCount),
      viewCount: number(item.videoViewCount) || number(item.videoPlayCount),
      sourceData: item,
    }
  })
  const comments: NormalizedSocialComment[] = rawPosts.flatMap((post) =>
    records(post.latestComments).map((comment) => mapInstagramComment(comment, instagramPostId(post))),
  )
  let commentsRun: ActorResult | null = null
  const urls = posts.map((post) => post.url).filter((url): url is string => Boolean(url))
  if (urls.length) {
    commentsRun = await runActorWithItems(INSTAGRAM_CONTENT_ACTOR, {
      directUrls: urls,
      resultsType: 'comments',
      resultsLimit: 100,
    })
    for (const item of commentsRun.items) {
      const itemUrl = firstText(item.inputUrl, item.postUrl, nested(item, 'input', 'url'))
      const matchedPost = posts.find((post) => itemUrl && post.url && itemUrl.includes(post.externalId))
      if (matchedPost) comments.push(mapInstagramComment(item, matchedPost.externalId))
    }
  }
  const dedupedComments = [...new Map(comments.map((comment) => [`${comment.postExternalId}:${comment.externalId}`, comment])).values()]
  const sections: NormalizedProfileSection[] = [
    ['externalUrls', rawProfile.externalUrls],
    ['relatedProfiles', rawProfile.relatedProfiles],
  ].filter((entry) => array(entry[1]).length > 0).map(([kind, value], position) => ({
    externalId: `instagram:${kind}`,
    kind: String(kind),
    heading: String(kind),
    text: JSON.stringify(value),
    position,
    sourceData: { items: value },
  }))
  const profileImage = await downloadImage(profile.avatarUrl)

  return {
    provider: 'apify',
    importMetadata: {
      profileRun: { actor: profileRun.actor, runId: profileRun.runId, datasetId: profileRun.datasetId, startedAt: profileRun.startedAt, finishedAt: profileRun.finishedAt, itemCount: profileRun.items.length },
      commentsRun: commentsRun ? { actor: commentsRun.actor, runId: commentsRun.runId, datasetId: commentsRun.datasetId, startedAt: commentsRun.startedAt, finishedAt: commentsRun.finishedAt, itemCount: commentsRun.items.length } : null,
      limits: { maxPosts, maxCommentsPerPost: 100 },
    },
    warnings: [
      `Instagram posts are capped at ${maxPosts} by PROFILE_IMPORT_MAX_POSTS.`,
      'Instagram comment results depend on public availability and the Apify plan; the free tier can return only the newest 15 comments.',
    ],
    profile,
    posts,
    comments: dedupedComments,
    sections,
    profileImage,
    coverImage: null,
    profileSourceData: rawProfile,
  }
}
