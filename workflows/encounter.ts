import { getWorkflowMetadata } from 'workflow'

export async function encounterWorkflow(encounterId: string) {
  'use workflow'
  const runId = getWorkflowMetadata().workflowRunId
  if (!(await claim(encounterId, runId))) return
  try {
    for (let turn = 1; turn <= 6; turn++)
      await converse(encounterId, runId, turn)
    await complete(encounterId, runId)
  } catch {
    await failed(encounterId, runId)
  }
}
async function claim(id: string, run: string) {
  'use step'
  const { claimEncounter } = await import('../lib/server/simulation')
  return claimEncounter(id, run)
}
async function converse(id: string, run: string, turn: number) {
  'use step'
  const { persistTurn } = await import('../lib/server/simulation')
  await persistTurn(id, run, turn)
}
async function complete(id: string, run: string) {
  'use step'
  const { finishEncounter } = await import('../lib/server/simulation')
  await finishEncounter(id, run)
}
async function failed(id: string, run: string) {
  'use step'
  const { failEncounter } = await import('../lib/server/simulation')
  await failEncounter(id, run)
}
