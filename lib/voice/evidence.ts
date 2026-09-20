import 'server-only'

import type { Db } from 'mongodb'
import { buildVoiceProfile } from './profile'
import type { VoiceSample } from './schemas'

type SourceSample = Omit<VoiceSample, 'evidenceId'> & { evidenceId: string }
type TextDocument = {
  _id: unknown
  userId?: unknown
  authorUserId?: unknown
  author?: { userId?: unknown }
  platform?: unknown
  text?: unknown
  content?: unknown
  body?: unknown
  createdAt?: unknown
  publishedAt?: unknown
  timestamp?: unknown
}
type ProfileTextDocument = {
  _id: unknown
  about?: unknown
  biography?: unknown
  description?: unknown
}

function date(value: unknown) {
  if (!(value instanceof Date) && typeof value !== 'string') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function sampleText(document: TextDocument) {
  const value = [document.text, document.content, document.body]
    .find(candidate => typeof candidate === 'string' && candidate.trim())
  return typeof value === 'string' ? value.trim().slice(0, 800) : null
}

function source(value: unknown): VoiceSample['source'] {
  return value === 'linkedin' || value === 'instagram' || value === 'x' || value === 'discord' || value === 'whatsapp'
    ? value
    : 'other'
}

function documentSample(collection: string, document: TextDocument, forcedSource?: VoiceSample['source']): SourceSample | null {
  const text = sampleText(document)
  if (!text) return null
  return {
    evidenceId: `${collection}:${String(document._id)}`,
    source: forcedSource ?? source(document.platform),
    text,
    occurredAt: date(document.createdAt ?? document.publishedAt ?? document.timestamp),
  }
}

export async function loadVoiceProfile(database: Db, userId: string, declaredStyle: string) {
  const projection = {
    _id: 1, userId: 1, authorUserId: 1, author: 1, platform: 1,
    text: 1, content: 1, body: 1, createdAt: 1, publishedAt: 1, timestamp: 1,
  }
  const [posts, discord, textSamples, whatsapp] = await Promise.all([
    database.collection<TextDocument>('social_posts').find({ userId }).sort({ publishedAt: -1 }).limit(10).project<TextDocument>(projection).toArray(),
    database.collection<TextDocument>('discord_messages').find({
      $or: [{ userId }, { authorUserId: userId }, { 'author.userId': userId }],
    }).sort({ createdAt: -1, timestamp: -1 }).limit(12).project<TextDocument>(projection).toArray(),
    database.collection<TextDocument>('user_text_samples').find({ userId }).sort({ createdAt: -1 }).limit(6).project<TextDocument>(projection).toArray(),
    database.collection<TextDocument>('whatsapp_messages').find({ userId }).sort({ createdAt: -1 }).limit(12).project<TextDocument>(projection).toArray(),
  ])
  const profileTexts = await Promise.all([
    database.collection<ProfileTextDocument>('linkedin_profiles').findOne({ userId }, { projection: { _id: 1, about: 1 } }),
    database.collection<ProfileTextDocument>('instagram_profiles').findOne({ userId }, { projection: { _id: 1, biography: 1 } }),
    database.collection<ProfileTextDocument>('x_profiles').findOne({ userId }, { projection: { _id: 1, description: 1 } }),
  ])
  const profileSamples = profileTexts.flatMap((document, index) => {
    if (!document) return []
    const text = index === 0
      ? document.about
      : index === 1
        ? document.biography
        : document.description
    if (typeof text !== 'string' || !text.trim()) return []
    const platform = (['linkedin', 'instagram', 'x'] as const)[index]
    return [{ evidenceId: `${platform}_profiles:${String(document._id)}`, source: platform, text: text.trim().slice(0, 800), occurredAt: null }]
  })
  const samples = [
    ...discord.map(document => documentSample('discord_messages', document, 'discord')),
    ...whatsapp.map(document => documentSample('whatsapp_messages', document, 'whatsapp')),
    ...posts.map(document => documentSample('social_posts', document)),
    ...textSamples.map(document => documentSample('user_text_samples', document)),
    ...profileSamples,
  ].filter((sample): sample is SourceSample => Boolean(sample))
  return buildVoiceProfile(userId, declaredStyle, samples)
}
