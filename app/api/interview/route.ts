import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import {
  saveSurvey,
  surveyInput,
  answerQuestion,
  advanceInterview,
} from '@/lib/server/onboarding'
export const runtime = 'nodejs'
export const maxDuration = 60
export const PUT = route(
  async (request) =>
    saveSurvey((await currentUser())._id, await readJson(request, surveyInput)),
  true,
)
export const PATCH = route(async (request) => {
  const user = await currentUser()
  const data = await readJson(
    request,
    z.object({
      revision: z.number().int(),
      answer: z.string().trim().min(1).max(2000),
    }),
  )
  return answerQuestion(user._id, data.revision, data.answer)
}, true)
export const POST = route(async () => {
  const user = await currentUser()
  await rateLimit(`interview:${user._id}`, 8)
  return advanceInterview(user._id)
}, true)
