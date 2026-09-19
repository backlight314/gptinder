import { z } from 'zod'

export const DIMENSIONS = [
  'planning',
  'socialSetting',
  'communication',
  'independence',
  'novelty',
] as const
export type Dimension = (typeof DIMENSIONS)[number]
export const DIMENSION_LABELS: Record<
  Dimension,
  { label: string; low: string; high: string }
> = {
  planning: {
    label: 'Advance planning',
    low: 'Spontaneous',
    high: 'Plans ahead',
  },
  socialSetting: {
    label: 'Social setting',
    low: 'Quiet / one-to-one',
    high: 'Lively / groups',
  },
  communication: {
    label: 'Communication',
    low: 'Reflective / occasional',
    high: 'Direct / frequent',
  },
  independence: {
    label: 'Independence',
    low: 'Lots of together time',
    high: 'Lots of personal space',
  },
  novelty: {
    label: 'New experiences',
    low: 'Familiar favorites',
    high: 'Trying new things',
  },
}
const normalized = z.number().min(0).max(1)
export const featuresSchema = z.object({
  planning: normalized.nullable(),
  socialSetting: normalized.nullable(),
  communication: normalized.nullable(),
  independence: normalized.nullable(),
  novelty: normalized.nullable(),
})
const preferenceDimension = z.object({
  desired: normalized.nullable(),
  importance: z.number().int().min(0).max(5),
})
export const preferencesSchema = z.object({
  planning: preferenceDimension,
  socialSetting: preferenceDimension,
  communication: preferenceDimension,
  independence: preferenceDimension,
  novelty: preferenceDimension,
})
export type Features = z.infer<typeof featuresSchema>
export type Preferences = z.infer<typeof preferencesSchema>
export const defaultPreferences = (): Preferences =>
  Object.fromEntries(
    DIMENSIONS.map((d) => [d, { desired: null, importance: 1 }]),
  ) as Preferences
export const emptyFeatures = (): Features =>
  Object.fromEntries(DIMENSIONS.map((d) => [d, null])) as Features
export const surveySchema = z.array(z.number().int().min(1).max(7)).length(10)
export const questionSchema = z.object({
  domain: z.enum(DIMENSIONS),
  goal: z.string().min(1).max(200),
  evidenceIds: z.array(z.string().max(100)).max(20),
  question: z.string().min(10).max(600),
})
export const shareableSchema = z.object({
  summary: z.string().min(10).max(1800),
  traits: z.array(z.string().min(1).max(50)).max(8),
  interests: z.array(z.string().min(1).max(80)).max(8),
  style: z.string().min(1).max(400),
  features: featuresSchema,
})
export const draftSchema = shareableSchema.extend({
  unresolved: z.array(z.string().max(300)).max(10),
  evidenceIds: z.array(z.string().max(100)).max(30),
})
export type Shareable = z.infer<typeof shareableSchema>
export type ProfileDraft = z.infer<typeof draftSchema>
export const consentSchema = z.object({
  adult: z.literal(true),
  survey: z.literal(true),
  aiProcessing: z.literal(true),
  sharedProfile: z.literal(true),
  importedInformation: z.boolean(),
})
export type ConsentFlags = z.infer<typeof consentSchema>
export interface User {
  _id: string
  displayName: string
  accessKeyHash: string
  email?: string
  emailVerifiedAt?: Date
  createdAt: Date
  profileVersionId?: string
  preferenceVersionId?: string
  styleVersionId?: string
  demo?: boolean
}
export interface Consent {
  _id: string
  userId: string
  flags: ConsentFlags
  createdAt: Date
}
export interface Evidence {
  _id: string
  userId: string
  source: string
  excerpt: string
  approved: boolean
  createdAt: Date
}
export interface Interview {
  _id: string
  userId: string
  revision: number
  stage:
    | 'survey'
    | 'question_pending'
    | 'answer_pending'
    | 'draft_pending'
    | 'review'
    | 'approved'
  survey: number[]
  preferences: Preferences
  answers: {
    id: string
    question: z.infer<typeof questionSchema>
    text: string
  }[]
  currentQuestion?: z.infer<typeof questionSchema>
  draft?: ProfileDraft
  leaseId?: string
  leaseUntil?: Date
  createdAt: Date
}
export interface ProfileVersion {
  _id: string
  userId: string
  version: number
  shareable: Shareable
  surveyScores: Record<string, number>
  approvedAt: Date
  avatarSeed: string
  approvedEvidenceIds: string[]
  styleVersionId: string
  sourceIds: string[]
  invalidatedAt?: Date
}
export interface PreferenceVersion {
  _id: string
  userId: string
  version: number
  dimensions: Preferences
  previousVersionId?: string
  sourceFeedbackId?: string
  createdAt: Date
}
export interface BadgeBinding {
  _id: string
  tokenHash: string
  userId: string
  profileUrl: string
  status: 'active' | 'revoked'
  expiresAt: Date
  createdAt: Date
}
export interface FrozenParticipant {
  userId: string
  name: string
  profileUrl: string
  profileVersionId: string
  preferenceVersionId: string
}
export interface Encounter {
  _id: string
  handshakeKey: string
  participants: [FrozenParticipant, FrozenParticipant]
  status: 'pending_start' | 'running' | 'complete' | 'failed'
  workflowRunId?: string
  dispatchLeaseUntil?: Date
  error?: string
  createdAt: Date
  completedAt?: Date
}
export const turnSchema = z.object({
  action: z.enum(['propose', 'clarify', 'agree', 'disagree']),
  text: z.string().min(1).max(1600),
  evidenceIds: z.array(z.string().max(100)).max(10),
})
export interface SimulationMessage extends z.infer<typeof turnSchema> {
  _id: string
  encounterId: string
  turnNumber: number
  speaker: string
  createdAt: Date
}
export interface Fit {
  dimension: Dimension
  desired: number
  actual: number
  importance: number
  fit: number
}
export interface DirectionalScore {
  score: number | null
  coverage: number
  knownDimensions: number
  eligibleDimensions: number
  breakdown: Fit[]
}
export const explanationSchema = z.object({
  strengths: z.array(z.string().max(400)).max(3),
  friction: z.array(z.string().max(400)).max(3),
})
export interface MatchResult {
  _id: string
  encounterId: string
  algorithmVersion: string
  inputVersions: FrozenParticipant[]
  directions: Record<string, DirectionalScore>
  explanations: z.infer<typeof explanationSchema>
  createdAt: Date
}
export interface DateFeedback {
  _id: string
  encounterId: string
  authorId: string
  outcome: 'positive' | 'mixed' | 'negative'
  explanation: string
  revision: number
  createdAt: Date
  updatedAt: Date
}
export const lessonSchema = z.object({
  decision: z.enum(['clarify', 'no_change', 'propose']),
  explanation: z.string().min(1).max(1000),
  clarification: z.string().max(400).nullable(),
  dimension: z.enum(DIMENSIONS).nullable(),
  desired: normalized.nullable(),
  importance: z.number().int().min(0).max(5).nullable(),
  supportingQuote: z.string().max(1000).nullable(),
})
export interface PreferenceUpdate {
  _id: string
  userId: string
  feedbackId: string
  feedbackRevision: number
  expectedVersionId: string
  lesson: z.infer<typeof lessonSchema>
  status: 'proposed' | 'applied' | 'no_change' | 'clarify'
  resultingVersionId?: string
  createdAt: Date
}
export interface MeResponse {
  user: Pick<User, '_id' | 'displayName' | 'demo'>
  interview: Interview | null
  profile: ProfileVersion | null
  preferences: PreferenceVersion | null
  style: import('./import-domain').StyleVersion | null
  evidence: Evidence[]
  badges: Pick<BadgeBinding, '_id' | 'expiresAt' | 'status' | 'profileUrl'>[]
}
export interface EncounterResponse {
  encounter: Encounter
  profiles: Pick<
    ProfileVersion,
    '_id' | 'userId' | 'shareable' | 'avatarSeed'
  >[]
  messages: SimulationMessage[]
  result: MatchResult | null
  comparison: {
    previousVersion: number
    currentVersion: number
    previous: DirectionalScore
    current: DirectionalScore
  } | null
}
