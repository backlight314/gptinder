import { z } from 'zod'

export const styleSchema = z.object({
  tone: z.enum(['warm', 'playful', 'matter-of-fact', 'reflective']),
  length: z.enum(['short', 'medium', 'long']),
  emoji: z.enum(['none', 'occasional', 'frequent']),
  directness: z.enum(['gentle', 'balanced', 'direct']),
  notes: z.string().max(400),
})
export type CommunicationStyle = z.infer<typeof styleSchema>
export const DEFAULT_STYLE: CommunicationStyle = {
  tone: 'warm',
  length: 'medium',
  emoji: 'occasional',
  directness: 'balanced',
  notes: '',
}
export const sampleSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(5).max(600),
  author: z.literal('self'),
  role: z.enum(['training', 'holdout']),
  timestamp: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/)
    .optional(),
})
export type WritingSample = z.infer<typeof sampleSchema>
export interface StoredWritingSample extends WritingSample {
  _id: string
  userId: string
  sourceId: string
}
export const sourceTypeSchema = z.enum(['whatsapp', 'writing', 'professional'])
export const importInputSchema = z
  .object({
    label: z.string().trim().min(1).max(100),
    sourceType: sourceTypeSchema.default('whatsapp'),
    samples: z.array(sampleSchema).min(1).max(200),
    reviewed: z.literal(true),
    ownMessagesOnly: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (
      v.sourceType === 'professional' &&
      !v.samples.some((s) => s.role === 'training')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Select at least one professional excerpt for extraction.',
      })
    if (v.samples.reduce((n, s) => n + s.text.length, 0) > 80000)
      ctx.addIssue({
        code: 'custom',
        message: 'Select at most 80,000 characters.',
      })
    if (new Set(v.samples.map((s) => s.id)).size !== v.samples.length)
      ctx.addIssue({ code: 'custom', message: 'Sample IDs must be unique.' })
    if (
      new Set(
        v.samples.map((s) => s.text.toLowerCase().replace(/\s+/g, ' ').trim()),
      ).size !== v.samples.length
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Remove duplicate samples, including across training and evaluation.',
      })
    if (
      v.sourceType !== 'professional' &&
      (!v.samples.some((s) => s.role === 'holdout') ||
        v.samples.filter((s) => s.role === 'training').length < 2)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Choose at least two training samples and one reserved sample.',
      })
  })
export const extractionSchema = z.object({
  style: styleSchema,
  claims: z
    .array(
      z.object({
        category: z.enum(['interest', 'fact', 'communication_style']),
        text: z.string().min(1).max(300),
        sampleIds: z.array(z.string().uuid()).min(1).max(5),
        supportingQuote: z.string().min(5).max(600),
        context: z.string().min(1).max(200),
        allowedUse: z.enum(['conversation_topic', 'persona_style']),
      }),
    )
    .max(8),
  uncertainty: z.array(z.string().max(300)).max(5),
})
export interface ImportSource {
  _id: string
  userId: string
  label: string
  sourceType: z.infer<typeof sourceTypeSchema>
  parserVersion: string
  consent: { reviewed: true; ownMessagesOnly: true; approvedAt: Date }
  statistics: {
    count: number
    meanWords: number
    questionRate: number
    emojiRate: number
    punctuationPerMessage: number
    contractionRate: number
  }
  samples: WritingSample[]
  status:
    | 'pending_start'
    | 'extracting'
    | 'review'
    | 'approved'
    | 'failed'
    | 'deleted'
  revision: number
  draft?: z.infer<typeof extractionSchema>
  workflowRunId?: string
  dispatchLeaseUntil?: Date
  createdAt: Date
  deletedAt?: Date
  error?: string
}
export interface ImportedClaim {
  _id: string
  userId: string
  sourceId: string
  category: 'interest' | 'fact' | 'communication_style'
  text: string
  sampleIds: string[]
  supportingQuote: string
  context: string
  allowedUse: 'conversation_topic' | 'persona_style'
  status: 'approved'
  approvedAt: Date
}
export interface StyleVersion {
  _id: string
  userId: string
  version: number
  settings: CommunicationStyle
  sourceIds: string[]
  sampleIds: string[]
  approvedPreviewId?: string
  createdAt: Date
  invalidatedAt?: Date
}
export interface RetrievalRecord {
  _id: string
  userId: string
  sourceId: string
  sampleId: string
  role: 'training' | 'holdout'
}
export const PREVIEW_SCENARIOS = [
  'Your match suggests changing the meeting time. How would your AI respond?',
  'Your match proposes a crowded afternoon event instead of a quiet cafe. How would your AI respond?',
  'Your match asks whether you want to try an unfamiliar activity. How would your AI respond?',
] as const
export const previewTextSchema = z.object({ text: z.string().min(1).max(1000) })
export const auditSchema = z.object({
  unsupportedClaims: z.array(z.string().max(200)).max(8),
  disclosures: z.array(z.string().max(200)).max(8),
})
export interface PreviewRecord {
  _id: string
  userId: string
  sourceIds: string[]
  styleVersionId: string | null
  scenario: string
  baseline: string
  enhanced: string
  metrics: {
    baselineUnsupportedClaims: number
    enhancedUnsupportedClaims: number
    baselineDisclosures: number
    enhancedDisclosures: number
    baselineCopyDetected: boolean
    enhancedCopyDetected: boolean
    holdoutCount: number
    holdoutStyleDistance: { baseline: number; enhanced: number } | null
    attribution: 'user-confirmed-self'
  }
  review?: {
    choice: 'baseline' | 'enhanced'
    editedText: string
    baselineResemblance: number
    enhancedResemblance: number
    attributionCorrect: boolean
    unsupportedClaims: number
    disclosureOrCopying: boolean
  }
  invalidatedAt?: Date
  createdAt: Date
}
