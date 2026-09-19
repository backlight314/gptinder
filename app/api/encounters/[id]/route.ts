import { route } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import { getEncounter, requireEncounter } from '@/lib/server/encounters'
import { dispatchEncounter, reconcileRun } from '@/lib/server/dispatch'
import { collections } from '@/lib/server/db'
export const runtime = 'nodejs'
export const maxDuration = 60
const idFrom = (request: Request) =>
  new URL(request.url).pathname.split('/').pop() ?? ''
export const GET = route(async (request) =>
  getEncounter(idFrom(request), (await currentUser())._id),
)
export const POST = route(async (request) => {
  const user = await currentUser()
  const id = idFrom(request)
  await rateLimit(`resume:${user._id}`, 12)
  await requireEncounter(id, user._id)
  await reconcileRun(id)
  await (
    await collections()
  ).encounters.updateOne(
    { _id: id, status: 'failed' },
    {
      $set: { status: 'pending_start' },
      $unset: { workflowRunId: '', dispatchLeaseUntil: '', error: '' },
    },
  )
  await dispatchEncounter(id)
  return getEncounter(id, user._id)
}, true)
