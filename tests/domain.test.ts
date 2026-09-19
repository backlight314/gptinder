import { describe, expect, it } from 'vitest'
import { scoreCompatibility, scoreTipi } from '../lib/scoring'
import { DEMO_PREFERENCES, PARTNER_FEATURES } from '../lib/demo-fixtures'
import { defaultPreferences, emptyFeatures } from '../lib/domain'
import {
  bumpSchema,
  canonicalHandshake,
  parseBadgeLine,
  SerialLines,
  type BumpEvent,
} from '../lib/badge-protocol'
import { signSession, verifySession } from '../lib/server/auth'

export const bump: BumpEvent = {
  type: 'gptinder.encounter',
  version: 1,
  localToken: 'a'.repeat(32),
  peerToken: 'b'.repeat(32),
  localNonce: '1'.repeat(16),
  peerNonce: '2'.repeat(16),
}
describe('transparent scoring', () => {
  it('proves 76 -> 67 from planning importance only', () => {
    const updated = structuredClone(DEMO_PREFERENCES)
    updated.planning.importance = 2
    expect(scoreCompatibility(DEMO_PREFERENCES, PARTNER_FEATURES).score).toBe(
      76,
    )
    expect(scoreCompatibility(updated, PARTNER_FEATURES).score).toBe(67)
    expect(DEMO_PREFERENCES.planning.importance).toBe(1)
  })
  it('excludes unknown features and reports weighted coverage', () => {
    const p = structuredClone(DEMO_PREFERENCES)
    p.planning.importance = 2
    const result = scoreCompatibility(p, {
      ...PARTNER_FEATURES,
      planning: null,
    })
    expect(result.score).toBe(90)
    expect(result.coverage).toBeCloseTo(4 / 6)
    expect(result.knownDimensions).toBe(4)
    expect(
      scoreCompatibility(defaultPreferences(), emptyFeatures()).score,
    ).toBeNull()
    expect(() =>
      scoreCompatibility(p, { ...PARTNER_FEATURES, planning: 2 }),
    ).toThrow()
  })
  it('uses TIPI reverse items and published pairs', () => {
    expect(scoreTipi([5, 2, 6, 3, 7, 2, 5, 1, 6, 2])).toEqual({
      extraversion: 5.5,
      agreeableness: 5.5,
      conscientiousness: 6.5,
      emotionalStability: 5.5,
      openness: 6.5,
    })
    expect(() => scoreTipi([1, 2])).toThrow()
    expect(() => scoreTipi(Array(10).fill(8))).toThrow()
  })
})
describe('badge bridge protocol', () => {
  it('canonicalizes both perspectives of a single handshake', () => {
    expect(canonicalHandshake(bump)).toBe(
      canonicalHandshake({
        ...bump,
        localToken: bump.peerToken,
        peerToken: bump.localToken,
        localNonce: bump.peerNonce,
        peerNonce: bump.localNonce,
      }),
    )
    expect(
      canonicalHandshake({ ...bump, localNonce: '3'.repeat(16) }),
    ).not.toBe(canonicalHandshake(bump))
  })
  it('handles firmware tags, split chunks, duplicates and CRLF', () => {
    const lines = new SerialLines()
    const log = `[gptinder] GPTINDER:${JSON.stringify(bump)}\r\n`
    expect(lines.push(log.slice(0, 50))).toEqual([])
    expect(lines.push(log.slice(50) + log)).toEqual([bump, bump])
  })
  it('rejects malformed/self events and bounds oversized lines', () => {
    expect(
      bumpSchema.safeParse({ ...bump, peerToken: bump.localToken }).success,
    ).toBe(false)
    expect(
      bumpSchema.safeParse({
        ...bump,
        localToken: bump.peerToken,
        peerToken: bump.localToken,
        localNonce: bump.peerNonce,
        peerNonce: bump.localNonce,
      }).success,
    ).toBe(false)
    expect(parseBadgeLine('GPTINDER:{oops}')).toBeNull()
    const lines = new SerialLines()
    expect(lines.push('x'.repeat(10000))).toEqual([])
    expect(lines.push(`GPTINDER:${JSON.stringify(bump)}\n`)).toEqual([])
    expect(lines.push(`GPTINDER:${JSON.stringify(bump)}\n`)).toEqual([bump])
  })
})
describe('session integrity', () => {
  it('rejects tampering and expiry', () => {
    process.env.AUTH_SECRET = 'test-secret-'.repeat(4)
    process.env.APP_URL = 'http://localhost:3000'
    const value = signSession('alex', 1000)
    expect(verifySession(value, 2000)).toBe('alex')
    expect(verifySession(`x${value}`, 2000)).toBeNull()
    expect(verifySession(value, 1000 + 8 * 86400000)).toBeNull()
    expect(verifySession('bad')).toBeNull()
  })
})
