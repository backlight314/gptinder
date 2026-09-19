import { z } from 'zod'
import { readJson, route } from '@/lib/server/http'
import { rateLimit, setSession } from '@/lib/server/auth'
import {
  requestEmailSignIn,
  verifyEmailSignIn,
  emailRequestSchema,
} from '@/lib/server/email-auth'
import { createInterview } from '@/lib/server/onboarding'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route(async (request) => {
  await rateLimit(
    `email-ip:${request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local'}`,
    8,
    900,
  )
  return requestEmailSignIn(await readJson(request, emailRequestSchema))
}, true)
export const PATCH = route(async (request) => {
  await rateLimit(
    `email-verify:${request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local'}`,
    12,
  )
  const { token } = await readJson(
    request,
    z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }),
  )
  const userId = await verifyEmailSignIn(token)
  await createInterview(userId)
  await setSession(userId)
  return { ok: true }
}, true)
