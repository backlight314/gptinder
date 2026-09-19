import { route, readJson } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import {
  generatePreview,
  reviewPreview,
  previewInput,
} from '@/lib/server/preview'
import { collections } from '@/lib/server/db'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`preview:${user._id}`, 8)
  const input = await readJson(request, previewInput)
  return input.action === 'generate'
    ? generatePreview(user._id, input.scenario)
    : reviewPreview(user._id, input)
}, true)
export const GET = route(async () =>
  (await collections()).previews
    .find({
      userId: (await currentUser())._id,
      invalidatedAt: { $exists: false },
    })
    .sort({ createdAt: -1 })
    .limit(12)
    .toArray(),
)
