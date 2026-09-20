import { createHash } from 'node:crypto'
import { voiceProfileSchema, type VoiceProfile, type VoiceSample } from './schemas'

type SourceSample = Omit<VoiceSample, 'evidenceId'> & { evidenceId: string }

export function buildVoiceProfile(userId: string, declaredStyle: string, sourceSamples: SourceSample[]): VoiceProfile {
  const unique = new Map<string, SourceSample>()
  for (const sample of sourceSamples) {
    const key = sample.text.trim()
    if (key && !unique.has(key)) unique.set(key, sample)
  }
  const samples: VoiceSample[] = [
    { evidenceId: `${userId}:declared-style`, source: 'manual', text: declaredStyle, occurredAt: null },
    ...Array.from(unique.values()).slice(0, 31),
  ]
  const digest = createHash('sha256').update(JSON.stringify({ userId, declaredStyle, samples })).digest('hex').slice(0, 16)
  return voiceProfileSchema.parse({
    voiceProfileVersionId: `${userId}:voice:${digest}`,
    userId,
    frozenAt: new Date().toISOString(),
    declaredStyle,
    samples,
  })
}

export function validateVoiceEvidence(profile: VoiceProfile, evidenceIds: string[]) {
  const allowed = new Set(profile.samples.map(sample => sample.evidenceId))
  const invalid = evidenceIds.filter(id => !allowed.has(id))
  if (invalid.length) throw new Error(`Unknown voice evidence: ${invalid.join(', ')}`)
}
