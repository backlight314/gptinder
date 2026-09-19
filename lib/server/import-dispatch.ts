import 'server-only'
import { start, getRun } from 'workflow/api'
import { importWorkflow } from '../../workflows/import'
import { collections } from './db'
import { requireValue } from './errors'

export async function dispatchImport(id: string) {
  const c = await collections()
  const source = await c.imports.findOneAndUpdate(
    {
      _id: id,
      status: 'pending_start',
      $or: [
        { dispatchLeaseUntil: { $exists: false } },
        { dispatchLeaseUntil: { $lt: new Date() } },
      ],
    },
    { $set: { dispatchLeaseUntil: new Date(Date.now() + 60000) } },
    { returnDocument: 'after' },
  )
  if (source) {
    try {
      await start(importWorkflow, [id])
    } catch {
      /* Saved outbox is retried by the review screen or recovery endpoint. */
    }
  }
}
export async function retryImport(id: string, userId: string) {
  const c = await collections()
  const source = requireValue(await c.imports.findOne({ _id: id, userId }))
  if (source.status === 'extracting' && source.workflowRunId) {
    const status = await getRun(source.workflowRunId).status
    if (status === 'failed' || status === 'cancelled')
      await c.imports.updateOne(
        { _id: id, status: 'extracting' },
        { $set: { status: 'failed' } },
      )
  }
  await c.imports.updateOne(
    { _id: id, status: 'failed' },
    {
      $set: { status: 'pending_start' },
      $unset: { workflowRunId: '', dispatchLeaseUntil: '', error: '' },
    },
  )
  await dispatchImport(id)
}
