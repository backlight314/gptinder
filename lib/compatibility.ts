export type MeetingIntent = 'agreed' | 'interested' | 'declined' | 'unclear'
export type ConversationScenario = 'natural' | 'friction'
export type CompatibilityAnalysis = {
  compatibility: 'strong' | 'mixed' | 'weak'
  friction: 'none' | 'low' | 'moderate' | 'high'
  reciprocity: 'strong' | 'mixed' | 'weak'
  pacing: 'aligned' | 'mixed' | 'mismatched'
  connection: 'present' | 'uncertain' | 'absent'
  rationale: string
}
export type CompatibilityVerdict = {
  summary: string
  strengths: string[]
  considerations: string[]
  analysis: CompatibilityAnalysis
  meetingIntent: MeetingIntent
}

export const CONVERSATION_TURNS = 6

export const scenarioInstructions: Record<ConversationScenario, string> = {
  natural: `Let the interaction develop from the two snapshots. Positive chemistry, neutrality, uncertainty, or poor fit are all valid outcomes. Do not force either a romantic connection or a rejection.`,
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
  const mutualAgreement = a.meetingIntent === 'agreed' && b.meetingIntent === 'agreed'
  const verdicts = mutualAgreement
    ? { a: { ...scored.a, score: Math.max(1, scored.a.score) }, b: { ...scored.b, score: Math.max(1, scored.b.score) } }
    : scored
  return {
    verdicts,
    compatibilityScore: Math.round((verdicts.a.score + verdicts.b.score) / 2),
    meetingIntent: aggregateMeetingIntent(verdicts.a.meetingIntent, verdicts.b.meetingIntent),
  }
}
