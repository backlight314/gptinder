import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import {
  saveFeedback,
  feedbackInput,
  analyzeFeedback,
} from '@/lib/server/feedback'
import { collections } from '@/lib/server/db'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route(
  async (request) =>
    saveFeedback(
      (await currentUser())._id,
      await readJson(request, feedbackInput),
    ),
  true,
)
export const PATCH = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`feedback:${user._id}`, 6)
  const { feedbackId } = await readJson(
    request,
    z.object({ feedbackId: z.string().max(150) }),
  )
  return analyzeFeedback(user._id, feedbackId)
}, true)
export const GET = route(async (request) => {
  const user = await currentUser()
  const encounterId = new URL(request.url).searchParams.get('encounterId') ?? ''
  const c = await collections()
  const feedback = await c.feedback.findOne({ encounterId, authorId: user._id })
  return {
    feedback,
    update: feedback
      ? await c.updates.findOne({
          feedbackId: feedback._id,
          feedbackRevision: feedback.revision,
          userId: user._id,
        })
      : null,
  }
})
