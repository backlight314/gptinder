import 'server-only'
import { start, getRun } from 'workflow/api'
import { encounterWorkflow } from '../../workflows/encounter'
import { collections } from './db'

/** Persisted outbox lease closes the save/start gap; the workflow owns the final claim. */
export async function dispatchEncounter(encounterId: string) {
  const c = await collections()
  const leased = await c.encounters.findOneAndUpdate(
    {
      _id: encounterId,
      status: 'pending_start',
      $or: [
        { dispatchLeaseUntil: { $exists: false } },
        { dispatchLeaseUntil: { $lt: new Date() } },
      ],
    },
    { $set: { dispatchLeaseUntil: new Date(Date.now() + 60000) } },
    { returnDocument: 'after' },
  )
  if (!leased) return
  try {
    await start(encounterWorkflow, [encounterId])
  } catch {
    // A start may have been accepted before a transport error. Retain the lease;
    // the next start is safe because claimEncounter permits one owning run.
    await c.encounters.updateOne(
      { _id: encounterId, status: 'pending_start' },
      {
        $set: {
          error: 'Queued. Start will be retried; your encounter is saved.',
        },
      },
    )
  }
}
export async function reconcileRun(encounterId: string) {
  const c = await collections()
  const encounter = await c.encounters.findOne({ _id: encounterId })
  if (encounter?.status === 'running' && encounter.workflowRunId) {
    const status = await getRun(encounter.workflowRunId).status
    if (status === 'failed' || status === 'cancelled')
      await c.encounters.updateOne(
        {
          _id: encounterId,
          status: 'running',
          workflowRunId: encounter.workflowRunId,
        },
        {
          $set: {
            status: 'failed',
            error: 'Workflow stopped. Retry to resume the saved conversation.',
          },
        },
      )
  }
}
