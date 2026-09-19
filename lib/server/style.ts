import 'server-only'
import { DEFAULT_STYLE, auditSchema } from '../import-domain'
import { copiesPrivatePassage } from '../style-safety'
import { collections } from './db'
import { requireValue, AppError } from './errors'
import { generateStructured } from './ai'

export async function loadStyleContext(
  userId: string,
  styleVersionId?: string,
) {
  const c = await collections()
  if (!styleVersionId)
    return {
      settings: DEFAULT_STYLE,
      sourceIds: [] as string[],
      examples: [] as { id: string; text: string }[],
      holdout: [] as string[],
      privateTexts: [] as string[],
      approvedInterests: [] as string[],
    }
  const style = requireValue(
    await c.styles.findOne({
      _id: styleVersionId,
      userId,
      invalidatedAt: { $exists: false },
    }),
    'This style version is no longer available.',
  )
  const sources = await c.imports
    .find({ _id: { $in: style.sourceIds }, userId, status: 'approved' })
    .toArray()
  if (sources.length !== style.sourceIds.length)
    throw new AppError(
      409,
      'An imported source was removed. Review your profile again.',
    )
  const retrieved = await c.retrieval
    .find({ userId, sourceId: { $in: style.sourceIds } })
    .toArray()
  const allowedIds = new Set(retrieved.map((r) => r.sampleId))
  const samples = (
    await c.samples
      .find({ userId, sourceId: { $in: style.sourceIds } })
      .toArray()
  ).filter((s) => allowedIds.has(s.id))
  const examples = samples
    .filter((s) => s.role === 'training' && style.sampleIds.includes(s.id))
    .slice(0, 3)
    .map((s) => ({ id: s.id, text: s.text }))
  if (style.approvedPreviewId) {
    const preview = await c.previews.findOne({
      _id: style.approvedPreviewId,
      userId,
      invalidatedAt: { $exists: false },
    })
    if (preview?.review)
      examples.unshift({ id: preview._id, text: preview.review.editedText })
  }
  const claims = await c.claims
    .find({
      userId,
      sourceId: { $in: style.sourceIds },
      status: 'approved',
      allowedUse: 'conversation_topic',
    })
    .toArray()
  return {
    settings: style.settings,
    sourceIds: style.sourceIds,
    examples: examples.slice(0, 3),
    holdout: samples.filter((s) => s.role === 'holdout').map((s) => s.text),
    privateTexts: [
      ...samples.map((s) => s.text),
      ...examples.map((s) => s.text),
    ],
    approvedInterests: claims.map((claim) => claim.text),
  }
}
export const STYLE_INSTRUCTION =
  'Imitate broad communication style only: tone, length, directness and emoji frequency. Private writing examples are never factual context. Never copy passages, mention people, places, dates, events, secrets or relationships from them. Speak about the current hypothetical date only. Emoji, vocabulary and length have no effect on compatibility scoring.'
export async function auditStyleOutput(
  text: string,
  approvedContext: unknown,
  privateTexts: string[],
) {
  const copyDetected = copiesPrivatePassage(text, privateTexts)
  const audit = await generateStructured(
    auditSchema,
    'Audit a generated dating-representative message. Flag personal factual claims not supported by approvedContext, and any private names, events or facts derived from privateTexts. Hypothetical activity suggestions and style are not personal factual claims. Return only brief descriptions of problems; do not quote private passages.',
    { text, approvedContext, privateTexts },
    { attempts: 1, timeoutMs: 12000 },
  )
  return {
    copyDetected,
    unsupportedClaims: audit.unsupportedClaims.length,
    disclosures: audit.disclosures.length,
  }
}
