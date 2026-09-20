import 'server-only'

import { createHash } from 'node:crypto'
import { getMongoDatabase } from '@/lib/mongodb'
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

  await database.collection<UserDocument>('users').updateOne(
    { _id: userId },
    {
      $set: { displayName: persona.name, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  )

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

  return {
    personaId: String(stored._id),
    userId,
    slot,
    revision: typeof stored.revision === 'number' ? stored.revision : 1,
    persona,
  }
}

function emptyPersona(name: string): PsychologyPersona {
  return {
    name,
    bio: '',
    traits: [],
    interests: [],
    style: '',
    values: [],
    lifeGoals: { wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' },
    relationshipPreferences: { planning: 'not_disclosed', communication: 'not_disclosed' },
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
      { projection: { _id: 0, userId: 1, cachedAvatar: 1, avatarUrl: 1, profilePicUrlHD: 1, profilePicUrl: 1, profilePicture: 1, photo: 1, profile_image_url_https: 1, profile_image_url: 1 } },
    ).toArray()),
  ) : []
  const usersWithPhotos = new Set(socialProfiles.flat().flatMap(profile =>
    typeof profile.userId === 'string' && (profile.cachedAvatar || profilePhoto(profile)) ? [profile.userId] : []))
  const seenUserIds = new Set<string>()
  const profiles: LabProfile[] = []
  for (const profile of badgeProfiles) {
    if (typeof profile.userId !== 'string' || typeof profile.name !== 'string') continue
    const stored = personaByUserId.get(profile.userId)?.persona
    profiles.push({
      ...(stored || emptyPersona(profile.name)),
      name: stored?.name || profile.name,
      userId: profile.userId,
      badgeId: typeof profile.badgeId === 'string' ? profile.badgeId : null,
      role: typeof profile.role === 'string' && !/^\d+$/.test(profile.role) ? profile.role : null,
      avatarUrl: typeof profile.badgeId === 'string' && usersWithPhotos.has(profile.userId) ? `/api/airos/profiles/${encodeURIComponent(profile.badgeId)}/photo` : null,
      source: 'badge_import',
    })
    seenUserIds.add(profile.userId)
  }
  for (const [userId, stored] of personaByUserId) {
    if (seenUserIds.has(userId)) continue
    profiles.push({ ...stored.persona, userId, badgeId: null, role: null, avatarUrl: null, source: 'persona' })
  }
  return profiles
}
