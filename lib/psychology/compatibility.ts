import type { FrozenProfile } from './schemas'
import { finalizeVerdictScores, type CompatibilityVerdict, type MeetingIntent } from '@/lib/compatibility'

type ScoredVerdict = CompatibilityVerdict & { score: number }

export type CompatibilityResult = {
  label: 'App compatibility score' | 'Conversation analysis score'
  score: number | null
  coverage: number
  features: Array<{ key: string; outcome: string; detail: string }>
  scenario?: 'natural' | 'friction'
  meetingIntent?: MeetingIntent | null
  verdicts?: { a: ScoredVerdict; b: ScoredVerdict } | null
}

function value(profile: FrozenProfile, group: 'explicitLifeGoals' | 'relationshipPreferences', key: string) {
  return profile.values[group][key]?.description ?? 'not_disclosed'
}

export function calculateCompatibility(a: FrozenProfile, b: FrozenProfile): CompatibilityResult {
  const pairs = [
    ['wantChildren', value(a, 'explicitLifeGoals', 'wantChildren'), value(b, 'explicitLifeGoals', 'wantChildren')],
    ['relationshipType', value(a, 'explicitLifeGoals', 'relationshipType'), value(b, 'explicitLifeGoals', 'relationshipType')],
    ['planning', value(a, 'relationshipPreferences', 'planning'), value(b, 'relationshipPreferences', 'planning')],
    ['communication', value(a, 'relationshipPreferences', 'communication'), value(b, 'relationshipPreferences', 'communication')],
  ] as const
  const features: CompatibilityResult['features'] = pairs.map(([key, left, right]) => {
    if (left === 'not_disclosed' || right === 'not_disclosed' || left === 'unsure' || right === 'unsure')
      return { key, outcome: 'unknown' as const, detail: 'One or both profiles do not contain a confirmed answer.' }
    return left === right
      ? { key, outcome: 'aligned' as const, detail: `Both profiles report ${left}.` }
      : { key, outcome: 'different' as const, detail: `The profiles report ${left} and ${right}.` }
  })
  const known: CompatibilityResult['features'] = features.filter(item => item.outcome !== 'unknown')
  const aligned = known.filter(item => item.outcome === 'aligned').length
  const sharedValues = Object.keys(a.values.personalValues).filter(key => key in b.values.personalValues)
  if (Object.keys(a.values.personalValues).length && Object.keys(b.values.personalValues).length) {
    features.push({ key: 'personalValues', outcome: sharedValues.length ? 'aligned' : 'different', detail: sharedValues.length ? `Shared values: ${sharedValues.join(', ')}.` : 'No shared value was explicitly entered.' })
    known.push(features.at(-1)!)
  }
  const score = known.length ? Math.round(((aligned + (sharedValues.length ? 1 : 0)) / known.length) * 100) : null
  return { label: 'App compatibility score', score, coverage: known.length, features }
}

export function conversationFeatures(a: ScoredVerdict, b: ScoredVerdict): CompatibilityResult['features'] {
  const dimensions = ['compatibility', 'friction', 'reciprocity', 'pacing', 'connection', 'sharedGround'] as const
  return dimensions.map(key => ({
    key,
    outcome: a.analysis[key] === b.analysis[key] ? 'aligned' : 'different',
    detail: `A marked ${key} ${a.analysis[key]}; B marked ${key} ${b.analysis[key]}.`,
  }))
}

export function calculateConversationCompatibility(a: CompatibilityVerdict, b: CompatibilityVerdict): CompatibilityResult {
  const result = finalizeVerdictScores(a, b)
  return {
    label: 'Conversation analysis score',
    score: result.compatibilityScore,
    coverage: 6,
    features: conversationFeatures(result.verdicts.a, result.verdicts.b),
    meetingIntent: result.meetingIntent,
    verdicts: result.verdicts,
  }
}
