import { describe, expect, it } from 'vitest'
import { CONVERSATION_TURNS, aggregateMeetingIntent, finalizeVerdictScores, scoreFromAnalysis, type CompatibilityAnalysis } from './compatibility'

const analysis = (overrides: Partial<CompatibilityAnalysis> = {}): CompatibilityAnalysis => ({
  compatibility: 'mixed',
  friction: 'low',
  reciprocity: 'mixed',
  pacing: 'mixed',
  connection: 'uncertain',
  sharedGround: 'unclear',
  rationale: 'The exchange provides mixed evidence.',
  ...overrides,
})
const verdict = (meetingIntent: 'agreed' | 'interested' | 'declined' | 'unclear', overrides: Partial<CompatibilityAnalysis> = {}) => ({
  summary: 'A grounded summary.',
  strengths: ['They responded to each other.'],
  considerations: ['The short exchange leaves uncertainty.'],
  analysis: analysis(overrides),
  meetingIntent,
})

describe('compatibility outcome analysis', () => {
  it('requires both agents to agree before returning agreed', () => {
    expect(aggregateMeetingIntent('agreed', 'interested')).toBe('interested')
    expect(aggregateMeetingIntent('agreed', 'declined')).toBe('declined')
    expect(aggregateMeetingIntent('unclear', 'unclear')).toBe('unclear')
  })

  it('uses ten turns so both participants can establish shared ground', () => {
    expect(CONVERSATION_TURNS).toBe(10)
  })

  it('never returns a zero score when both agents explicitly agree to meet', () => {
    const result = finalizeVerdictScores(verdict('agreed', { compatibility: 'weak', friction: 'high', reciprocity: 'weak', pacing: 'mismatched', connection: 'absent' }), verdict('agreed', { compatibility: 'weak', friction: 'high', reciprocity: 'weak', pacing: 'mismatched', connection: 'absent' }))
    expect(result.compatibilityScore).toBe(1)
    expect(result.verdicts.a.score).toBe(1)
    expect(result.verdicts.b.score).toBe(1)
    expect(result.meetingIntent).toBe('agreed')
  })

  it('preserves a zero score when there is no mutual agreement', () => {
    const result = finalizeVerdictScores(verdict('declined', { compatibility: 'weak', friction: 'high', reciprocity: 'weak', pacing: 'mismatched', connection: 'absent' }), verdict('unclear', { compatibility: 'weak', friction: 'high', reciprocity: 'weak', pacing: 'mismatched', connection: 'absent' }))
    expect(result.compatibilityScore).toBe(0)
    expect(result.meetingIntent).toBe('declined')
  })

  it('derives a strong score from strong conversational evidence', () => {
    expect(scoreFromAnalysis({ compatibility: 'strong', friction: 'none', reciprocity: 'strong', pacing: 'aligned', connection: 'present', sharedGround: 'meaningful', rationale: 'Strong evidence.' })).toBe(100)
  })

  it('derives a low score from friction and missing connection', () => {
    expect(scoreFromAnalysis({ compatibility: 'weak', friction: 'high', reciprocity: 'weak', pacing: 'mismatched', connection: 'absent', sharedGround: 'unclear', rationale: 'Weak evidence.' })).toBe(0)
  })

  it('gives both people a neutral score when either identifies limited shared ground', () => {
    const result = finalizeVerdictScores(
      verdict('declined', { compatibility: 'weak', connection: 'absent', sharedGround: 'limited' }),
      verdict('unclear', { compatibility: 'mixed', connection: 'uncertain', sharedGround: 'unclear' }),
    )
    expect(result.verdicts.a.score).toBe(50)
    expect(result.verdicts.b.score).toBe(50)
    expect(result.compatibilityScore).toBe(50)
    expect(result.meetingIntent).toBe('declined')
  })

  it('changes with qualitative analysis rather than an arbitrary model number', () => {
    const result = finalizeVerdictScores(verdict('unclear'), verdict('unclear', { compatibility: 'strong', friction: 'none', reciprocity: 'strong', pacing: 'aligned', connection: 'present' }))
    expect(result.verdicts.a.score).toBe(54)
    expect(result.verdicts.b.score).toBe(100)
    expect(result.compatibilityScore).toBe(77)
  })
})
