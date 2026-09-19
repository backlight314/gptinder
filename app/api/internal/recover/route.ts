import { timingSafeEqual } from 'node:crypto'
import { collections } from '@/lib/server/db'
import { dispatchEncounter, reconcileRun } from '@/lib/server/dispatch'
import { dispatchImport, retryImport } from '@/lib/server/import-dispatch'
import { deleteImport } from '@/lib/server/imports'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request) {
  const expected = process.env.CRON_SECRET
  const actual = request.headers.get('authorization') ?? ''
  if (
    !expected ||
    expected.length < 32 ||
    actual.length !== `Bearer ${expected}`.length ||
    !timingSafeEqual(Buffer.from(actual), Buffer.from(`Bearer ${expected}`))
  )
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const c = await collections()
  const pending = await c.encounters
    .find({ status: 'pending_start' })
    .sort({ createdAt: 1 })
    .limit(5)
    .toArray()
  const running = await c.encounters
    .find({ status: 'running' })
    .sort({ createdAt: 1 })
    .limit(5)
    .toArray()
  let failedChecks = 0
  for (const encounter of [...pending, ...running]) {
    try {
      if (encounter.status === 'pending_start')
        await dispatchEncounter(encounter._id)
      else await reconcileRun(encounter._id)
    } catch {
      failedChecks++
    }
  }
  const imports = await c.imports
    .find({ status: { $in: ['pending_start', 'extracting'] } })
    .limit(5)
    .toArray()
  for (const source of imports) {
    try {
      if (source.status === 'pending_start') await dispatchImport(source._id)
      else await retryImport(source._id, source.userId)
    } catch {
      failedChecks++
    }
  }
  // Seven-day demo retention, cascading through the same deletion service as the UI.
  const expired = await c.imports
    .find({
      status: { $ne: 'deleted' },
      createdAt: { $lt: new Date(Date.now() - 7 * 86400000) },
    })
    .limit(5)
    .toArray()
  for (const source of expired) {
    try {
      await deleteImport(source.userId, source._id)
    } catch {
      failedChecks++
    }
  }
  return Response.json({
    checked: pending.length + running.length + imports.length,
    expiredSourcesProcessed: expired.length,
    failedChecks,
  })
}
// Vercel Cron invokes GET and authenticates using the same CRON_SECRET bearer token.
export const GET = POST
