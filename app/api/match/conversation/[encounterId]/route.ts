import { z } from 'zod'
import { getMongoDatabase } from '@/lib/mongodb'

export const runtime = 'nodejs'

const idSchema = z.string().regex(/^enc_[0-9a-f-]{36}$/)
type StringIdDocument = { _id: string; [key: string]: any }

export async function GET(_request: Request, context: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await context.params
  if (!idSchema.safeParse(encounterId).success) return Response.json({ error: 'Invalid encounter ID.' }, { status: 400 })
  const database = await getMongoDatabase()
  const encounter = await database.collection<StringIdDocument>('conversation_encounters').findOne({ _id: encounterId })
  if (!encounter) return Response.json({ error: 'Encounter not found.' }, { status: 404 })
  const messages = await database.collection<StringIdDocument>('agent_messages').find({ encounterId }).sort({ sequence: 1 }).project({
    _id: 1, sequence: 1, speakerKey: 1, action: 1, text: 1, reactionId: 1, voicePromptId: 1, lensUsage: 1,
  }).toArray()
  const reactions = await database.collection<StringIdDocument>('agent_reactions').find({ encounterId }).sort({ createdAt: 1 }).project({
    _id: 1, inputMessageId: 1, ownerUserId: 1, interpretation: 1, adaptationVersionId: 1,
  }).toArray()
  const feedback = await database.collection<StringIdDocument>('encounter_feedback').findOne(
    { encounterId },
    { projection: { _id: 0, outcome: 1, status: 1, error: 1, reportedAt: 1 } },
  )
  const adaptations = await database.collection<StringIdDocument>('interpreter_adaptations').find(
    { sourceEncounterId: encounterId },
    { projection: { _id: 0, userId: 1, version: 1, resolvedBias: 1, guidance: 1, cues: 1, confidence: 1, outcomeTally: 1 } },
  ).toArray()
  return Response.json({
    encounterId, status: encounter.status, error: encounter.error,
    participants: encounter.participants, messages, reactions,
    compatibility: encounter.compatibility ?? null,
    feedback: feedback ?? null, adaptations,
  })
}
