import { z } from 'zod'

export const dateOutcomeSchema = z.enum(['positive', 'negative'])
export type DateOutcome = z.infer<typeof dateOutcomeSchema>

export const reactionBiasSchema = z.enum(['more_positive', 'more_negative', 'unchanged'])
export type ReactionBias = z.infer<typeof reactionBiasSchema>

export const reactionCueSchema = z.object({
  cue: z.string().min(1).max(160),
  direction: dateOutcomeSchema,
  reason: z.string().min(1).max(300),
  messageEvidenceIds: z.array(z.string().min(1).max(180)).min(1).max(6),
})

export const reactionAdaptationSchema = z.object({
  reactionBias: reactionBiasSchema,
  guidance: z.string().min(40).max(1200),
  cues: z.array(reactionCueSchema).min(1).max(6),
  confidence: z.enum(['low', 'medium', 'high']),
})

export type ReactionAdaptationOutput = z.infer<typeof reactionAdaptationSchema>

export const storedAdaptationSchema = reactionAdaptationSchema.extend({
  adaptationVersionId: z.string().min(1).max(180),
  userId: z.string().min(1).max(100),
  version: z.number().int().positive(),
  resolvedBias: reactionBiasSchema,
  outcomeTally: z.object({ positive: z.number().int().min(0), negative: z.number().int().min(0) }),
  basedOnEncounterIds: z.array(z.string().min(1).max(120)).min(1).max(50),
})

export type StoredAdaptation = z.infer<typeof storedAdaptationSchema>

export const feedbackRequestSchema = z.object({ outcome: dateOutcomeSchema })
