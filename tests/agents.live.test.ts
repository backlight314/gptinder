// @vitest-environment node
import { expect, it } from 'vitest'
import { buildFrozenProfile, validateProfileEvidence } from '@/lib/psychology/profile'
import { manualPersonaSchema } from '@/lib/psychology/schemas'
import { buildVoiceProfile, validateVoiceEvidence } from '@/lib/voice/profile'
import { buildVoicePrompt, interpretMessage, speakAsPersona, buildReactionAdaptation } from '@/lib/agents/openai'
import { buildStoredAdaptation, interpreterGuidanceText, validateMessageEvidence } from '@/lib/learning/adaptation'

it.skipIf(process.env.RUN_LIVE_AGENTS !== '1')('validates real voice, reaction, reply, and positive/negative learning outputs', async () => {
  const profile = buildFrozenProfile('usr_live_synthetic', manualPersonaSchema.parse({ name: 'Alex', bio: 'Enjoys quiet coffee shops and drawing.', traits: ['curious'], interests: ['coffee', 'drawing'], style: 'lowercase, casual short messages', values: ['kindness'] }))
  const voiceProfile = buildVoiceProfile(profile.userId, 'lowercase, casual short messages', [
    { evidenceId: 'sample:1', source: 'discord', text: 'yeah sounds good lol', occurredAt: null },
    { evidenceId: 'sample:2', source: 'discord', text: 'wanna grab coffee later?', occurredAt: null },
  ])
  const model = process.env.OPENAI_MODEL_A || process.env.OPENAI_MODEL
  const voicePrompt = await buildVoicePrompt({ profile, voiceProfile, scenario: 'Plan a quiet coffee date.', model })
  validateVoiceEvidence(voiceProfile, voicePrompt.evidenceIds)
  const incomingMessage = { id: 'live:message:0', from: 'b', text: 'Want to find a quiet coffee shop Saturday?' }
  const interpretation = await interpretMessage({ profile, incomingMessage, history: [incomingMessage], scenario: 'Plan a date.', temporaryState: null, adaptationGuidance: null, model })
  validateProfileEvidence(profile, interpretation.evidenceIds)
  expect(interpretation.messageEvidence.every(item => item.messageId === incomingMessage.id && incomingMessage.text.includes(item.quote))).toBe(true)
  const reply = await speakAsPersona({ profile, incomingMessage, interpretation, history: [incomingMessage], scenario: 'Plan a date.', voicePrompt, model })
  validateProfileEvidence(profile, reply.usedProfileEvidence)
  expect(reply.text).toBe(reply.text.toLowerCase())
  for (const outcome of ['positive', 'negative'] as const) {
    const adaptation = await buildReactionAdaptation({ profile, outcome, messages: [incomingMessage], ownInterpretations: [interpretation], previousAdaptation: null, model })
    validateMessageEvidence([incomingMessage.id], adaptation)
    const stored = buildStoredAdaptation({ userId: profile.userId, encounterId: `live:${outcome}`, outcome, adaptation, previous: null })
    expect(stored.resolvedBias).toBe(outcome === 'positive' ? 'more_positive' : 'more_negative')
    const next = await interpretMessage({ profile, incomingMessage, history: [incomingMessage], scenario: 'Plan a date.', temporaryState: null, adaptationGuidance: interpreterGuidanceText(stored), model })
    validateProfileEvidence(profile, next.evidenceIds)
  }
}, 300000)
