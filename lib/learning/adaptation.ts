import {
  storedAdaptationSchema,
  type DateOutcome,
  type ReactionAdaptationOutput,
  type ReactionBias,
  type StoredAdaptation,
} from './schemas'

// Pre-date traits did not predict partner-specific desire; feedback is contextual evidence, not a causal explanation.
// https://doi.org/10.1177/0956797617714580
export function resolveReactionBias(outcome: DateOutcome, proposed: ReactionBias): ReactionBias {
  void proposed
  return outcome === 'negative' ? 'more_negative' : 'more_positive'
}

export function validateMessageEvidence(allowedMessageIds: string[], adaptation: ReactionAdaptationOutput) {
  const allowed = new Set(allowedMessageIds)
  const invalid = adaptation.cues.flatMap(cue => cue.messageEvidenceIds).filter(id => !allowed.has(id))
  if (invalid.length) throw new Error(`Unknown message evidence: ${invalid.join(', ')}`)
}

// Preference matching has weak predictive validity, so an adaptation stores observed cues instead of new trait scores.
// https://doi.org/10.1177/0146167218780689
export function buildStoredAdaptation(input: {
  userId: string
  encounterId: string
  outcome: DateOutcome
  adaptation: ReactionAdaptationOutput
  previous: StoredAdaptation | null
}): StoredAdaptation {
  const version = (input.previous?.version ?? 0) + 1
  const tally = input.previous?.outcomeTally ?? { positive: 0, negative: 0 }
  const basedOnEncounterIds = [...(input.previous?.basedOnEncounterIds ?? []), input.encounterId].slice(-50)
  return storedAdaptationSchema.parse({
    ...input.adaptation,
    confidence: 'low',
    cues: [...(input.previous?.cues ?? []), ...input.adaptation.cues.map(cue => ({ ...cue, direction: input.outcome }))].slice(-6),
    adaptationVersionId: `${input.userId}:reaction:${version}`,
    userId: input.userId,
    version,
    resolvedBias: resolveReactionBias(input.outcome, input.adaptation.reactionBias),
    outcomeTally: {
      positive: tally.positive + (input.outcome === 'positive' ? 1 : 0),
      negative: tally.negative + (input.outcome === 'negative' ? 1 : 0),
    },
    basedOnEncounterIds,
  })
}


// One occasion is a personality state, so learned guidance shapes weighting only and never rewrites the frozen profile.
// https://doi.org/10.1177/10731911211008254
export function interpreterGuidanceText(adaptation: StoredAdaptation | null) {
  if (!adaptation) return null
  const cues = adaptation.cues.map(cue => `${cue.cue} (${cue.direction}): ${cue.reason}`).join('\n')
  return [
    `Learned reaction guidance version ${adaptation.version}, derived from ${adaptation.outcomeTally.positive} confirmed good and ${adaptation.outcomeTally.negative} confirmed poor date reports.`,
    'For each matching cue, positive means a slightly more favorable reading; negative means slightly more caution. Contradictory reports increase uncertainty. Never generalize to all people.',
    'Apply only to clearly matching cues. Never change the overall reaction to unrelated messages. A binary outcome cannot establish what caused the date to go well or poorly.',
    `Cues observed before:\n${cues}`,
    'This guidance changes weighting only. Do not treat it as a profile fact, a diagnosis, or evidence about the other person.',
  ].join('\n\n')
}
