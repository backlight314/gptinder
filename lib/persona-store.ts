import 'server-only'

import { createHash } from 'node:crypto'
import { getMongoDatabase } from '@/lib/mongodb'
import { agentContextView, ensureMinimalAgentContext, initializeNewAgentContext } from '@/lib/agent-contexts/store'
import { buildPersonaPrefill } from '@/lib/persona-prefill'
import { profilePhoto } from '@/lib/profile-photo'
import { manualPersonaSchema, type ManualPersona as PsychologyPersona } from '@/lib/psychology/schemas'

export type PersonaSlot = 'a' | 'b'

export type ManualPersona = {
  name: string
  bio: string
  traits: string[]
  interests: string[]
  style: string
}

export type LabProfile = PsychologyPersona & {
  userId: string
  badgeId: string | null
  role: string | null
  avatarUrl: string | null
  source: 'badge_import' | 'persona'
  prefilled: boolean
}

type UserDocument = {
  _id: string
  displayName: string
  createdAt: Date
  updatedAt: Date
}

function personalizedUserId(name: string, slot: PersonaSlot) {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32) || 'user'
  const suffix = createHash('sha256').update(`persona:${slot}:${name}`).digest('hex').slice(0, 6)
  return `usr_${slug}_${suffix}`
}

export async function storePersona(
  persona: PsychologyPersona,
  slot: PersonaSlot,
  requestedUserId?: string,
) {
  const database = await getMongoDatabase()
  const now = new Date()
  const userId = requestedUserId || personalizedUserId(persona.name, slot)
  const personas = database.collection('personas')

  const userWrite = await database.collection<UserDocument>('users').updateOne(
    { _id: userId },
    {
      $set: { displayName: persona.name, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )
  let agentContext = await ensureMinimalAgentContext(userId, database)

  const stored = await personas.findOneAndUpdate(
    { userId, slot },
    {
      $set: { userId, slot, ...persona, updatedAt: now },
      $setOnInsert: { createdAt: now },
      $inc: { revision: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  )

  if (!stored) throw new Error('MongoDB did not return the stored persona')

  if (userWrite.upsertedCount === 1) agentContext = await initializeNewAgentContext(userId, database)

  return {
    personaId: String(stored._id),
    userId,
    slot,
    revision: typeof stored.revision === 'number' ? stored.revision : 1,
    persona,
    agentContext: agentContextView(agentContext),
    userCreated: userWrite.upsertedCount === 1,
  }
}

export async function listLabProfiles(slot?: PersonaSlot): Promise<LabProfile[]> {
  const database = await getMongoDatabase()
  const personaDocuments = await database.collection('personas').find({}, {
    projection: { _id: 0, userId: 1, slot: 1, name: 1, bio: 1, traits: 1, interests: 1, style: 1, values: 1, lifeGoals: 1, relationshipPreferences: 1, updatedAt: 1 },
  }).sort({ updatedAt: -1 }).toArray()
  const personaByUserId = new Map<string, { persona: PsychologyPersona; slot: PersonaSlot }>()
  for (const document of personaDocuments) {
    if (typeof document.userId !== 'string' || (document.slot !== 'a' && document.slot !== 'b')) continue
    const parsed = manualPersonaSchema.safeParse(document)
    if (!parsed.success) continue
    const current = personaByUserId.get(document.userId)
    if (!current || (slot && document.slot === slot)) personaByUserId.set(document.userId, { persona: parsed.data, slot: document.slot })
  }

  const badgeProfiles = await database.collection('airos_profiles').find({}, {
    projection: { _id: 0, userId: 1, badgeId: 1, name: 1, role: 1 },
  }).sort({ lastImportedAt: -1, badgeId: 1 }).toArray()
  const badgeUserIds = badgeProfiles.map(profile => profile.userId).filter((value): value is string => typeof value === 'string')
  const socialProfiles = badgeUserIds.length ? await Promise.all(
    ['linkedin_profiles', 'x_profiles', 'instagram_profiles'].map(collection => database.collection(collection).find(
      { userId: { $in: badgeUserIds } },
      { projection: { _id: 0, userId: 1, cachedAvatar: 1, avatarUrl: 1, profilePicUrlHD: 1, profilePicUrl: 1, profilePicture: 1, photo: 1, profile_image_url_https: 1, profile_image_url: 1, bio: 1, headline: 1, about: 1, description: 1, summary: 1 } },
    ).toArray()),
  ) : []
  const [posts, analyses] = badgeUserIds.length ? await Promise.all([
    database.collection<{ userId?: string; text?: string }>('social_posts').find(
      { userId: { $in: badgeUserIds }, text: { $type: 'string', $ne: '' } },
      { projection: { _id: 0, userId: 1, text: 1 } },
    ).limit(2_000).toArray(),
    database.collection<{ badgeId?: string; summary?: string; interests?: string[] }>('airos_profile_analyses').find(
      { badgeId: { $in: badgeProfiles.map(profile => profile.badgeId).filter((value): value is string => typeof value === 'string') } },
      { projection: { _id: 0, badgeId: 1, summary: 1, interests: 1 } },
    ).toArray(),
  ]) : [[], []]
  const postsByUserId = new Map<string, string[]>()
  for (const post of posts) {
    if (typeof post.userId !== 'string' || typeof post.text !== 'string' || !post.text.trim()) continue
    postsByUserId.set(post.userId, [...(postsByUserId.get(post.userId) || []), post.text])
  }
  const analysisByBadgeId = new Map(analyses.filter(analysis => typeof analysis.badgeId === 'string').map(analysis => [analysis.badgeId as string, analysis]))
  const socialProfilesByUserId = new Map<string, Record<string, unknown>[]>()
  for (const profile of socialProfiles.flat()) {
    if (typeof profile.userId !== 'string') continue
    socialProfilesByUserId.set(profile.userId, [...(socialProfilesByUserId.get(profile.userId) || []), profile])
  }
  const usersWithPhotos = new Set(socialProfiles.flat().flatMap(profile =>
    typeof profile.userId === 'string' && (profile.cachedAvatar || profilePhoto(profile)) ? [profile.userId] : []))
  const seenUserIds = new Set<string>()
  const profiles: LabProfile[] = []
  for (const profile of badgeProfiles) {
    if (typeof profile.userId !== 'string' || typeof profile.name !== 'string') continue
    const manual = personaByUserId.get(profile.userId)?.persona
    const profileTexts = (socialProfilesByUserId.get(profile.userId) || []).flatMap(record =>
      [record.bio, record.headline, record.about, record.description, record.summary].filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))
    const generatedPrefill = buildPersonaPrefill({
      userId: profile.userId,
      name: profile.name,
      role: typeof profile.role === 'string' ? profile.role : null,
      profileTexts,
      posts: postsByUserId.get(profile.userId) || [],
      analysis: typeof profile.badgeId === 'string' ? analysisByBadgeId.get(profile.badgeId) : null,
    })
    const stored = manual || generatedPrefill
    profiles.push({
      ...stored,
      name: stored.name || profile.name,
      userId: profile.userId,
      badgeId: typeof profile.badgeId === 'string' ? profile.badgeId : null,
      role: typeof profile.role === 'string' && !/^\d+$/.test(profile.role) ? profile.role : null,
      avatarUrl: typeof profile.badgeId === 'string' && usersWithPhotos.has(profile.userId) ? `/api/airos/profiles/${encodeURIComponent(profile.badgeId)}/photo` : null,
      source: 'badge_import',
      prefilled: !manual && Boolean(stored.bio || stored.traits.length || stored.interests.length || stored.style),
    })
    seenUserIds.add(profile.userId)
  }
  for (const [userId, stored] of personaByUserId) {
    if (seenUserIds.has(userId)) continue
    profiles.push({ ...stored.persona, userId, badgeId: null, role: null, avatarUrl: null, source: 'persona', prefilled: false })
  }
  return profiles
}
