import { z } from 'zod'

export const personKeySchema = z.enum(['a', 'b'])
export type PersonKey = z.infer<typeof personKeySchema>

export const evidenceSourceSchema = z.enum([
  'questionnaire',
  'explicit_user_answer',
  'user_confirmed_inference',
  'post_date_feedback',
])

export const evidenceSchema = z.object({
  id: z.string().min(1).max(120),
  source: evidenceSourceSchema,
  statement: z.string().min(1).max(600),
})

const measureSchema = z.object({
  score: z.number().min(1).max(5).nullable(),
  evidenceIds: z.array(z.string()).max(20),
})

const tendencySchema = z.object({
  description: z.string().min(1).max(500),
  evidenceIds: z.array(z.string()).min(1).max(20),
})

export const frozenProfileSchema = z.object({
  profileVersionId: z.string().min(1),
  userId: z.string().min(1),
  name: z.string().min(1).max(80),
  version: z.number().int().positive(),
  approvedAt: z.string().datetime(),
  evidence: z.array(evidenceSchema).min(1).max(50),
  behavior: z.object({
    bigFive: z.object({
      extraversion: measureSchema,
      agreeableness: measureSchema,
      conscientiousness: measureSchema,
      negativeEmotionality: measureSchema,
      openness: measureSchema,
    }),
    contextualTendencies: z.record(z.string(), tendencySchema),
    evidenceIds: z.array(z.string()),
  }),
  interpersonal: z.object({
    warmth: measureSchema,
    dominance: measureSchema,
    interactionTendencies: z.record(z.string(), tendencySchema),
    evidenceIds: z.array(z.string()),
  }),
  attachmentRegulation: z.object({
    anxiety: measureSchema,
    avoidance: measureSchema,
    regulationPreferences: z.record(z.string(), tendencySchema),
    evidenceIds: z.array(z.string()),
  }),
  values: z.object({
    personalValues: z.record(z.string(), tendencySchema),
    explicitLifeGoals: z.record(z.string(), tendencySchema),
    relationshipPreferences: z.record(z.string(), tendencySchema),
    evidenceIds: z.array(z.string()),
  }),
  communicationStyleExamples: z.array(z.string().max(400)).max(8),
})

export type FrozenProfile = z.infer<typeof frozenProfileSchema>

const strengthSchema = z.enum(['low', 'medium', 'high'])
const warmthSchema = z.enum(['low', 'medium', 'high', 'unknown'])
const dominanceSchema = z.enum(['low', 'medium', 'high', 'unknown'])

export const temporaryEncounterStateSchema = z.object({
  engagement: z.enum(['low', 'medium', 'high', 'unknown']),
  comfort: z.enum(['low', 'medium', 'high', 'unknown']),
  tensionTopics: z.array(z.string().max(80)).max(8),
  positiveTopics: z.array(z.string().max(80)).max(8),
  unresolvedQuestions: z.array(z.string().max(180)).max(8),
  boundariesTriggered: z.array(z.string().max(80)).max(8),
})

export const socialInterpreterSchema = z.object({
  literalMeaning: z.string().min(1).max(500),
  possibleIntent: z.string().min(1).max(500),
  fourLensAnalysis: z.object({
    behavior: z.object({ signal: z.string().min(1).max(500) }),
    interpersonal: z.object({
      messageWarmth: warmthSchema,
      messageDominance: dominanceSchema,
      signal: z.string().min(1).max(500),
    }),
    attachmentRegulation: z.object({
      possibleActivation: strengthSchema,
      reason: z.string().min(1).max(500),
    }),
    values: z.object({
      relevantPreferences: z.array(z.string().max(120)).max(10),
      signal: z.string().min(1).max(500),
    }),
  }),
  possibleUserReaction: z.object({
    state: z.string().min(1).max(100),
    strength: strengthSchema,
  }),
  recommendedApproach: z.enum([
    'propose',
    'clarify',
    'agree',
    'compromise',
    'express_preference',
    'express_boundary',
    'acknowledge_difference',
    'ask_question',
    'unknown',
  ]),
  openQuestion: z.string().max(300),
  uncertainty: strengthSchema,
  evidenceIds: z.array(z.string()).max(20),
  messageEvidence: z.array(z.object({
    messageId: z.string().min(1),
    quote: z.string().min(1).max(240),
  })).min(1).max(4),
  temporaryState: temporaryEncounterStateSchema,
})

export type SocialInterpretation = z.infer<typeof socialInterpreterSchema>

export const personaSpeakerSchema = z.object({
  action: z.enum([
    'propose',
    'clarify',
    'agree',
    'compromise',
    'express_preference',
    'express_boundary',
    'acknowledge_difference',
    'ask_question',
    'unknown',
  ]),
  text: z.string().min(1).max(800),
  usedProfileEvidence: z.array(z.string()).min(1).max(20),
  usedInterpretationSignals: z.array(z.string()).max(20),
  lensUsage: z.object({
    behavior: z.array(z.string().max(120)).max(8),
    interpersonal: z.array(z.string().max(120)).max(8),
    attachmentRegulation: z.array(z.string().max(120)).max(8),
    values: z.array(z.string().max(120)).max(8),
  }),
})

export type PersonaSpeakerOutput = z.infer<typeof personaSpeakerSchema>

export const compatibilityAnalysisSchema = z.object({
  compatibility: z.enum(['strong', 'mixed', 'weak']),
  friction: z.enum(['none', 'low', 'moderate', 'high']),
  reciprocity: z.enum(['strong', 'mixed', 'weak']),
  pacing: z.enum(['aligned', 'mixed', 'mismatched']),
  connection: z.enum(['present', 'uncertain', 'absent']),
  sharedGround: z.enum(['meaningful', 'limited', 'unclear']),
  rationale: z.string().min(1).max(400),
})

export type CompatibilityAnalysis = z.infer<typeof compatibilityAnalysisSchema>

export const compatibilityVerdictSchema = z.object({
  summary: z.string().min(1).max(600),
  strengths: z.array(z.string().min(1).max(220)).min(1).max(3),
  considerations: z.array(z.string().min(1).max(220)).min(1).max(3),
  analysis: compatibilityAnalysisSchema,
  meetingIntent: z.enum(['agreed', 'interested', 'declined', 'unclear']),
})

export type CompatibilityVerdict = z.infer<typeof compatibilityVerdictSchema>

export const manualPersonaSchema = z.object({
  name: z.string().trim().min(1).max(80),
  bio: z.string().trim().min(1).max(600),
  traits: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  interests: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  style: z.string().trim().min(1).max(400),
  values: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  lifeGoals: z.object({
    wantChildren: z.enum(['yes', 'no', 'unsure', 'not_disclosed']),
    relationshipType: z.enum(['monogamous', 'non_monogamous', 'unsure', 'not_disclosed']),
  }).default({ wantChildren: 'not_disclosed', relationshipType: 'not_disclosed' }),
  relationshipPreferences: z.object({
    planning: z.enum(['planned', 'flexible', 'spontaneous', 'not_disclosed']),
    communication: z.enum(['frequent', 'balanced', 'space', 'not_disclosed']),
  }).default({ planning: 'not_disclosed', communication: 'not_disclosed' }),
})

export type ManualPersona = z.infer<typeof manualPersonaSchema>
