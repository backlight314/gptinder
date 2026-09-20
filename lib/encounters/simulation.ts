import 'server-only'

import { agentModel } from '@/lib/agents/models'
import { calculateCompatibility, calculateConversationCompatibility } from '@/lib/psychology/compatibility'
import { validateProfileEvidence } from '@/lib/psychology/profile'
import type { PersonKey, SocialInterpretation } from '@/lib/psychology/schemas'
import { assessConversation, interpretMessage, speakAsPersona } from '@/lib/agents/openai'
import { interpreterGuidanceText } from '@/lib/learning/adaptation'
import { claimEncounter, loadEncounter, saveMessage, saveReaction } from './store'

export { claimEncounter }
type StringIdDocument = { _id: string; [key: string]: any }

function keyForSequence(sequence: number): PersonKey {
  return sequence % 2 === 0 ? 'a' : 'b'
}

function validateMessageEvidence(interpretation: SocialInterpretation, message: { _id: unknown; text?: unknown }) {
  for (const item of interpretation.messageEvidence) {
    if (item.messageId !== String(message._id) || typeof message.text !== 'string' || !message.text.includes(item.quote))
      throw new Error('Interpreter cited message evidence that does not exist')
  }
}

async function runAgentCall<T>(
  database: Awaited<ReturnType<typeof loadEncounter>>['database'],
  encounterId: string,
  operation: () => Promise<T>,
) {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error && error.message.startsWith('OpenAI ')
      ? error.message
      : 'The conversation agent failed unexpectedly.'
    await database.collection<StringIdDocument>('conversation_encounters').updateOne(
      { _id: encounterId },
      { $set: { lastError: message, updatedAt: new Date() } },
    )
    throw error
  }
}

export async function runConversationTurn(encounterId: string, sequence: number) {
  const { database, encounter, profiles, accountContexts, adaptations } = await loadEncounter(encounterId)
  const existing = await database.collection<StringIdDocument>('agent_messages').findOne({ encounterId, sequence })
  if (existing) return
  const historyDocuments = await database.collection<StringIdDocument>('agent_messages').find({ encounterId, sequence: { $lt: sequence } }).sort({ sequence: 1 }).toArray()
  if (historyDocuments.length !== sequence) throw new Error('Earlier messages are missing')
  const speakerKey = keyForSequence(sequence)
  const profile = profiles[speakerKey]
  const accountContext = accountContexts[speakerKey]
  const adaptation = adaptations[speakerKey]
  const history = historyDocuments.map(item => ({ id: String(item._id), from: item.speakerKey as string, text: item.text as string }))
  const incoming = historyDocuments.at(-1)
  let interpretation: SocialInterpretation | null = null
  let reactionId: string | null = null

  if (incoming) {
    const storedReaction = await database.collection<StringIdDocument>('agent_reactions').findOne({
      encounterId, inputMessageId: String(incoming._id), ownerUserId: profile.userId, promptVersion: 'social-interpreter-v2',
    })
    if (storedReaction) interpretation = storedReaction.interpretation as SocialInterpretation
    else {
      interpretation = await runAgentCall(database, encounterId, () => interpretMessage({
        profile, accountContext, model: agentModel(speakerKey, 'reaction'),
        incomingMessage: { id: String(incoming._id), text: incoming.text as string, from: incoming.speakerKey as string },
        history, scenario: encounter.scenario, temporaryState: encounter.temporaryState?.[speakerKey] ?? null,
        adaptationGuidance: interpreterGuidanceText(adaptation),
      }))
      validateProfileEvidence(profile, interpretation.evidenceIds)
      validateMessageEvidence(interpretation, incoming)
      reactionId = await saveReaction({
        encounterId, ownerUserId: profile.userId, inputMessageId: String(incoming._id),
        profileVersionId: profile.profileVersionId,
        adaptationVersionId: adaptation?.adaptationVersionId ?? null, interpretation, model: agentModel(speakerKey, 'reaction'),
      })
      await database.collection<StringIdDocument>('conversation_encounters').updateOne(
        { _id: encounterId, status: 'running' },
        { $set: { [`temporaryState.${speakerKey}`]: interpretation.temporaryState, updatedAt: new Date() } },
      )
    }
    reactionId ??= String(storedReaction?._id)
  }

  const output = await runAgentCall(database, encounterId, () => speakAsPersona({
    profile, accountContext, model: agentModel(speakerKey, 'speaker'),
    retrievedContext: encounter.retrievedContext?.[speakerKey] ?? '',
    incomingMessage: incoming ? { id: String(incoming._id), text: incoming.text as string, from: incoming.speakerKey as string } : null,
    interpretation, history, scenario: encounter.scenario,
  }))
  validateProfileEvidence(profile, output.usedProfileEvidence)
  const allowedSignals = new Set(interpretation ? [
    interpretation.recommendedApproach,
    interpretation.possibleUserReaction.state,
    ...interpretation.fourLensAnalysis.values.relevantPreferences,
  ] : [])
  if (output.usedInterpretationSignals.some(signal => !allowedSignals.has(signal)))
    throw new Error('Speaker referenced an interpretation signal that does not exist')
  await saveMessage({
    encounterId, sequence, speakerUserId: profile.userId, speakerKey, reactionId,
    voicePromptId: '',
    agentContextRevision: accountContext.revision,
    action: output.action, text: output.text, profileEvidenceIds: output.usedProfileEvidence,
    reactionEvidenceIds: output.usedInterpretationSignals, lensUsage: output.lensUsage, model: agentModel(speakerKey, 'speaker'),
  })
}

export async function completeEncounter(encounterId: string) {
  const { database, encounter, profiles, accountContexts } = await loadEncounter(encounterId)
  const messageCount = await database.collection<StringIdDocument>('agent_messages').countDocuments({ encounterId })
  if (messageCount !== encounter.turns) throw new Error('Conversation is incomplete')
  const messageDocuments = await database.collection<StringIdDocument>('agent_messages').find({ encounterId }).sort({ sequence: 1 }).toArray()
  const history = messageDocuments.map(item => ({ id: String(item._id), from: String(item.speakerKey), text: String(item.text) }))
  let conversationAnalysis: ReturnType<typeof calculateConversationCompatibility> | null = null
  try {
    const [aVerdict, bVerdict] = await Promise.all((['a', 'b'] as const).map(key => assessConversation({
      profile: profiles[key], accountContext: accountContexts[key], model: agentModel(key, 'compatibility'), history, scenario: encounter.scenario,
    })))
    conversationAnalysis = calculateConversationCompatibility(aVerdict, bVerdict)
  } catch (error) {
    console.error('Compatibility analysis failed', error)
  }
  const profileCompatibility = calculateCompatibility(profiles.a, profiles.b)
  const compatibility = {
    ...profileCompatibility,
    label: conversationAnalysis?.label ?? 'Conversation analysis score' as const,
    score: conversationAnalysis?.score ?? null,
    coverage: conversationAnalysis ? 5 : 0,
    features: conversationAnalysis?.features ?? [],
    scenario: encounter.scenario,
    meetingIntent: conversationAnalysis?.meetingIntent ?? null,
    verdicts: conversationAnalysis?.verdicts ?? null,
  }
  await database.collection<StringIdDocument>('conversation_encounters').updateOne(
    { _id: encounterId, status: 'running' },
    { $set: { status: 'complete', compatibility, completedAt: new Date(), updatedAt: new Date() } },
  )
}

export async function failEncounter(encounterId: string, workflowRunId: string, errorMessage: string) {
  const { database, encounter } = await loadEncounter(encounterId)
  const storedError = typeof encounter.lastError === 'string' ? encounter.lastError : errorMessage
  await database.collection<StringIdDocument>('conversation_encounters').updateOne(
    { _id: encounterId, workflowRunId, status: 'running' },
    { $set: { status: 'failed', error: storedError, updatedAt: new Date() } },
  )
}
