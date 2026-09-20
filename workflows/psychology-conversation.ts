import { getWorkflowMetadata } from 'workflow'

function findPublicMessage(value: unknown, depth = 0): string | null {
  if (depth > 5) return null
  if (typeof value === 'string') return value.startsWith('OpenAI ') ? value : null
  if (!value || typeof value !== 'object') return null
  for (const item of Object.values(value)) {
    const message = findPublicMessage(item, depth + 1)
    if (message) return message
  }
  return null
}

function publicFailureMessage(error: unknown) {
  return findPublicMessage(error) ?? 'The conversation failed unexpectedly.'
}

export async function psychologyConversationWorkflow(encounterId: string) {
  'use workflow'
  const runId = getWorkflowMetadata().workflowRunId
  if (!(await claim(encounterId, runId))) return
  try {
    const turns = await turnCount(encounterId)
    for (let sequence = 0; sequence < turns; sequence += 1) await converse(encounterId, sequence)
    await complete(encounterId)
  } catch (error) {
    await failed(encounterId, runId, publicFailureMessage(error))
    throw error
  }
}

async function claim(encounterId: string, runId: string) {
  'use step'
  const service = await import('../lib/encounters/simulation')
  return service.claimEncounter(encounterId, runId)
}

async function turnCount(encounterId: string) {
  'use step'
  const { loadEncounter } = await import('../lib/encounters/store')
  return (await loadEncounter(encounterId)).encounter.turns as number
}

async function converse(encounterId: string, sequence: number) {
  'use step'
  const service = await import('../lib/encounters/simulation')
  await service.runConversationTurn(encounterId, sequence)
}

async function complete(encounterId: string) {
  'use step'
  const service = await import('../lib/encounters/simulation')
  await service.completeEncounter(encounterId)
}

async function failed(encounterId: string, runId: string, errorMessage: string) {
  'use step'
  const service = await import('../lib/encounters/simulation')
  await service.failEncounter(encounterId, runId, errorMessage)
}
