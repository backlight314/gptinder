import { getWorkflowMetadata } from 'workflow'

export async function importWorkflow(sourceId: string) {
  'use workflow'
  const runId = getWorkflowMetadata().workflowRunId
  try {
    await extract(sourceId, runId)
  } catch {
    await failed(sourceId, runId)
  }
}
async function extract(sourceId: string, runId: string) {
  'use step'
  const { extractImport } = await import('../lib/server/imports')
  await extractImport(sourceId, runId)
  // No raw samples, candidate text or model output is returned to orchestration.
}
async function failed(sourceId: string, runId: string) {
  'use step'
  const { collections } = await import('../lib/server/db')
  await (
    await collections()
  ).imports.updateOne(
    { _id: sourceId, workflowRunId: runId, status: 'extracting' },
    {
      $set: {
        status: 'failed',
        error: 'Extraction could not finish. Retry this saved import.',
      },
    },
  )
}
