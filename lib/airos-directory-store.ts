import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { cache } from 'react'
import { profilePhoto } from '@/lib/profile-photo'
import { MongoServerError } from 'mongodb'
import { getMongoDatabase } from '@/lib/mongodb'
import {
  BADGE_PUBLIC_FIELDS,
  badgeImportBatchSchema,
  classifyBadgeProfile,
  deduplicateImportBatch,
  normalizeBadgeId,
  type BadgeImportBatch,
  type BadgeProfileInput,
  type ImportSummary,
  type PreviewRecord,
} from '@/lib/airos-directory'

const PROFILES = 'airos_profiles'
const CONNECTIONS = 'airos_connections'
const OBSERVATIONS = 'airos_profile_observations'
const IMPORTS = 'airos_imports'
const ANALYSES = 'airos_profile_analyses'

const PUBLIC_FIELDS = BADGE_PUBLIC_FIELDS
type PublicField = (typeof PUBLIC_FIELDS)[number]

export type AirosProfileDocument = {
  badgeId: string
  userId: string
  name: string
  email?: string | null
  phone?: string | null
  linkedin?: string | null
  instagram?: string | null
  x?: string | null
  discord?: string | null
  role?: string | null
  source: 'badge_import'
  importedFromBadgeIds: string[]
  observationCount: number
  firstImportedAt: Date
  lastImportedAt: Date
  createdAt: Date
  updatedAt: Date
}

export type AirosAnalysisDocument = {
  badgeId: string
  status: 'processing' | 'ready' | 'failed'
  sourceHash?: string
  headline?: string
  summary?: string
  interests?: string[]
  conversationStarters?: string[]
  warnings?: string[]
  model?: string
  generatedAt?: Date
  lockToken?: string
  lockExpiresAt?: Date
  error?: string
  createdAt: Date
  updatedAt: Date
}

export type PublicProfile = {
  avatarUrl: string | null
  avatarAlternatives: string[]
  badgeId: string
  name: string
  email: string | null
  phone: string | null
  linkedin: string | null
  instagram: string | null
  x: string | null
  discord: string | null
  role: string | null
  source: 'badge_import'
  observationCount: number
  connectionCount: number
  firstImportedAt: string
  lastImportedAt: string
  analysis: null | {
    headline: string
    summary: string
    interests: string[]
    conversationStarters: string[]
    warnings: string[]
    model: string
    generatedAt: string
  }
}

function deterministicUserId(badgeId: string) {
  return `usr_airos_${createHash('sha256').update(badgeId).digest('hex').slice(0, 20)}`
}

function fieldValue(input: BadgeProfileInput, field: PublicField) {
  const value = input[field]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function classify(existing: AirosProfileDocument | null, input: BadgeProfileInput): PreviewRecord {
  const result = classifyBadgeProfile(existing, input)
  return {
    badgeId: input.badgeId,
    name: existing?.name || input.name,
    kind: input.kind,
    ...result,
    profileUrl: `/people/${input.badgeId}`,
  }
}

function normalizedProfiles(batch: BadgeImportBatch) {
  const normalized = deduplicateImportBatch(batch)
  return [normalized.owner, ...normalized.contacts]
}

export async function previewAirosImport(value: unknown) {
  const parsed = badgeImportBatchSchema.parse(value)
  const batch = deduplicateImportBatch(parsed)
  const inputs = normalizedProfiles(batch)
  const database = await getMongoDatabase()
  const existing = await database.collection<AirosProfileDocument>(PROFILES)
    .find({ badgeId: { $in: inputs.map((profile) => profile.badgeId) } })
    .toArray()
  const byBadgeId = new Map(existing.map((profile) => [profile.badgeId, profile]))
  return {
    ownerBadgeId: batch.owner.badgeId,
    records: inputs.map((input) => classify(byBadgeId.get(input.badgeId) || null, input)),
  }
}

function preserveNonEmpty(field: PublicField, incoming: string | null) {
  if (!incoming) return `$${field}`
  return {
    $cond: [
      {
        $or: [
          { $eq: [{ $type: `$${field}` }, 'missing'] },
          { $eq: [`$${field}`, null] },
          { $eq: [`$${field}`, ''] },
        ],
      },
      incoming,
      `$${field}`,
    ],
  }
}

function recordHash(sourceBadgeId: string, input: BadgeProfileInput) {
  return createHash('sha256').update(JSON.stringify({ sourceBadgeId, input })).digest('hex')
}

function isDuplicateKey(error: unknown) {
  return error instanceof MongoServerError && error.code === 11000
}

export async function importAirosBatch(value: unknown): Promise<ImportSummary> {
  const parsed = badgeImportBatchSchema.parse(value)
  const batch = deduplicateImportBatch(parsed)
  const preview = await previewAirosImport(batch)
  const database = await getMongoDatabase()
  const profiles = database.collection<AirosProfileDocument>(PROFILES)
  const now = new Date()
  const importId = `imp_${randomUUID()}`
  const inputs = normalizedProfiles(batch)

  for (const input of inputs) {
    const incoming = Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, fieldValue(input, field)])) as Record<PublicField, string | null>
    const profileUpdate = [{
        $set: {
          badgeId: input.badgeId,
          userId: { $ifNull: ['$userId', deterministicUserId(input.badgeId)] },
          ...Object.fromEntries(PUBLIC_FIELDS.map((field) => [field, preserveNonEmpty(field, incoming[field])])),
          source: 'badge_import',
          importedFromBadgeIds: {
            $setUnion: [{ $ifNull: ['$importedFromBadgeIds', []] }, [batch.owner.badgeId]],
          },
          observationCount: { $add: [{ $ifNull: ['$observationCount', 0] }, 1] },
          firstImportedAt: { $ifNull: ['$firstImportedAt', now] },
          lastImportedAt: now,
          createdAt: { $ifNull: ['$createdAt', now] },
          updatedAt: now,
        },
      }]
    try {
      await profiles.updateOne({ badgeId: input.badgeId }, profileUpdate, { upsert: true })
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      await profiles.updateOne({ badgeId: input.badgeId }, profileUpdate)
    }
  }

  const previewByBadgeId = new Map(preview.records.map((record) => [record.badgeId, record]))
  if (inputs.length) {
    await database.collection(OBSERVATIONS).insertMany(inputs.map((input) => {
      const record = previewByBadgeId.get(input.badgeId)!
      return {
        importId,
        sourceBadgeId: batch.owner.badgeId,
        targetBadgeId: input.badgeId,
        kind: input.kind,
        recordHash: recordHash(batch.owner.badgeId, input),
        profile: input,
        fills: record.fills,
        conflicts: record.conflicts,
        observedAt: now,
      }
    }))
  }

  const connections = database.collection(CONNECTIONS)
  for (const contact of batch.contacts) {
    const badgeIds = [batch.owner.badgeId, contact.badgeId].sort()
    const connectionFilter = { pairKey: badgeIds.join('|') }
    const connectionUpdate = {
        $setOnInsert: {
          pairKey: badgeIds.join('|'),
          badgeIds,
          firstObservedAt: now,
          createdAt: now,
        },
        $set: { lastObservedAt: now, updatedAt: now },
        $inc: { importCount: 1 },
      }
    try {
      await connections.updateOne(connectionFilter, connectionUpdate, { upsert: true })
    } catch (error) {
      if (!isDuplicateKey(error)) throw error
      await connections.updateOne(connectionFilter, connectionUpdate)
    }
  }

  const summary: ImportSummary = {
    importId,
    newProfiles: preview.records.filter((record) => record.status === 'new').length,
    updatedProfiles: preview.records.filter((record) => record.fills.length > 0 && record.status !== 'new').length,
    existingProfiles: preview.records.filter((record) => record.status === 'existing').length,
    conflicts: preview.records.filter((record) => record.conflicts.length > 0).length,
    invalidProfiles: 0,
    connections: batch.contacts.length,
    profiles: preview.records,
  }

  await database.collection(IMPORTS).insertOne({
    importId,
    sourceBadgeId: batch.owner.badgeId,
    profileCount: inputs.length,
    contactCount: batch.contacts.length,
    summary,
    createdAt: now,
    completedAt: now,
  })
  return summary
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function publicProjection() {
  return {
    _id: 0,
    userId: 1,
    badgeId: 1,
    name: 1,
    email: 1,
    phone: 1,
    linkedin: 1,
    instagram: 1,
    x: 1,
    discord: 1,
    role: 1,
    source: 1,
    observationCount: 1,
    firstImportedAt: 1,
    lastImportedAt: 1,
  } as const
}

export async function listPublicProfiles(query: string, page: number, pageSize = 24) {
  if (!process.env.MONGODB_URI) return { configured: false, profiles: [], total: 0, page: 1, pageSize }
  const database = await getMongoDatabase()
  const normalizedQuery = query.trim().slice(0, 100)
  const filter = normalizedQuery
    ? { $or: [
      { name: { $regex: escapeRegex(normalizedQuery), $options: 'i' } },
      { badgeId: { $regex: escapeRegex(normalizedQuery.toLowerCase()), $options: 'i' } },
    ] }
    : {}
  const safePage = Number.isInteger(page) && page > 0 ? page : 1
  const [profiles, total] = await Promise.all([
    database.collection<AirosProfileDocument>(PROFILES)
      .find(filter, { projection: publicProjection() })
      .sort({ lastImportedAt: -1, badgeId: 1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .toArray(),
    database.collection<AirosProfileDocument>(PROFILES).countDocuments(filter),
  ])
  const userIds = profiles.map((profile) => profile.userId)
  const profileByUserId = new Map(profiles.map((profile) => [profile.userId, profile]))
  const profileByUrl = new Map<string, AirosProfileDocument>()
  for (const profile of profiles) {
    for (const link of [profile.linkedin, profile.x, profile.instagram]) {
      if (!link) continue
      const normalized = link.replace(/\/$/, '')
      profileByUrl.set(normalized, profile)
      profileByUrl.set(`${normalized}/`, profile)
    }
  }
  const urls = [...profileByUrl.keys()]
  const socialProfiles = profiles.length ? await Promise.all(
    ['linkedin_profiles', 'x_profiles', 'instagram_profiles'].map((collection) => database.collection(collection).find({ $or: [
      { userId: { $in: userIds } },
      ...(urls.length ? [{ sourceUrl: { $in: urls } }, { url: { $in: urls } }, { linkedinUrl: { $in: urls } }] : []),
    ] }, { projection: {
      _id: 0,
      userId: 1,
      sourceUrl: 1,
      url: 1,
      linkedinUrl: 1,
      avatarUrl: 1,
      profilePicUrlHD: 1,
      profilePicUrl: 1,
      profilePicture: 1,
      photo: 1,
      profile_image_url_https: 1,
      profile_image_url: 1,
      cachedAvatar: 1,
    } }).toArray()),
  ) : []
  const badgesWithPhotos = new Set<string>()
  for (const socialProfile of socialProfiles.flat()) {
    if (!socialProfile.cachedAvatar && !profilePhoto(socialProfile)) continue
    const matchedUrl = [socialProfile.sourceUrl, socialProfile.url, socialProfile.linkedinUrl]
      .find((value): value is string => typeof value === 'string' && profileByUrl.has(value))
    const matched = (typeof socialProfile.userId === 'string' ? profileByUserId.get(socialProfile.userId) : null)
      || (matchedUrl ? profileByUrl.get(matchedUrl) : null)
    if (matched) badgesWithPhotos.add(matched.badgeId)
  }
  const publicProfiles = profiles.map(({ userId: _userId, ...profile }) => ({
    ...profile,
    avatarUrl: badgesWithPhotos.has(profile.badgeId) ? `/api/airos/profiles/${encodeURIComponent(profile.badgeId)}/photo` : null,
  }))
  return { configured: true, profiles: publicProfiles, total, page: safePage, pageSize }
}

export const getPublicProfile = cache(async (badgeIdValue: string): Promise<PublicProfile | null> => {
  if (!process.env.MONGODB_URI) return null
  const badgeId = normalizeBadgeId(badgeIdValue)
  if (!badgeId) return null
  const database = await getMongoDatabase()
  const [profile, connectionCount, analysis] = await Promise.all([
    database.collection<AirosProfileDocument>(PROFILES).findOne({ badgeId }),
    database.collection(CONNECTIONS).countDocuments({ badgeIds: badgeId }),
    database.collection<AirosAnalysisDocument>(ANALYSES).findOne({ badgeId, status: 'ready' }),
  ])
  if (!profile) return null
  const socialProfiles = await Promise.all([
    ['linkedin_profiles', profile.linkedin], ['x_profiles', profile.x], ['instagram_profiles', profile.instagram],
  ].map(([name, link]) => {
    const urls = link ? [link.replace(/\/$/, ''), `${link.replace(/\/$/, '')}/`] : []
    return database.collection(name!).findOne({ $or: [
      { userId: profile.userId },
      ...(urls.length ? [{ sourceUrl: { $in: urls } }, { url: { $in: urls } }, { linkedinUrl: { $in: urls } }] : []),
    ] }, { projection: { avatarUrl: 1, profilePicUrlHD: 1, profilePicUrl: 1, profilePicture: 1, photo: 1, profile_image_url_https: 1, profile_image_url: 1, cachedAvatar: 1 } })
  }))
  const hasPhoto = socialProfiles.some((socialProfile) => Boolean(socialProfile && (socialProfile.cachedAvatar || profilePhoto(socialProfile))))
  return {
    avatarUrl: hasPhoto ? `/api/airos/profiles/${encodeURIComponent(profile.badgeId)}/photo` : null,
    avatarAlternatives: [],
    badgeId: profile.badgeId,
    name: profile.name,
    email: profile.email || null,
    phone: profile.phone || null,
    linkedin: profile.linkedin || null,
    instagram: profile.instagram || null,
    x: profile.x || null,
    discord: profile.discord || null,
    role: profile.role || null,
    source: 'badge_import',
    observationCount: profile.observationCount || 0,
    connectionCount,
    firstImportedAt: profile.firstImportedAt.toISOString(),
    lastImportedAt: profile.lastImportedAt.toISOString(),
    analysis: analysis?.headline && analysis.summary && analysis.interests && analysis.conversationStarters && analysis.generatedAt
      ? {
        headline: analysis.headline,
        summary: analysis.summary,
        interests: analysis.interests,
        conversationStarters: analysis.conversationStarters,
        warnings: analysis.warnings || [],
        model: analysis.model || 'unknown',
        generatedAt: analysis.generatedAt.toISOString(),
      }
      : null,
  }
})

export async function getProfileDocument(badgeIdValue: string) {
  const badgeId = normalizeBadgeId(badgeIdValue)
  if (!badgeId) return null
  const database = await getMongoDatabase()
  return database.collection<AirosProfileDocument>(PROFILES).findOne({ badgeId })
}

export async function listProfileConnections(badgeIdValue: string, limit = 24) {
  const badgeId = normalizeBadgeId(badgeIdValue)
  if (!badgeId || !process.env.MONGODB_URI) return []
  const database = await getMongoDatabase()
  const edges = await database.collection<{ badgeIds: string[]; lastObservedAt: Date }>(CONNECTIONS)
    .find({ badgeIds: badgeId })
    .sort({ lastObservedAt: -1 })
    .limit(limit)
    .toArray()
  const otherIds = edges.flatMap((edge) => edge.badgeIds.filter((id) => id !== badgeId))
  if (!otherIds.length) return []
  return database.collection<AirosProfileDocument>(PROFILES)
    .find({ badgeId: { $in: otherIds } }, { projection: { _id: 0, badgeId: 1, name: 1, role: 1 } })
    .toArray()
}
