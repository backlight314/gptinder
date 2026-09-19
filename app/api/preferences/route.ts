import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { currentUser } from '@/lib/server/auth'
import {
  confirmPreferenceUpdate,
  revertPreferences,
} from '@/lib/server/feedback'
import { collections } from '@/lib/server/db'
export const runtime = 'nodejs'
export const POST = route(async (request) => {
  const user = await currentUser()
  const { updateId } = await readJson(
    request,
    z.object({ updateId: z.string().uuid(), confirmed: z.literal(true) }),
  )
  return confirmPreferenceUpdate(user._id, updateId)
}, true)
export const GET = route(async () =>
  (await collections()).preferences
    .find({ userId: (await currentUser())._id })
    .sort({ version: -1 })
    .limit(30)
    .toArray(),
)
export const PATCH = route(async (request) => {
  const user = await currentUser()
  const data = await readJson(
    request,
    z.object({
      targetId: z.string().uuid(),
      expectedId: z.string().uuid(),
      confirmed: z.literal(true),
    }),
  )
  return revertPreferences(user._id, data.targetId, data.expectedId)
}, true)
