import { describe, expect, it } from 'vitest'
import { calculateCompatibility, calculateConversationCompatibility } from '../lib/psychology/compatibility'
import { buildFrozenProfile, validateProfileEvidence } from '../lib/psychology/profile'
import type { ManualPersona } from '../lib/psychology/schemas'
import { buildVoiceProfile, validateVoiceEvidence } from '../lib/voice/profile'
import { normalizeDiscordExport } from '../scripts/import-discord-voice.mjs'
import {
  buildStoredAdaptation,
  interpreterGuidanceText,
  resolveReactionBias,
  validateMessageEvidence,
} from '../lib/learning/adaptation'
import type { ReactionAdaptationOutput } from '../lib/learning/schemas'

function persona(overrides: Partial<ManualPersona> = {}): ManualPersona {
  return {
    name: 'Alex', bio: 'Enjoys quiet weekends and thoughtful conversation.',
    traits: ['warm', 'curious'], interests: ['books'], style: 'Warm, concise questions.',
    values: ['benevolence'],
    lifeGoals: { wantChildren: 'yes', relationshipType: 'monogamous' },
    relationshipPreferences: { planning: 'planned', communication: 'balanced' },
    ...overrides,
  }
}

describe('frozen psychological profiles', () => {
  it('keeps unmeasured psychological scores unknown and traces explicit evidence', () => {
    const profile = buildFrozenProfile('usr_alex', persona())
    expect(profile.behavior.bigFive.extraversion.score).toBeNull()
    expect(profile.attachmentRegulation.anxiety.score).toBeNull()
    expect(profile.values.personalValues.benevolence.evidenceIds).toEqual(['usr_alex:values'])
    expect(() => validateProfileEvidence(profile, ['usr_alex:values'])).not.toThrow()
    expect(() => validateProfileEvidence(profile, ['invented'])).toThrow(/Unknown profile evidence/)
  })

  it('creates stable content addressed versions', () => {
    expect(buildFrozenProfile('usr_alex', persona()).profileVersionId)
      .toBe(buildFrozenProfile('usr_alex', persona()).profileVersionId)
  })
})

describe('deterministic compatibility', () => {
  it('scores confirmed goals and preferences while preserving unknown coverage', () => {
    const alex = buildFrozenProfile('usr_alex', persona())
    const blair = buildFrozenProfile('usr_blair', persona({
      name: 'Blair',
      lifeGoals: { wantChildren: 'yes', relationshipType: 'monogamous' },
      relationshipPreferences: { planning: 'spontaneous', communication: 'not_disclosed' },
    }))
    const result = calculateCompatibility(alex, blair)
    expect(result.label).toBe('App compatibility score')
    expect(result.coverage).toBe(4)
    expect(result.features.find(item => item.key === 'communication')?.outcome).toBe('unknown')
    expect(result.features.find(item => item.key === 'planning')?.outcome).toBe('different')
  })

  it('derives the displayed score from conversation analysis and floors mutual agreement at one', () => {
    const assessment = {
      summary: 'The exchange was tense but ended with a plan.',
      strengths: ['Both participants made a concrete plan.'],
      considerations: ['The exchange still contained friction.'],
      analysis: { compatibility: 'weak' as const, friction: 'high' as const, reciprocity: 'weak' as const, pacing: 'mismatched' as const, connection: 'absent' as const, sharedGround: 'unclear' as const, rationale: 'The qualitative evidence is poor.' },
      meetingIntent: 'agreed' as const,
    }
    const result = calculateConversationCompatibility(assessment, assessment)
    expect(result.label).toBe('Conversation analysis score')
    expect(result.score).toBe(1)
    expect(result.meetingIntent).toBe('agreed')
    expect(result.features).toHaveLength(6)
  })
})

describe('frozen voice profiles', () => {
  it('keeps declared style and deduplicated first-party writing as separate evidence', () => {
    const samples = [
      { evidenceId: 'discord:1', source: 'discord' as const, text: 'yeah that works lol', occurredAt: null },
      { evidenceId: 'discord:2', source: 'discord' as const, text: 'YEAH  THAT WORKS LOL', occurredAt: null },
      { evidenceId: 'linkedin:1', source: 'linkedin' as const, text: 'A longer professional update.', occurredAt: null },
    ]
    const profile = buildVoiceProfile('usr_alex', 'Usually concise.', samples)
    expect(profile.samples.map(sample => sample.evidenceId))
      .toEqual(['usr_alex:declared-style', 'discord:1', 'discord:2', 'linkedin:1'])
    expect(() => validateVoiceEvidence(profile, ['discord:1'])).not.toThrow()
    expect(() => validateVoiceEvidence(profile, ['discord:missing'])).toThrow(/Unknown voice evidence/)
  })

  it('creates a stable content-addressed version for the same voice evidence', () => {
    const samples = [{ evidenceId: 'discord:1', source: 'discord' as const, text: 'all lowercase', occurredAt: null }]
    expect(buildVoiceProfile('usr_alex', 'Concise.', samples).voiceProfileVersionId)
      .toBe(buildVoiceProfile('usr_alex', 'Concise.', samples).voiceProfileVersionId)
  })
})

describe('discord voice import', () => {
  const exported = {
    user_id: '1234',
    source: 'discord',
    messages: [
      { content: 'sounds good to me', timestamp: '2026-01-02T10:00:00+00:00', message_id: '9001' },
      { content: 'sounds good to me', timestamp: '2026-01-02T10:00:00+00:00', message_id: '9001' },
      { content: '   ', timestamp: '2026-01-02T10:05:00+00:00' },
      { content: 'no id here', timestamp: 'not-a-date' },
      { content: 'no id here', timestamp: '2026-01-02T10:10:00+00:00' },
    ],
  }

  it('keeps one owner-scoped document per exported message', () => {
    const documents = normalizeDiscordExport('usr_alex', exported)
    expect(documents.map(document => document.text)).toEqual(['sounds good to me', 'no id here'])
    expect(documents[0]._id).toBe('usr_alex:discord:9001')
    expect(documents.every(document => document.userId === 'usr_alex' && document.source === 'discord')).toBe(true)
  })

  it('addresses messages without an id by content so reimports stay idempotent', () => {
    expect(normalizeDiscordExport('usr_alex', exported).map(document => document._id))
      .toEqual(normalizeDiscordExport('usr_alex', exported).map(document => document._id))
  })

  it('rejects an export from another source', () => {
    expect(() => normalizeDiscordExport('usr_alex', { source: 'slack', messages: [] })).toThrow(/Unsupported export source/)
  })
})

describe('post date learning', () => {
  const adaptation: ReactionAdaptationOutput = {
    reactionBias: 'more_positive',
    guidance: 'Treat a short reply about keeping plans open as possible flexibility rather than possible disinterest.',
    cues: [{
      cue: 'short reply about plans',
      direction: 'positive',
      reason: 'The reported date followed this exchange.',
      messageEvidenceIds: ['enc_1:message:2'],
    }],
    confidence: 'low',
  }

  it('uses the confirmed outcome for both positive and negative cue weighting', () => {
    expect(resolveReactionBias('negative', 'more_positive')).toBe('more_negative')
    expect(resolveReactionBias('negative', 'unchanged')).toBe('more_negative')
    expect(resolveReactionBias('positive', 'more_positive')).toBe('more_positive')
    expect(resolveReactionBias('positive', 'more_negative')).toBe('more_positive')
  })

  it('rejects cues quoting a message that is not in the encounter', () => {
    expect(() => validateMessageEvidence(['enc_1:message:2'], adaptation)).not.toThrow()
    expect(() => validateMessageEvidence(['enc_1:message:3'], adaptation)).toThrow(/Unknown message evidence/)
  })

  it('versions each adaptation and accumulates confirmed outcomes', () => {
    const first = buildStoredAdaptation({
      userId: 'usr_alex', encounterId: 'enc_1', outcome: 'positive', adaptation, previous: null,
    })
    expect(first.version).toBe(1)
    expect(first.adaptationVersionId).toBe('usr_alex:reaction:1')
    expect(first.outcomeTally).toEqual({ positive: 1, negative: 0 })

    const second = buildStoredAdaptation({
      userId: 'usr_alex', encounterId: 'enc_2', outcome: 'negative', adaptation, previous: first,
    })
    expect(second.version).toBe(2)
    expect(second.resolvedBias).toBe('more_negative')
    expect(second.outcomeTally).toEqual({ positive: 1, negative: 1 })
    expect(second.basedOnEncounterIds).toEqual(['enc_1', 'enc_2'])
  })

  it('produces interpreter guidance only once an outcome has been confirmed', () => {
    expect(interpreterGuidanceText(null)).toBeNull()
    const stored = buildStoredAdaptation({
      userId: 'usr_alex', encounterId: 'enc_1', outcome: 'positive', adaptation, previous: null,
    })
    const text = interpreterGuidanceText(stored)
    expect(text).toContain('Learned reaction guidance version 1')
    expect(text).toContain('short reply about plans')
    expect(text).toContain('changes weighting only')
  })
})
