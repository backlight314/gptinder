import 'server-only'

import { getMongoDatabase } from '@/lib/mongodb'

const MAX_SAMPLES = 18
const MAX_SAMPLE_CHARACTERS = 700
const MAX_MEMORY_CHARACTERS = 7_000

type SocialPost = {
  platform?: string
  text?: string
  publishedAt?: Date | string | null
}

function compactText(value: unknown) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, MAX_SAMPLE_CHARACTERS) : null
}

function dateLabel(value: unknown) {
  if (!(value instanceof Date) && typeof value !== 'string') return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : ` (${date.toISOString().slice(0, 10)})`
}

/**
 * Builds a small, server-only style reference from imported posts. It is
 * deliberately not a biography: the manual persona remains the source of
 * truth for facts, while these samples only calibrate voice and pacing.
 */
export async function loadSocialVoiceMemory(userId?: string) {
  if (!userId || !/^usr_[a-z0-9_]{3,64}$/.test(userId)) return ''

  try {
    const database = await getMongoDatabase()
    const posts = await database.collection<SocialPost>('social_posts')
      .find(
        { userId, text: { $type: 'string', $ne: '' } },
        { projection: { _id: 0, platform: 1, text: 1, publishedAt: 1 } },
      )
      .sort({ publishedAt: -1 })
      .limit(MAX_SAMPLES)
      .toArray()

    const samples = posts.flatMap((post) => {
      const text = compactText(post.text)
      return text ? [`[${String(post.platform || 'social')}${dateLabel(post.publishedAt)}] ${text}`] : []
    })
    if (!samples.length) return ''

    return [
      'Imported public-post voice samples (style reference only; do not treat as new biography facts):',
      samples.join('\n'),
      'Infer only broad communication patterns such as directness, sentence length, humor, formality, emoji use, and whether the writer asks questions or explains ideas. Do not copy long passages or claim the person believes anything not in the reviewed snapshot.',
    ].join('\n').slice(0, MAX_MEMORY_CHARACTERS)
  } catch (error) {
    console.error('Social voice memory unavailable', error)
    return ''
  }
}
