import { z } from 'zod'

export const voiceSourceSchema = z.enum([
  'manual',
  'discord',
  'whatsapp',
  'linkedin',
  'instagram',
  'x',
  'other',
])

export const voiceSampleSchema = z.object({
  evidenceId: z.string().min(1).max(180),
  source: voiceSourceSchema,
  text: z.string().min(1).max(800),
  occurredAt: z.string().datetime().nullable(),
})

export const voiceProfileSchema = z.object({
  voiceProfileVersionId: z.string().min(1).max(180),
  userId: z.string().min(1).max(100),
  frozenAt: z.string().datetime(),
  declaredStyle: z.string().min(1).max(400),
  samples: z.array(voiceSampleSchema).min(1).max(32),
})

export type VoiceSample = z.infer<typeof voiceSampleSchema>
export type VoiceProfile = z.infer<typeof voiceProfileSchema>

export const voicePromptBuilderSchema = z.object({
  systemInstructions: z.string().min(40).max(1800),
  evidenceIds: z.array(z.string().min(1).max(180)).min(1).max(24),
})

export type VoicePromptBuilderOutput = z.infer<typeof voicePromptBuilderSchema>
