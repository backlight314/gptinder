import { describe, expect, it } from 'vitest'
import { aggregateMeetingIntent, finalizeVerdictScores } from './compatibility'

const verdict = (score: number, meetingIntent: 'agreed' | 'interested' | 'declined' | 'unclear') => ({ score, meetingIntent })

describe('compatibility outcome analysis', () => {
  it('requires both agents to agree before returning agreed', () => {
    expect(aggregateMeetingIntent('agreed', 'interested')).toBe('interested')
    expect(aggregateMeetingIntent('agreed', 'declined')).toBe('declined')
    expect(aggregateMeetingIntent('unclear', 'unclear')).toBe('unclear')
  })

  it('never returns a zero score when both agents explicitly agree to meet', () => {
    const result = finalizeVerdictScores(verdict(0, 'agreed'), verdict(0, 'agreed'))
    expect(result.compatibilityScore).toBe(1)
    expect(result.verdicts.a.score).toBe(1)
    expect(result.verdicts.b.score).toBe(1)
    expect(result.meetingIntent).toBe('agreed')
  })

  it('preserves a zero score when there is no mutual agreement', () => {
    const result = finalizeVerdictScores(verdict(0, 'declined'), verdict(0, 'unclear'))
    expect(result.compatibilityScore).toBe(0)
    expect(result.meetingIntent).toBe('declined')
  })
})
