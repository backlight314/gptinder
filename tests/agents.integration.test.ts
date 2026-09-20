// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MongoMemoryServer } from 'mongodb-memory-server'
import { getMongoDatabase } from '@/lib/agents/database'
import { storePersona } from '@/lib/persona-store'
import { manualPersonaSchema } from '@/lib/psychology/schemas'
import { createEncounter, loadEncounter } from '@/lib/encounters/store'
import { claimEncounter, completeEncounter, runConversationTurn } from '@/lib/encounters/simulation'
import { adaptationForEncounter, latestAdaptation, listEncounters, recordEncounterFeedback, saveAdaptation } from '@/lib/learning/store'
import { buildStoredAdaptation } from '@/lib/learning/adaptation'
import { feedbackAdaptationWorkflow } from '@/workflows/feedback-adaptation'
import * as agents from '@/lib/agents/openai'
import { rebuildAgentContext } from '@/lib/agent-contexts/store'

vi.mock('workflow', () => ({ getWorkflowMetadata: () => ({ workflowRunId: 'test-feedback-run' }) }))
vi.mock('@/lib/agents/openai', () => ({
  buildAccountContext: vi.fn(async () => ({
    compiledPrompt: '## Texting style\nUse lowercase, short sentences, and casual punctuation matching the supplied samples.',
    sourceEvidenceIds: [],
  })),
  interpretMessage: vi.fn(async ({ profile, incomingMessage }) => ({
    literalMeaning: incomingMessage.text, possibleIntent: 'Possibly proposing a quiet meeting.',
    fourLensAnalysis: {
      behavior: { signal: 'May enjoy a quiet setting.' },
      interpersonal: { messageWarmth: 'medium', messageDominance: 'low', signal: 'A tentative invitation.' },
      attachmentRegulation: { possibleActivation: 'low', reason: 'No established attachment score.' },
      values: { relevantPreferences: [], signal: 'Preferences remain uncertain.' },
    },
    possibleUserReaction: { state: 'curious', strength: 'low' }, recommendedApproach: 'ask_question',
    openQuestion: '', uncertainty: 'high', evidenceIds: [profile.evidence[0].id],
    messageEvidence: [{ messageId: incomingMessage.id, quote: incomingMessage.text }],
    temporaryState: { engagement: 'medium', comfort: 'medium', tensionTopics: [], positiveTopics: [], unresolvedQuestions: [], boundariesTriggered: [] },
  })),
  speakAsPersona: vi.fn(async ({ profile, interpretation }) => ({
    action: 'ask_question', text: 'coffee somewhere quiet?', usedProfileEvidence: [profile.evidence[0].id],
    usedInterpretationSignals: interpretation ? [interpretation.recommendedApproach] : [],
    lensUsage: { behavior: [], interpersonal: [], attachmentRegulation: [], values: [] },
  })),
  assessConversation: vi.fn(async () => ({
    summary: 'The short exchange is inconclusive.',
    strengths: ['Both agents responded to the conversation.'],
    considerations: ['The short exchange does not establish a meeting plan.'],
    analysis: { compatibility: 'mixed', friction: 'low', reciprocity: 'mixed', pacing: 'mixed', connection: 'uncertain', sharedGround: 'unclear', rationale: 'The transcript provides mixed evidence.' },
    meetingIntent: 'unclear',
  })),
  buildReactionAdaptation: vi.fn(async ({ outcome, messages }) => ({
    reactionBias: outcome === 'positive' ? 'more_positive' : 'more_negative',
    guidance: 'Tentatively adjust reactions to similar quiet invitations, without assuming what caused the reported outcome.',
    cues: [{ cue: 'quiet coffee invitation', direction: outcome, reason: 'Observed before the reported date; causality unknown.', messageEvidenceIds: [messages[0].id] }],
    confidence: 'low',
  })),
}))

let mongo: MongoMemoryServer
let database: Awaited<ReturnType<typeof getMongoDatabase>>
const participants = { a: { userId: 'usr_agent_alex' }, b: { userId: 'usr_agent_sam' } }

beforeAll(async () => {
  mongo = await MongoMemoryServer.create()
  process.env.MONGODB_URI = mongo.getUri()
  process.env.MONGODB_DB = 'isolated_agent_tests'
  delete process.env.OPENAI_VECTOR_STORE_ID_A
  delete process.env.OPENAI_VECTOR_STORE_ID_B
  database = await getMongoDatabase()
  for (const key of ['a', 'b'] as const) {
    await storePersona(manualPersonaSchema.parse({ name: key === 'a' ? 'Alex' : 'Sam', bio: 'Enjoys quiet weekends.', traits: ['curious'], interests: ['coffee'], style: 'casual lowercase' }), key, participants[key].userId)
  }
  await database.collection('discord_messages').insertMany([
    { userId: participants.a.userId, text: 'yeah coffee works lol', createdAt: new Date() },
    { userId: 'usr_someone_else', text: 'DO NOT USE THIS SAMPLE', createdAt: new Date() },
  ])
  await database.collection('whatsapp_messages').insertOne({ userId: participants.a.userId, text: 'sounds good :)', createdAt: new Date() })
}, 60000)

afterAll(async () => {
  await (await global.__airosMongoClientPromise)?.close()
  global.__airosMongoClientPromise = undefined
  global.__airosMongoIndexesPromise = undefined
  await mongo?.stop()
})

async function conversation() {
  const id = await createEncounter({ participants, turns: 2 })
  expect(await claimEncounter(id, 'conversation-run')).toBe(true)
  await runConversationTurn(id, 0)
  await runConversationTurn(id, 1)
  await completeEncounter(id)
  return id
}

describe('MongoDB agent lifecycle', () => {
  it('ignores unavailable interpreter message evidence without failing the turn', async () => {
    vi.mocked(agents.interpretMessage).mockImplementationOnce(async ({ profile, incomingMessage }) => ({
      literalMeaning: incomingMessage.text, possibleIntent: 'Possibly proposing a quiet meeting.',
      fourLensAnalysis: {
        behavior: { signal: 'May enjoy a quiet setting.' },
        interpersonal: { messageWarmth: 'medium', messageDominance: 'low', signal: 'A tentative invitation.' },
        attachmentRegulation: { possibleActivation: 'low', reason: 'No established attachment score.' },
        values: { relevantPreferences: [], signal: 'Preferences remain uncertain.' },
      },
      possibleUserReaction: { state: 'curious', strength: 'low' }, recommendedApproach: 'ask_question',
      openQuestion: '', uncertainty: 'high', evidenceIds: [profile.evidence[0].id],
      messageEvidence: [{ messageId: 'missing:message', quote: 'not in the incoming message' }],
      temporaryState: { engagement: 'medium', comfort: 'medium', tensionTopics: [], positiveTopics: [], unresolvedQuestions: [], boundariesTriggered: [] },
    }))

    const id = await conversation()
    const reaction = await database.collection('agent_reactions').findOne({ encounterId: id })

    expect(reaction?.interpretation.messageEvidence).toEqual([])
  })

  it('freezes account-context snapshots, makes no runtime builder calls, and persists idempotent turns', async () => {
    const id = await conversation()
    const loaded = await loadEncounter(id)
    expect(loaded.encounter.status).toBe('complete')
    expect(loaded.accountContexts.a.compiledPrompt).toContain('lowercase')
    expect(loaded.accountContexts.a.revision).toBe(1)
    const before = vi.mocked(agents.speakAsPersona).mock.calls.length
    await runConversationTurn(id, 1)
    expect(vi.mocked(agents.speakAsPersona).mock.calls.length).toBe(before)
    expect(await database.collection('agent_messages').countDocuments({ encounterId: id })).toBe(2)
    expect(await database.collection('agent_voice_prompts').countDocuments({ encounterId: id })).toBe(0)
    expect(vi.mocked(agents.speakAsPersona).mock.calls.at(-1)?.[0].accountContext.compiledPrompt).toContain('lowercase')

    // One initial builder run per newly created account; ordinary persona edits do not rebuild.
    expect(vi.mocked(agents.buildAccountContext).mock.calls).toHaveLength(2)
    await storePersona(manualPersonaSchema.parse({ name: 'Alex', bio: 'Enjoys quiet weekends.', traits: ['curious'], interests: ['coffee'], style: 'more direct lowercase' }), 'a', participants.a.userId)
    expect(vi.mocked(agents.buildAccountContext).mock.calls).toHaveLength(2)

    const priorSnapshot = loaded.accountContexts.a
    const rebuilt = await rebuildAgentContext(participants.a.userId, database)
    expect(rebuilt.revision).toBe(priorSnapshot.revision + 1)
    expect(vi.mocked(agents.buildAccountContext).mock.calls).toHaveLength(3)
    // The running encounter keeps the version and text it captured at creation.
    expect((await loadEncounter(id)).accountContexts.a).toEqual(priorSnapshot)
  })

  it('learns positive and negative cues once, exposes shared logs, and freezes adaptation versions per conversation', async () => {
    const first = await conversation()
    const feedback = await Promise.all([recordEncounterFeedback(first, 'positive'), recordEncounterFeedback(first, 'positive')])
    expect(feedback.filter(result => result.recorded)).toHaveLength(1)
    await feedbackAdaptationWorkflow(first)
    expect((await latestAdaptation(participants.a.userId))?.resolvedBias).toBe('more_positive')
    const second = await conversation()
    const frozen = await loadEncounter(second)
    expect(frozen.adaptations.a?.version).toBe(1)
    expect(vi.mocked(agents.interpretMessage).mock.calls.at(-1)?.[0].adaptationGuidance).toContain('quiet coffee invitation')
    await recordEncounterFeedback(second, 'negative')
    await feedbackAdaptationWorkflow(second)
    const latest = await latestAdaptation(participants.a.userId)
    expect(latest?.outcomeTally).toEqual({ positive: 1, negative: 1 })
    expect(latest?.resolvedBias).toBe('more_negative')
    expect(latest?.cues.map(cue => cue.direction)).toEqual(['positive', 'negative'])
    expect((await loadEncounter(second)).adaptations.a?.version).toBe(1)
    await feedbackAdaptationWorkflow(second)
    expect((await latestAdaptation(participants.a.userId))?.version).toBe(2)
    expect(await adaptationForEncounter(participants.a.userId, second)).toBeTruthy()
    expect((await listEncounters(1)).length).toBe(1)
    expect((await listEncounters(1, 1))[0].encounterId).not.toBe((await listEncounters(1))[0].encounterId)
  })

  it('rejects feedback before completion and detects concurrent version writes without losing an outcome', async () => {
    const pending = await createEncounter({ participants, turns: 2 })
    await expect(recordEncounterFeedback(pending, 'negative')).rejects.toThrow('not complete')
    const previous = await latestAdaptation(participants.a.userId)
    const output = { reactionBias: 'more_positive' as const, guidance: 'Tentatively recognize similar invitations while keeping uncertainty about the cause.', cues: [{ cue: 'invitation', direction: 'positive' as const, reason: 'A tentative association.', messageEvidenceIds: ['message:1'] }], confidence: 'low' as const }
    const make = (encounterId: string) => buildStoredAdaptation({ userId: participants.a.userId, encounterId, outcome: 'positive', previous, adaptation: output })
    await saveAdaptation('race:1', make('race:1'))
    await expect(saveAdaptation('race:2', make('race:2'))).rejects.toMatchObject({ code: 11000 })
    const retry = buildStoredAdaptation({ userId: participants.a.userId, encounterId: 'race:2', outcome: 'positive', previous: await latestAdaptation(participants.a.userId), adaptation: output })
    await saveAdaptation('race:2', retry)
    expect((await latestAdaptation(participants.a.userId))?.outcomeTally.positive).toBe(3)
  })
})
