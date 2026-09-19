import { route, readJson } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import { bumpSchema } from '@/lib/badge-protocol'
import { createEncounter } from '@/lib/server/encounters'
import { dispatchEncounter } from '@/lib/server/dispatch'
import { collections } from '@/lib/server/db'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`encounter:${user._id}`, 20)
  const encounter = await createEncounter(
    user._id,
    await readJson(request, bumpSchema),
  )
  await dispatchEncounter(encounter._id)
  return { encounterId: encounter._id }
}, true)
export const GET = route(async () => {
  const user = await currentUser()
  return (await collections()).encounters
    .find(
      { 'participants.userId': user._id },
      { projection: { _id: 1, participants: 1, status: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(30)
    .toArray()
})
