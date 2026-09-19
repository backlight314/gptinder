import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { randomUUID } from 'node:crypto'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { collections, ensureIndexes, getClient } from '../lib/server/db'
import { createEncounter, getEncounter } from '../lib/server/encounters'
import {
  claimEncounter,
  persistTurn,
  finishEncounter,
  failEncounter,
} from '../lib/server/simulation'
import {
  createInterview,
  saveSurvey,
  advanceInterview,
  answerQuestion,
  approveProfile,
} from '../lib/server/onboarding'
import {
  saveFeedback,
  analyzeFeedback,
  confirmPreferenceUpdate,
} from '../lib/server/feedback'
import {
  createImport,
  extractImport,
  approveImport,
  deleteImport,
} from '../lib/server/imports'
import { loadStyleContext } from '../lib/server/style'
import { hashSecret } from '../lib/server/auth'
import { requestEmailSignIn, verifyEmailSignIn } from '../lib/server/email-auth'
import { DEMO_PEOPLE, DEMO_PREFERENCES } from '../lib/demo-fixtures'
import { DEFAULT_STYLE } from '../lib/import-domain'
import { generateStructured } from '../lib/server/ai'
import type { BumpEvent } from '../lib/badge-protocol'

vi.mock('../lib/server/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/server/ai')>()),
  generateStructured: vi.fn(),
}))
const ai = vi.mocked(generateStructured)
const consent = {
  adult: true,
  survey: true,
  aiProcessing: true,
  sharedProfile: true,
  importedInformation: true,
} as const
const event: BumpEvent = {
  type: 'gptinder.encounter',
  version: 1,
  localToken: 'a'.repeat(32),
  peerToken: 'b'.repeat(32),
  localNonce: '1'.repeat(16),
  peerNonce: '2'.repeat(16),
}
const alex = DEMO_PEOPLE[0].id
const blair = DEMO_PEOPLE[1].id
let repl: MongoMemoryReplSet
describe('verified email authentication', () => {
  it('stores only a hash, consumes a code once, and recovers the same account', async () => {
    process.env.RESEND_API_KEY = 'test-only'
    process.env.EMAIL_FROM = 'Demo <demo@example.com>'
    let delivered = ''
    const mockFetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        delivered = JSON.parse(String(init?.body)).text
        return Response.json({ id: 'sent' })
      })
    try {
      const input = {
        email: 'Alex@example.com',
        displayName: 'Verified Alex',
        adult: true as const,
      }
      expect(await requestEmailSignIn(input)).toEqual({ sent: true })
      const token = delivered.match(/[a-f0-9]{64}/)![0]
      const c = await collections()
      const stored = await c.loginTokens.findOne({ email: 'alex@example.com' })
      expect(stored?._id).toBe(hashSecret(token))
      expect(JSON.stringify(stored)).not.toContain(token)
      const results = await Promise.allSettled([
        verifyEmailSignIn(token),
        verifyEmailSignIn(token),
      ])
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1)
      const first = results.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<string>
      await requestEmailSignIn(input)
      expect(await verifyEmailSignIn(delivered.match(/[a-f0-9]{64}/)![0])).toBe(
        first.value,
      )
      expect(await c.users.countDocuments({ email: 'alex@example.com' })).toBe(
        1,
      )
      await c.loginTokens.insertOne({
        _id: hashSecret('f'.repeat(64)),
        email: 'alex@example.com',
        displayName: 'Expired',
        expiresAt: new Date(0),
      })
      await expect(verifyEmailSignIn('f'.repeat(64))).rejects.toThrow('expired')
    } finally {
      mockFetch.mockRestore()
      delete process.env.RESEND_API_KEY
      delete process.env.EMAIL_FROM
    }
  })
})
beforeAll(async () => {
  repl = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
  process.env.MONGODB_URI = repl.getUri()
  process.env.MONGODB_DB = `gptinder_tests_${Date.now()}`
  process.env.AUTH_SECRET = 'integration-secret-'.repeat(3)
  process.env.APP_URL = 'http://localhost:3000'
  await ensureIndexes()
})
afterAll(async () => {
  if (repl) {
    await (await getClient()).close()
    await repl.stop()
  }
})
beforeEach(async () => {
  const c = await collections()
  // This database is the newly created ephemeral replica set above, never Atlas.
  for (const collection of Object.values(c)) await collection.deleteMany({})
  ai.mockReset()
  for (const [i, person] of DEMO_PEOPLE.entries()) {
    const profileId = randomUUID()
    const preferenceId = randomUUID()
    const styleId = randomUUID()
    await c.users.insertOne({
      _id: person.id,
      displayName: person.name,
      accessKeyHash: hashSecret(person.id),
      profileVersionId: profileId,
      preferenceVersionId: preferenceId,
      styleVersionId: styleId,
      createdAt: new Date(),
    })
    await c.styles.insertOne({
      _id: styleId,
      userId: person.id,
      version: 1,
      settings: DEFAULT_STYLE,
      sourceIds: [],
      sampleIds: [],
      createdAt: new Date(),
    })
    await c.profiles.insertOne({
      _id: profileId,
      userId: person.id,
      version: 1,
      shareable: person.profile,
      surveyScores: { privateScore: 5 },
      avatarSeed: person.name,
      approvedAt: new Date(),
      styleVersionId: styleId,
      approvedEvidenceIds: [],
      sourceIds: [],
    })
    await c.preferences.insertOne({
      _id: preferenceId,
      userId: person.id,
      version: 1,
      dimensions: structuredClone(DEMO_PREFERENCES),
      createdAt: new Date(),
    })
    await c.consents.insertOne({
      _id: randomUUID(),
      userId: person.id,
      flags: consent,
      createdAt: new Date(),
    })
    await c.badges.insertOne({
      _id: randomUUID(),
      userId: person.id,
      tokenHash: hashSecret(['a', 'b', 'c'][i].repeat(32)),
      status: 'active',
      expiresAt: new Date(Date.now() + 60000),
      createdAt: new Date(),
    })
  }
})
function mockTurns() {
  ai.mockImplementation(async (_schema, task, input) => {
    if (task.startsWith('Explain strengths'))
      return {
        strengths: ['Similar social settings'],
        friction: ['Different planning needs'],
      } as never
    const context = input as { allowedEvidenceIds: string[] }
    return {
      action: 'propose',
      text: 'Could we plan a quiet cafe visit on Saturday?',
      evidenceIds: context.allowedEvidenceIds.slice(0, 1),
    } as never
  })
}
describe('durable encounter and preference invariants', () => {
  it('deduplicates concurrent/reversed bumps and enforces badge ownership', async () => {
    const encounters = await Promise.all(
      Array.from({ length: 4 }, () => createEncounter(alex, event)),
    )
    expect(new Set(encounters.map((e) => e._id)).size).toBe(1)
    const reverse = await createEncounter(blair, {
      ...event,
      localToken: event.peerToken,
      peerToken: event.localToken,
      localNonce: event.peerNonce,
      peerNonce: event.localNonce,
    })
    expect(reverse._id).toBe(encounters[0]._id)
    await expect(createEncounter(blair, event)).rejects.toThrow()
    expect(await (await collections()).encounters.countDocuments()).toBe(1)
  })
  it('claims one run, persists six unique turns, and survives repeated completion', async () => {
    mockTurns()
    const encounter = await createEncounter(alex, event)
    expect(await claimEncounter(encounter._id, 'run-a')).toBe(true)
    expect(await claimEncounter(encounter._id, 'run-b')).toBe(false)
    for (let n = 1; n <= 6; n++) {
      await persistTurn(encounter._id, 'run-a', n)
      await persistTurn(encounter._id, 'run-a', n)
    }
    expect(ai).toHaveBeenCalledTimes(6)
    const input = ai.mock.calls[0][2] as Record<string, unknown>
    expect(JSON.stringify(input)).not.toContain('privateScore')
    expect(input.explicitPartnerPreferences).toEqual(DEMO_PREFERENCES)
    await finishEncounter(encounter._id, 'run-a')
    await finishEncounter(encounter._id, 'run-a')
    const data = await getEncounter(encounter._id, alex)
    expect(data.messages).toHaveLength(6)
    expect(data.result?.directions[alex].score).toBe(76)
    await expect(
      getEncounter(encounter._id, DEMO_PEOPLE[2].id),
    ).rejects.toThrow()
  })
  it('resumes saved turns under a new run after final failure', async () => {
    mockTurns()
    const encounter = await createEncounter(alex, event)
    await claimEncounter(encounter._id, 'run-a')
    await persistTurn(encounter._id, 'run-a', 1)
    await failEncounter(encounter._id, 'run-a')
    await (
      await collections()
    ).encounters.updateOne(
      { _id: encounter._id },
      { $set: { status: 'pending_start' }, $unset: { workflowRunId: '' } },
    )
    expect(await claimEncounter(encounter._id, 'run-b')).toBe(true)
    await persistTurn(encounter._id, 'run-b', 1)
    await persistTurn(encounter._id, 'run-b', 2)
    expect(ai).toHaveBeenCalledTimes(2)
  })
  it('applies one confirmed revision atomically and preserves historical scores', async () => {
    mockTurns()
    const encounter = await createEncounter(alex, event)
    await claimEncounter(encounter._id, 'run-a')
    for (let n = 1; n <= 6; n++) await persistTurn(encounter._id, 'run-a', n)
    await finishEncounter(encounter._id, 'run-a')
    const feedback = await saveFeedback(alex, {
      encounterId: encounter._id,
      revision: 0,
      outcome: 'negative',
      explanation:
        'The last-minute changes stressed me out. I want someone who makes plans ahead of time.',
    })
    ai.mockResolvedValue({
      decision: 'propose',
      explanation: 'Advance planning now matters more to you.',
      clarification: null,
      dimension: 'planning',
      desired: null,
      importance: 2,
      supportingQuote: 'I want someone who makes plans ahead of time.',
    })
    const update = (await analyzeFeedback(alex, feedback!._id))!
    const applied = await Promise.all(
      Array.from({ length: 4 }, () =>
        confirmPreferenceUpdate(alex, update._id),
      ),
    )
    expect(new Set(applied.map((v) => v.preferenceVersionId)).size).toBe(1)
    const c = await collections()
    expect(await c.preferences.countDocuments({ userId: alex })).toBe(2)
    const casey = await createEncounter(alex, {
      ...event,
      peerToken: 'c'.repeat(32),
      localNonce: '3'.repeat(16),
    })
    expect(casey.participants[0].preferenceVersionId).not.toBe(
      encounter.participants[0].preferenceVersionId,
    )
    const next = await getEncounter(casey._id, alex)
    expect(next.comparison?.previous.score).toBe(76)
    expect(next.comparison?.current.score).toBe(67)
    expect(
      (await getEncounter(encounter._id, alex)).result?.directions[alex].score,
    ).toBe(76)
    expect(await c.profiles.countDocuments({ userId: alex })).toBe(1)
  })
  it('vague feedback asks for clarification without model-driven changes', async () => {
    const encounter = await createEncounter(alex, event)
    const c = await collections()
    await c.encounters.updateOne(
      { _id: encounter._id },
      { $set: { status: 'complete' } },
    )
    const feedback = await saveFeedback(alex, {
      encounterId: encounter._id,
      revision: 0,
      outcome: 'negative',
      explanation: 'bad',
    })
    const update = (await analyzeFeedback(alex, feedback!._id))!
    expect(update.status).toBe('clarify')
    expect(ai).not.toHaveBeenCalled()
    await expect(confirmPreferenceUpdate(alex, update._id)).rejects.toThrow()
  })
})
describe('interview and imported-source lifecycle', () => {
  async function prepareInterview() {
    const c = await collections()
    await c.users.updateOne(
      { _id: alex },
      { $unset: { profileVersionId: '', styleVersionId: '' } },
    )
    await createInterview(alex)
    await saveSurvey(alex, {
      revision: 0,
      survey: Array(10).fill(4),
      preferences: DEMO_PREFERENCES,
      consent,
      submit: true,
    })
    return c
  }
  it('restores a saved question, retains answers on generation failure, limits to five, then approves', async () => {
    const c = await prepareInterview()
    const question = {
      domain: 'planning',
      goal: 'clarify partner preference',
      evidenceIds: ['survey'],
      question: 'How do you feel when a date changes plans?',
    }
    ai.mockResolvedValue(question)
    let interview = (await advanceInterview(alex))!
    expect((await advanceInterview(alex))!.currentQuestion).toEqual(question)
    expect(ai).toHaveBeenCalledTimes(1)
    await answerQuestion(
      alex,
      interview.revision,
      'Advance notice matters to me.',
    )
    ai.mockRejectedValueOnce(new Error('temporary generation failure'))
    await expect(advanceInterview(alex)).rejects.toThrow()
    expect(
      (await c.interviews.findOne({ userId: alex }))?.answers,
    ).toHaveLength(1)
    for (let i = 1; i < 5; i++) {
      interview = (await advanceInterview(alex))!
      await answerQuestion(
        alex,
        interview.revision,
        'I like a clear plan and enough personal space.',
      )
    }
    ai.mockResolvedValue({
      ...DEMO_PEOPLE[0].profile,
      unresolved: [],
      evidenceIds: ['survey'],
    })
    interview = (await advanceInterview(alex))!
    expect(interview.stage).toBe('review')
    expect(interview.answers).toHaveLength(5)
    await approveProfile(alex, {
      revision: interview.revision,
      profile: DEMO_PEOPLE[0].profile,
      preferences: DEMO_PREFERENCES,
      communicationStyle: DEFAULT_STYLE,
      avatarSeed: 'alex',
      confirmed: true,
    })
    expect((await c.interviews.findOne({ userId: alex }))?.stage).toBe(
      'approved',
    )
    await expect(
      answerQuestion(alex, interview.revision, 'A sixth answer'),
    ).rejects.toThrow()
  })
  it('validates quoted evidence and keeps professional facts out of style and scoring', async () => {
    const c = await prepareInterview()
    const sample = {
      id: randomUUID(),
      text: 'I build robotics projects and enjoy mentoring.',
      author: 'self' as const,
      role: 'training' as const,
    }
    const source = await createImport(alex, {
      label: 'My professional background',
      sourceType: 'professional',
      samples: [sample],
      reviewed: true,
      ownMessagesOnly: true,
    })
    expect(
      (await c.imports.findOne({ _id: source._id })) as unknown,
    ).not.toHaveProperty('samples')
    expect(await c.samples.countDocuments({ sourceId: source._id })).toBe(1)
    const candidate = {
      category: 'fact',
      text: 'Builds robotics projects',
      sampleIds: [sample.id],
      supportingQuote: 'A quote that is not in the sample',
      context: 'User-supplied professional text',
      allowedUse: 'conversation_topic',
    }
    ai.mockResolvedValue({
      style: DEFAULT_STYLE,
      claims: [candidate],
      uncertainty: ['Would you enjoy discussing robotics on a date?'],
    })
    await expect(extractImport(source._id, 'professional-run')).rejects.toThrow(
      'not grounded',
    )
    ai.mockResolvedValue({
      style: { ...DEFAULT_STYLE, tone: 'playful' },
      claims: [{ ...candidate, supportingQuote: 'I build robotics projects' }],
      uncertainty: ['Would you enjoy discussing robotics on a date?'],
    })
    await extractImport(source._id, 'professional-run')
    const review = (await c.imports.findOne({ _id: source._id }))!
    await expect(
      approveImport(alex, source._id, {
        revision: review.revision,
        claimIndexes: [0],
        style: DEFAULT_STYLE,
        sampleIds: [sample.id],
        confirmed: true,
      }),
    ).rejects.toThrow('Choose only')
    const approved = await approveImport(alex, source._id, {
      revision: review.revision,
      claimIndexes: [0],
      style: { ...DEFAULT_STYLE, tone: 'playful' },
      sampleIds: [],
      confirmed: true,
    })
    const context = await loadStyleContext(alex, approved.styleVersionId)
    expect(context.settings).toEqual(DEFAULT_STYLE)
    expect(context.approvedInterests).toEqual(['Builds robotics projects'])
    expect(context.examples).toEqual([])
    expect(await c.preferences.countDocuments({ userId: alex })).toBe(1)
    ai.mockResolvedValue({
      domain: 'novelty',
      goal: 'clarify dating relevance',
      evidenceIds: ['survey'],
      question: 'Would you enjoy discussing robotics on a date?',
    })
    await advanceInterview(alex)
    expect(JSON.stringify(ai.mock.lastCall?.[2])).toContain(
      'Would you enjoy discussing robotics on a date?',
    )
    await deleteImport(alex, source._id)
    expect(await c.samples.countDocuments({ sourceId: source._id })).toBe(0)
    expect(await c.claims.countDocuments({ sourceId: source._id })).toBe(0)
  })
  it('withholds evaluation samples and cascades source deletion without resurrection', async () => {
    const c = await prepareInterview()
    const samples = [0, 1, 2].map((i) => ({
      id: randomUUID(),
      text:
        i === 2
          ? 'A withheld sentence that must not enter extraction.'
          : `Reviewed own writing sample number ${i}.`,
      author: 'self' as const,
      role: i === 2 ? ('holdout' as const) : ('training' as const),
    }))
    const source = await createImport(alex, {
      label: 'Reviewed excerpts',
      samples,
      reviewed: true,
      ownMessagesOnly: true,
    })
    ai.mockResolvedValue({
      style: DEFAULT_STYLE,
      claims: [
        {
          category: 'communication_style',
          text: 'Prefers concise messages',
          sampleIds: [samples[0].id],
          supportingQuote: samples[0].text,
          context: 'Selected casual writing',
          allowedUse: 'persona_style',
        },
      ],
      uncertainty: [],
    })
    await extractImport(source._id, 'import-run')
    expect(JSON.stringify(ai.mock.calls[0][2])).not.toContain('withheld')
    const review = (await c.imports.findOne({ _id: source._id }))!
    const approved = await approveImport(alex, source._id, {
      revision: review.revision,
      claimIndexes: [0],
      style: DEFAULT_STYLE,
      sampleIds: [samples[0].id],
      confirmed: true,
    })
    const context = await loadStyleContext(alex, approved.styleVersionId)
    expect(context.examples).toHaveLength(1)
    expect(context.holdout).toHaveLength(1)
    await deleteImport(alex, source._id)
    expect(await c.samples.countDocuments({ sourceId: source._id })).toBe(0)
    expect(await c.claims.countDocuments({ sourceId: source._id })).toBe(0)
    expect(await c.retrieval.countDocuments({ sourceId: source._id })).toBe(0)
    await expect(
      loadStyleContext(alex, approved.styleVersionId),
    ).rejects.toThrow()
    ai.mockClear()
    await extractImport(source._id, 'late-run')
    expect(ai).not.toHaveBeenCalled()
  })
  it('deletion invalidates frozen profiles and removes dependent conversation records', async () => {
    const c = await prepareInterview()
    const samples = [0, 1, 2].map((i) => ({
      id: randomUUID(),
      text: `Private sample number ${i} for local verification.`,
      author: 'self' as const,
      role: i === 2 ? ('holdout' as const) : ('training' as const),
    }))
    const source = await createImport(alex, {
      label: 'Delete me',
      samples,
      reviewed: true,
      ownMessagesOnly: true,
    })
    ai.mockResolvedValue({ style: DEFAULT_STYLE, claims: [], uncertainty: [] })
    await extractImport(source._id, 'extract')
    const review = (await c.imports.findOne({ _id: source._id }))!
    const style = await approveImport(alex, source._id, {
      revision: review.revision,
      claimIndexes: [],
      style: DEFAULT_STYLE,
      sampleIds: [samples[0].id],
      confirmed: true,
    })
    const profile = (await c.profiles.findOne({ userId: alex }))!
    await c.profiles.updateOne(
      { _id: profile._id },
      {
        $set: { sourceIds: [source._id], styleVersionId: style.styleVersionId },
      },
    )
    await c.users.updateOne(
      { _id: alex },
      { $set: { profileVersionId: profile._id } },
    )
    const encounter = await createEncounter(alex, event)
    await claimEncounter(encounter._id, 'run')
    await c.messages.insertOne({
      _id: 'private-test-turn',
      encounterId: encounter._id,
      turnNumber: 1,
      speaker: alex,
      action: 'propose',
      text: 'A generated message',
      evidenceIds: [profile._id],
      createdAt: new Date(),
    })
    await deleteImport(alex, source._id)
    expect(
      await c.messages.countDocuments({ encounterId: encounter._id }),
    ).toBe(0)
    expect(
      (await c.users.findOne({ _id: alex }))?.profileVersionId,
    ).toBeUndefined()
    expect(
      (await c.profiles.findOne({ _id: profile._id }))?.invalidatedAt,
    ).toBeInstanceOf(Date)
    await expect(getEncounter(encounter._id, alex)).rejects.toThrow(
      'deleted an imported source',
    )
    await expect(persistTurn(encounter._id, 'run', 2)).rejects.toThrow()
  })
  it('rejects stale preference proposals after another confirmed change', async () => {
    const c = await collections()
    const user = (await c.users.findOne({ _id: alex }))!
    const encounter = await createEncounter(alex, event)
    await c.encounters.updateOne(
      { _id: encounter._id },
      { $set: { status: 'complete' } },
    )
    const feedback = (await saveFeedback(alex, {
      encounterId: encounter._id,
      revision: 0,
      outcome: 'negative',
      explanation: 'I want someone who makes plans ahead of time.',
    }))!
    ai.mockResolvedValue({
      decision: 'propose',
      explanation: 'Planning matters.',
      clarification: null,
      dimension: 'planning',
      desired: null,
      importance: 2,
      supportingQuote: feedback.explanation,
    })
    const update = (await analyzeFeedback(alex, feedback._id))!
    await c.users.updateOne(
      { _id: alex },
      { $set: { preferenceVersionId: randomUUID() } },
    )
    await expect(confirmPreferenceUpdate(alex, update._id)).rejects.toThrow(
      'changed',
    )
    expect(await c.preferences.countDocuments({ userId: alex })).toBe(1)
    expect(
      (await c.preferences.findOne({ _id: user.preferenceVersionId }))
        ?.dimensions.planning.importance,
    ).toBe(1)
  })
})
