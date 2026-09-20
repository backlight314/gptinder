import { getWorkflowMetadata } from 'workflow'
import type { PersonKey } from '@/lib/psychology/schemas'

function publicFailureMessage(error: unknown) {
  if (error instanceof Error && error.message.startsWith('OpenAI ')) return error.message
  return 'The feedback could not be applied.'
}

// Durable steps retry independently, so every write here is keyed and safe to repeat.
// https://useworkflow.dev/docs/foundations/idempotency
export async function feedbackAdaptationWorkflow(encounterId: string) {
  'use workflow'
  const runId = getWorkflowMetadata().workflowRunId
  try {
    if (!(await claimFeedbackRun(encounterId, runId))) return
    for (const key of ['a', 'b'] as const) await adaptParticipant(encounterId, key)
    await settleFeedbackRun(encounterId, 'applied')
  } catch (error) {
    console.error('Feedback adaptation failed', error)
    await settleFeedbackRun(encounterId, 'failed', publicFailureMessage(error))
    throw error
  }
}

// Step IDs are generated from the step function name, so every step name stays unique across workflow files.
// https://useworkflow.dev/docs/how-it-works/code-transform
async function claimFeedbackRun(encounterId: string, runId: string) {
  'use step'
  const { claimFeedback } = await import('../lib/learning/store')
  return claimFeedback(encounterId, runId)
}

async function adaptParticipant(encounterId: string, key: PersonKey) {
  'use step'
  const { buildReactionAdaptation } = await import('../lib/agents/openai')
  const { buildStoredAdaptation, validateMessageEvidence } = await import('../lib/learning/adaptation')
  const { latestAdaptation, loadFeedbackContext, saveAdaptation, adaptationForEncounter } = await import('../lib/learning/store')
  const { agentModel } = await import('../lib/agents/models')

  const context = await loadFeedbackContext(encounterId)
  const participant = context.participants.find(item => item.key === key)
  if (!participant) throw new Error(`Participant ${key} is missing from the encounter`)
  const previous = await latestAdaptation(participant.userId)
  if (await adaptationForEncounter(participant.userId, encounterId)) return

  const messages = context.messages.map(message => ({
    id: String(message._id), from: message.speakerKey as string, text: message.text as string,
  }))
  const adaptation = await buildReactionAdaptation({
    profile: context.profiles[key],
    accountContext: context.accountContexts[key],
    model: agentModel(key, 'reaction'),
    outcome: context.outcome,
    messages: messages.filter(message => message.from !== key),
    ownInterpretations: context.reactions
      .filter(reaction => reaction.ownerUserId === participant.userId)
      .map(reaction => reaction.interpretation),
    previousAdaptation: previous,
  })
  validateMessageEvidence(messages.filter(message => message.from !== key).map(message => message.id), adaptation)
  await saveAdaptation(encounterId, buildStoredAdaptation({
    userId: participant.userId, encounterId, outcome: context.outcome, adaptation, previous,
  }), agentModel(key, 'reaction'))
}

async function settleFeedbackRun(encounterId: string, status: 'applied' | 'failed', error?: string) {
  'use step'
  const { settleFeedback } = await import('../lib/learning/store')
  await settleFeedback(encounterId, status, error)
}
