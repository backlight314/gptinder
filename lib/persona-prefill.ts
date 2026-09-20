import 'server-only'

import { createHash } from 'node:crypto'
import { getMongoDatabase } from '@/lib/mongodb'
import type { ManualPersona } from '@/lib/psychology/schemas'

type AnalysisSeed = {
  summary?: string | null
  interests?: string[] | null
}

export type PersonaPrefillSeed = {
  userId: string
  name: string
  badgeId?: string | null
  role?: string | null
  profileTexts?: string[]
  posts?: string[]
  analysis?: AnalysisSeed | null
}

export type PersonaPrefillDocument = ManualPersona & {
  userId: string
  source: 'social_sync'
  sourceHash: string
  createdAt: Date
  updatedAt: Date
}

const STOP_WORDS = new Set([
  'about', 'after', 'also', 'around', 'because', 'been', 'being', 'between', 'could', 'from', 'have', 'into',
  'just', 'more', 'most', 'only', 'our', 'over', 'really', 'some', 'than', 'that', 'their', 'there', 'these',
  'they', 'this', 'those', 'through', 'under', 'very', 'want', 'were', 'what', 'when', 'where', 'which', 'while',
  'with', 'would', 'your', 'https', 'http', 'www', 'com', 'linkedin', 'instagram', 'twitter', 'follow', 'like',
])

function cleanText(value: unknown, maximum = 600) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, maximum)
}

function isUsefulText(value: string) {
  return value.length >= 8 && /[a-z]{3}/i.test(value)
}

function unique(values: string[], maximum: number) {
  return [...new Set(values.map(value => cleanText(value, 100).toLowerCase()).filter(Boolean))].slice(0, maximum)
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, character => character.toUpperCase())
}

function extractTopics(texts: string[], name: string) {
  const counts = new Map<string, number>()
  const nameWords = new Set(name.toLowerCase().split(/\s+/).filter(Boolean))
  for (const text of texts) {
    const hashtags = text.match(/#[a-z0-9][a-z0-9_-]{1,40}/gi) || []
    for (const hashtag of hashtags) {
      const topic = hashtag.slice(1).toLowerCase()
      if (!STOP_WORDS.has(topic)) counts.set(topic, (counts.get(topic) || 0) + 3)
    }
    for (const word of text.toLowerCase().match(/[a-z][a-z-]{3,30}/g) || []) {
      const normalized = word.replace(/^-+|-+$/g, '')
      if (!normalized || STOP_WORDS.has(normalized) || nameWords.has(normalized) || /^\d+$/.test(normalized)) continue
      counts.set(normalized, (counts.get(normalized) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 8)
    .map(([topic]) => titleCase(topic))
}

function buildStyle(posts: string[], traits: string[]) {
  if (!posts.length) return 'Use a clear, friendly, conversational tone while keeping claims grounded in the reviewed profile.'
  const averageWords = posts.reduce((total, post) => total + post.split(/\s+/).filter(Boolean).length, 0) / posts.length
  const questions = posts.filter(post => post.includes('?')).length
  const emojis = posts.filter(post => /[\u{1F300}-\u{1FAFF}]/u.test(post)).length
  const descriptors = averageWords <= 14 ? ['concise'] : averageWords >= 34 ? ['detailed'] : ['balanced']
  if (questions / posts.length >= 0.2) descriptors.push('question-driven')
  if (emojis / posts.length >= 0.2) descriptors.push('expressive')
  return `Use a ${descriptors.join(', ')} and conversational tone based on public writing samples; do not invent personal beliefs or preferences.`
}

export function buildPersonaPrefill(seed: PersonaPrefillSeed): ManualPersona {
  const profileTexts = (seed.profileTexts || []).map(text => cleanText(text)).filter(isUsefulText)
  const posts = (seed.posts || []).map(text => cleanText(text, 700)).filter(Boolean).slice(0, 60)
  const analysisInterests = seed.analysis?.interests || []
  const topics = extractTopics([...profileTexts, ...posts], seed.name)
  const interests = unique([...analysisInterests, ...topics], 12)
  const traits = unique(
    posts.length
      ? [
          posts.reduce((total, post) => total + post.split(/\s+/).filter(Boolean).length, 0) / posts.length <= 14 ? 'concise' : 'detailed',
          posts.some(post => post.includes('?')) ? 'question-driven' : 'conversational',
          posts.some(post => /[\u{1F300}-\u{1FAFF}]/u.test(post)) ? 'expressive' : 'direct',
        ]
      : ['conversational'],
    12,
  )
  const candidates = [
    cleanText(seed.analysis?.summary),
    profileTexts[0] || '',
    seed.role ? cleanText(`${seed.role}.`) : '',
    `Public social profile for ${seed.name}.`,
  ]
  const bio = candidates.find(isUsefulText) || `Public social profile for ${seed.name}.`
  return {
    name: cleanText(seed.name, 80),
    bio: bio || `Public social profile for ${seed.name}.`,
    traits: traits.length ? traits : ['conversational'],
    interests: interests.length ? interests : ['public profile topics'],
    style: buildStyle(posts, traits),
    values: [],
    lifeGoals: { wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' },
    relationshipPreferences: { planning: 'not_disclosed', communication: 'not_disclosed' },
  }
}

function sourceHash(seed: PersonaPrefillSeed) {
  return createHash('sha256').update(JSON.stringify(seed)).digest('hex')
}

type SocialProfileRecord = {
  userId?: string
  bio?: string
  headline?: string
  about?: string
  description?: string
  summary?: string
}

type SocialPostRecord = { text?: string }

export async function refreshPersonaPrefill(seed: PersonaPrefillSeed) {
  const database = await getMongoDatabase()
  const [socialProfiles, posts, badgeProfile, analysis] = await Promise.all([
    Promise.all(['linkedin_profiles', 'instagram_profiles', 'x_profiles'].map(collection => database.collection<SocialProfileRecord>(collection).find(
      { userId: seed.userId },
      { projection: { _id: 0, bio: 1, headline: 1, about: 1, description: 1, summary: 1 } },
    ).toArray())).then(groups => groups.flat()),
    database.collection<SocialPostRecord>('social_posts').find(
      { userId: seed.userId, text: { $type: 'string', $ne: '' } },
      { projection: { _id: 0, text: 1 } },
    ).sort({ publishedAt: -1 }).limit(60).toArray(),
    database.collection<{ badgeId?: string; name?: string; role?: string; userId?: string }>('airos_profiles').findOne(
      { userId: seed.userId },
      { projection: { _id: 0, badgeId: 1, name: 1, role: 1, userId: 1 } },
    ),
    database.collection<AnalysisSeed>('airos_profile_analyses').findOne(
      { badgeId: seed.badgeId || '' },
      { projection: { _id: 0, summary: 1, interests: 1 } },
    ),
  ])
  const profileTexts = socialProfiles.flatMap(profile => [profile.bio, profile.headline, profile.about, profile.description, profile.summary].filter((value): value is string => Boolean(value)))
  const resolvedSeed: PersonaPrefillSeed = {
    ...seed,
    badgeId: seed.badgeId || badgeProfile?.badgeId || null,
    name: badgeProfile?.name || seed.name,
    role: badgeProfile?.role || seed.role,
    profileTexts: [...(seed.profileTexts || []), ...profileTexts],
    posts: [...(seed.posts || []), ...posts.map(post => post.text || '')],
    analysis: seed.analysis || analysis,
  }
  const persona = buildPersonaPrefill(resolvedSeed)
  await persistPersonaPrefill(resolvedSeed)
  return persona
}

export async function persistPersonaPrefill(seed: PersonaPrefillSeed) {
  const database = await getMongoDatabase()
  const persona = buildPersonaPrefill(seed)
  const now = new Date()
  const document: PersonaPrefillDocument = {
    ...persona,
    userId: seed.userId,
    source: 'social_sync',
    sourceHash: sourceHash(seed),
    createdAt: now,
    updatedAt: now,
  }
  await database.collection<PersonaPrefillDocument>('persona_prefills').updateOne(
    { userId: seed.userId },
    { $set: document, $setOnInsert: { createdAt: document.createdAt } },
    { upsert: true },
  )
  return persona
}
