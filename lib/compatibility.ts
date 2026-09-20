export type MeetingIntent = 'agreed' | 'interested' | 'declined' | 'unclear'
export type ConversationScenario = 'natural' | 'friction'

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

export function finalizeVerdictScores<T extends { score: number; meetingIntent: MeetingIntent }>(a: T, b: T) {
  const mutualAgreement = a.meetingIntent === 'agreed' && b.meetingIntent === 'agreed'
  const verdicts = mutualAgreement
    ? { a: { ...a, score: Math.max(1, a.score) }, b: { ...b, score: Math.max(1, b.score) } }
    : { a, b }
  return {
    verdicts,
    compatibilityScore: Math.round((verdicts.a.score + verdicts.b.score) / 2),
    meetingIntent: aggregateMeetingIntent(verdicts.a.meetingIntent, verdicts.b.meetingIntent),
  }
}
