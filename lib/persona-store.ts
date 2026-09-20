import 'server-only'

import { createHash } from 'node:crypto'
import { getMongoDatabase } from '@/lib/mongodb'
import { agentContextView, ensureMinimalAgentContext, initializeNewAgentContext } from '@/lib/agent-contexts/store'
import type { ManualPersona as PsychologyPersona } from '@/lib/psychology/schemas'

export type PersonaSlot = 'a' | 'b'

export type ManualPersona = {
  name: string
  bio: string
  traits: string[]
  interests: string[]
  style: string
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
