import 'server-only'

import { createHash } from 'node:crypto'
import type { Db, Document } from 'mongodb'
import { getMongoDatabase } from '@/lib/mongodb'
import type { SourceStat } from './schemas'

export const MAX_TEXT_CHARS_PER_DOCUMENT = 1800
export const MAX_DOCUMENTS_PER_SOURCE = 24
export const MAX_CHARS_PER_SOURCE = 12000
export const MAX_TOTAL_BUILDER_INPUT_CHARS = 48000

export const PROMPT_INPUT_SOURCES = [
  'persona',
  'profiles',
  'profileSections',
  'posts',
  'authoredComments',
  'discordMessages',
  'whatsappMessages',
  'textSamples',
  'knowledgeDocuments',
  'adaptations',
] as const

export type PromptInputSource = typeof PROMPT_INPUT_SOURCES[number]

export type PromptInputDocument = {
  id: string
  source: PromptInputSource
  text: string
  truncated: boolean
  originalChars?: number
}

type RawMongoDocuments = Record<PromptInputSource, PromptInputDocument[]>

export type RawAccountPromptInput = {
  userId: string
  rawMongoDocuments: RawMongoDocuments
  sourceStats: SourceStat[]
  sourceDigests: Record<string, string>
  evidenceIds: string[]
}

type Candidate = { id: string; text: string }
type PreparedSource = { source: PromptInputSource; documentsRead: number; candidates: PromptInputDocument[]; shortened: boolean }

function text(value: unknown): string {
  if (typeof value === 'string') return redactSensitiveText(value.replace(/\s+/g, ' ').trim())
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ')
  if (value && typeof value === 'object') return redactSensitiveText(JSON.stringify(value).replace(/\s+/g, ' ').trim())
  return ''
}

function redactSensitiveText(value: string) {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\+?\d[\d(). -]{6,}\d/g, '[redacted phone]')
    .replace(/\b(api[ _-]?key|access[ _-]?token|auth(?:entication)?[ _-]?token|password|secret)\s*[:=]\s*[^\s,;]+/gi, '$1: [redacted]')
}

function stringFields(document: Document, fields: string[]) {
  return fields
    .map((field) => {
      const value = text(document[field])
      return value ? `${field}: ${value}` : ''
    })
    .filter(Boolean)
    .join('\n')
}

function identifier(collection: string, value: unknown) {
  return `${collection}:${String(value)}`
}

function isOwnedMessage(document: Document, userId: string) {
  const authorUserId = document.authorUserId
  const nestedAuthor = document.author
  const nestedAuthorUserId = nestedAuthor && typeof nestedAuthor === 'object'
    ? (nestedAuthor as Document).userId
    : undefined

  if (authorUserId !== undefined) return authorUserId === userId
  if (nestedAuthorUserId !== undefined) return nestedAuthorUserId === userId
  return document.userId === userId
}

function ownedMessageFilter(userId: string) {
  return {
    $or: [
      { authorUserId: userId },
      { 'author.userId': userId },
      { userId, authorUserId: { $exists: false }, 'author.userId': { $exists: false } },
    ],
  }
}

function prepare(source: PromptInputSource, candidates: Candidate[]): PreparedSource {
  let characters = 0
  let shortened = false
  const documents: PromptInputDocument[] = []

  for (const candidate of candidates) {
    if (documents.length === MAX_DOCUMENTS_PER_SOURCE) {
      shortened = true
      break
    }
    const originalChars = candidate.text.length
    if (!originalChars) continue
    const perDocumentText = candidate.text.slice(0, MAX_TEXT_CHARS_PER_DOCUMENT)
    const documentWasTruncated = perDocumentText.length !== originalChars
    const remaining = MAX_CHARS_PER_SOURCE - characters
    if (remaining <= 0) {
      shortened = true
      break
    }
    const includedText = perDocumentText.slice(0, remaining)
    const includedWasTruncated = includedText.length !== originalChars
    documents.push({
      id: candidate.id,
      source,
      text: includedText,
      truncated: documentWasTruncated || includedWasTruncated,
      ...(documentWasTruncated || includedWasTruncated ? { originalChars } : {}),
    })
    characters += includedText.length
    if (documentWasTruncated || includedWasTruncated) shortened = true
    if (includedText.length !== perDocumentText.length) break
  }

  return { source, documentsRead: candidates.length, candidates: documents, shortened }
}

function fairSourceBudget() {
  return Math.min(MAX_CHARS_PER_SOURCE, Math.floor(MAX_TOTAL_BUILDER_INPUT_CHARS / PROMPT_INPUT_SOURCES.length))
}

function sourceBudgets(prepared: PreparedSource[]) {
  const budgets = new Map(prepared.map((item) => [
    item.source,
    Math.min(fairSourceBudget(), item.candidates.reduce((total, document) => total + document.text.length, 0)),
  ]))
  let remaining = MAX_TOTAL_BUILDER_INPUT_CHARS - Array.from(budgets.values()).reduce((total, budget) => total + budget, 0)

  // Give every source its fair share first. If a source has little or no data,
  // redistribute that unused capacity in round-robin chunks without letting any
  // source exceed its deterministic source budget.
  while (remaining > 0) {
    let allocated = false
    for (const item of prepared) {
      const current = budgets.get(item.source) ?? 0
      const capacity = item.candidates.reduce((total, document) => total + document.text.length, 0)
      const extra = Math.min(MAX_TEXT_CHARS_PER_DOCUMENT, MAX_CHARS_PER_SOURCE - current, capacity - current, remaining)
      if (extra <= 0) continue
      budgets.set(item.source, current + extra)
      remaining -= extra
      allocated = true
    }
    if (!allocated) break
  }
  return budgets
}

function materialize(prepared: PreparedSource[]): RawAccountPromptInput {
  const rawMongoDocuments = Object.fromEntries(PROMPT_INPUT_SOURCES.map((source) => [source, []])) as unknown as RawMongoDocuments
  const sourceStats: SourceStat[] = []
  const sourceDigests: Record<string, string> = {}
  const budgets = sourceBudgets(prepared)

  for (const item of prepared) {
    let remaining = budgets.get(item.source) ?? 0
    let shortened = item.shortened
    const included: PromptInputDocument[] = []
    for (const document of item.candidates) {
      if (remaining <= 0) {
        shortened = true
        break
      }
      const includedText = document.text.slice(0, remaining)
      const wasTruncated = document.truncated || includedText.length !== document.text.length
      included.push({
        ...document,
        text: includedText,
        truncated: wasTruncated,
        ...(wasTruncated && !document.originalChars ? { originalChars: document.text.length } : {}),
      })
      remaining -= includedText.length
      if (wasTruncated) shortened = true
    }
    rawMongoDocuments[item.source] = included
    sourceStats.push({
      source: item.source,
      documentsRead: item.documentsRead,
      documentsIncluded: included.length,
      charactersIncluded: included.reduce((total, document) => total + document.text.length, 0),
      truncated: shortened || included.length < item.candidates.length,
    })
    sourceDigests[item.source] = createHash('sha256').update(JSON.stringify(included)).digest('hex')
  }

  return {
    userId: '',
    rawMongoDocuments,
    sourceStats,
    sourceDigests,
    evidenceIds: PROMPT_INPUT_SOURCES.flatMap((source) => rawMongoDocuments[source].map((document) => document.id)),
  }
}

export async function loadRawAccountPromptInput(userId: string, database?: Db): Promise<RawAccountPromptInput> {
  const db = database ?? await getMongoDatabase()
  const documentLimit = MAX_DOCUMENTS_PER_SOURCE * 3
  const [user, personas, profiles, profileSections, posts, comments, discord, whatsapp, textSamples, knowledge, adaptations] = await Promise.all([
    db.collection<Document & { _id: string }>('users').findOne({ _id: userId }, { projection: { _id: 1, displayName: 1 } }),
    db.collection<Document>('personas').find({ userId }).sort({ updatedAt: -1 }).limit(documentLimit).toArray(),
    Promise.all(['linkedin_profiles', 'instagram_profiles', 'x_profiles'].map((collection) =>
      db.collection<Document>(collection).find({ userId }).limit(documentLimit).toArray(),
    )),
    db.collection<Document>('social_profile_sections').find({ userId }).sort({ position: 1 }).limit(documentLimit).toArray(),
    db.collection<Document>('social_posts').find({ userId }).sort({ publishedAt: -1, syncedAt: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('social_comments').find({ userId, authorUserId: userId }).sort({ publishedAt: -1, syncedAt: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('discord_messages').find(ownedMessageFilter(userId)).sort({ createdAt: -1, timestamp: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('whatsapp_messages').find(ownedMessageFilter(userId)).sort({ createdAt: -1, timestamp: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('user_text_samples').find(ownedMessageFilter(userId)).sort({ createdAt: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('approved_knowledge_documents').find({ userId, approved: true }).sort({ updatedAt: -1 }).limit(documentLimit).toArray(),
    db.collection<Document>('interpreter_adaptations').find({ userId }).sort({ version: -1 }).limit(documentLimit).toArray(),
  ])

  const profileDocuments = profiles.flat()
  const result = materialize([
    prepare('persona', [
      ...(user ? [{ id: identifier('users', user._id), text: stringFields(user, ['displayName']) }] : []),
      ...personas.map((document) => ({
        id: identifier('personas', document._id),
        text: stringFields(document, ['name', 'bio', 'traits', 'interests', 'style', 'values', 'lifeGoals', 'relationshipPreferences']),
      })),
    ]),
    prepare('profiles', profileDocuments.map((document) => ({
      id: identifier(`${String(document.platform || 'social')}_profiles`, document._id),
      text: stringFields(document, ['platform', 'name', 'handle', 'headline', 'bio', 'about', 'biography', 'description', 'location']),
    }))),
    prepare('profileSections', profileSections.map((document) => ({
      id: identifier('social_profile_sections', document._id),
      text: stringFields(document, ['platform', 'kind', 'heading', 'text']),
    }))),
    prepare('posts', posts.map((document) => ({
      id: identifier('social_posts', document._id),
      text: stringFields(document, ['platform', 'kind', 'text']),
    }))),
    prepare('authoredComments', comments.map((document) => ({
      id: identifier('social_comments', document._id),
      text: stringFields(document, ['platform', 'text']),
    }))),
    prepare('discordMessages', discord.filter((document) => isOwnedMessage(document, userId)).map((document) => ({
      id: identifier('discord_messages', document._id),
      text: stringFields(document, ['text', 'content', 'body']),
    }))),
    prepare('whatsappMessages', whatsapp.filter((document) => isOwnedMessage(document, userId)).map((document) => ({
      id: identifier('whatsapp_messages', document._id),
      text: stringFields(document, ['text', 'content', 'body']),
    }))),
    prepare('textSamples', textSamples.filter((document) => isOwnedMessage(document, userId)).map((document) => ({
      id: identifier('user_text_samples', document._id),
      text: stringFields(document, ['text', 'content', 'body']),
    }))),
    prepare('knowledgeDocuments', knowledge.map((document) => ({
      id: identifier('approved_knowledge_documents', document._id),
      text: stringFields(document, ['title', 'text', 'content', 'body']),
    }))),
    prepare('adaptations', adaptations.map((document) => ({
      id: identifier('interpreter_adaptations', document._id),
      text: stringFields(document, ['guidance', 'cues', 'confidence']),
    }))),
  ])

  return { ...result, userId }
}
