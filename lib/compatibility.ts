import type { CompatibilityAnalysis, CompatibilityVerdict } from '@/lib/psychology/schemas'

export type MeetingIntent = 'agreed' | 'interested' | 'declined' | 'unclear'
export type ConversationScenario = 'natural' | 'friction'
export type { CompatibilityAnalysis, CompatibilityVerdict }

export const CONVERSATION_TURNS = 6

export const scenarioInstructions: Record<ConversationScenario, string> = {
  natural: `Treat this as mutual discovery, not a performance of chemistry. Be genuinely curious: build on a specific shared interest or value when one appears, ask a focused question that could reveal meaningful common ground, and propose a small, low-pressure idea only when it follows from concrete shared evidence. Do not manufacture agreement, attraction, or a plan merely to keep the exchange warm. If the conversation reveals repeated, concrete incompatibilities in values, preferences, communication pace, or goals—and no meaningful shared ground—respond honestly and kindly that this does not feel like a fit. A respectful decline is a valid outcome. Do not treat missing information or a short conversation as incompatibility: when evidence is thin, remain curious or uncertain rather than rejecting.`,
  friction: `This is a deliberate incompatibility scenario. The agents should develop noticeable interpersonal friction and may strongly dislike the interaction. Make that visible through mismatched pacing, poor reciprocity, impatience, dismissive but civil replies, competing conversational goals, or unresolved disagreement. Do not force warmth, agreement, reconciliation, or a plan to meet. Do not use threats, slurs, harassment, or dehumanizing language.`,
}

export function aggregateMeetingIntent(a: MeetingIntent, b: MeetingIntent): MeetingIntent {
  if (a === 'agreed' && b === 'agreed') return 'agreed'
  if (a === 'declined' || b === 'declined') return 'declined'
  if (a === 'interested' || b === 'interested') return 'interested'
  return 'unclear'
}

const signalValues = {
  compatibility: { weak: 0, mixed: 50, strong: 100 },
  friction: { high: 0, moderate: 35, low: 70, none: 100 },
  reciprocity: { weak: 0, mixed: 50, strong: 100 },
  pacing: { mismatched: 0, mixed: 50, aligned: 100 },
  connection: { absent: 0, uncertain: 50, present: 100 },
} as const

export function scoreFromAnalysis(analysis: CompatibilityAnalysis) {
  if (analysis.sharedGround === 'limited') return 50
  const score = (
    signalValues.compatibility[analysis.compatibility] * 0.25
    + signalValues.friction[analysis.friction] * 0.2
    + signalValues.reciprocity[analysis.reciprocity] * 0.2
    + signalValues.pacing[analysis.pacing] * 0.15
    + signalValues.connection[analysis.connection] * 0.2
  )
  return Math.round(Math.max(0, Math.min(100, score)))
}

export function finalizeVerdictScores<T extends CompatibilityVerdict>(a: T, b: T) {
  const scored = {
    a: { ...a, score: scoreFromAnalysis(a.analysis) },
    b: { ...b, score: scoreFromAnalysis(b.analysis) },
  }
  // Limited shared ground is neutral, rather than proof of positive chemistry or a hard conflict.
  // Either participant can identify it from the shared transcript, so the displayed outcome is reciprocal.
  const neutralScores = a.analysis.sharedGround === 'limited' || b.analysis.sharedGround === 'limited'
    ? { a: { ...scored.a, score: 50 }, b: { ...scored.b, score: 50 } }
    : scored
  const mutualAgreement = a.meetingIntent === 'agreed' && b.meetingIntent === 'agreed'
  const verdicts = mutualAgreement
    ? { a: { ...neutralScores.a, score: Math.max(1, neutralScores.a.score) }, b: { ...neutralScores.b, score: Math.max(1, neutralScores.b.score) } }
    : neutralScores
  return {
    verdicts,
    compatibilityScore: Math.round((verdicts.a.score + verdicts.b.score) / 2),
    meetingIntent: aggregateMeetingIntent(verdicts.a.meetingIntent, verdicts.b.meetingIntent),
  }
}
