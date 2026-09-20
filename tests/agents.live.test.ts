// @vitest-environment node
import { expect, it } from 'vitest'
import { buildFrozenProfile, validateProfileEvidence } from '@/lib/psychology/profile'
import { manualPersonaSchema } from '@/lib/psychology/schemas'
import { buildAccountContext, interpretMessage, speakAsPersona, buildReactionAdaptation } from '@/lib/agents/openai'
import { buildStoredAdaptation, interpreterGuidanceText, validateMessageEvidence } from '@/lib/learning/adaptation'

it.skipIf(process.env.RUN_LIVE_AGENTS !== '1')('validates real account context, reaction, reply, and positive/negative learning outputs', async () => {
  const profile = buildFrozenProfile('usr_live_synthetic', manualPersonaSchema.parse({ name: 'Alex', bio: 'Enjoys quiet coffee shops and drawing.', traits: ['curious'], interests: ['coffee', 'drawing'], style: 'lowercase, casual short messages', values: ['kindness'] }))
  const model = process.env.OPENAI_MODEL_A || process.env.OPENAI_MODEL
  const built = await buildAccountContext({
    userId: profile.userId,
    rawMongoDocuments: { persona: [{ id: 'personas:live', text: 'name: Alex\ninterests: coffee, drawing\nstyle: lowercase, casual short messages' }], discordMessages: [{ id: 'discord_messages:1', text: 'yeah sounds good lol' }, { id: 'discord_messages:2', text: 'wanna grab coffee later?' }] },
    sourceStats: [],
    model,
  })
  const accountContext = { revision: 1, compiledPrompt: built.compiledPrompt }
  const incomingMessage = { id: 'live:message:0', from: 'b', text: 'Want to find a quiet coffee shop Saturday?' }
  const interpretation = await interpretMessage({ profile, accountContext, incomingMessage, history: [incomingMessage], scenario: 'Plan a date.', temporaryState: null, adaptationGuidance: null, model })
  validateProfileEvidence(profile, interpretation.evidenceIds)
  expect(interpretation.messageEvidence.every(item => item.messageId === incomingMessage.id && incomingMessage.text.includes(item.quote))).toBe(true)
  const reply = await speakAsPersona({ profile, accountContext, incomingMessage, interpretation, history: [incomingMessage], scenario: 'Plan a date.', model })
  validateProfileEvidence(profile, reply.usedProfileEvidence)
  expect(reply.text).toBe(reply.text.toLowerCase())
  for (const outcome of ['positive', 'negative'] as const) {
    const adaptation = await buildReactionAdaptation({ profile, accountContext, outcome, messages: [incomingMessage], ownInterpretations: [interpretation], previousAdaptation: null, model })
    validateMessageEvidence([incomingMessage.id], adaptation)
    const stored = buildStoredAdaptation({ userId: profile.userId, encounterId: `live:${outcome}`, outcome, adaptation, previous: null })
    expect(stored.resolvedBias).toBe(outcome === 'positive' ? 'more_positive' : 'more_negative')
    const next = await interpretMessage({ profile, accountContext, incomingMessage, history: [incomingMessage], scenario: 'Plan a date.', temporaryState: null, adaptationGuidance: interpreterGuidanceText(stored), model })
    validateProfileEvidence(profile, next.evidenceIds)
  }
}, 300000)
