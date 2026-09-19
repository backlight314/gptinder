import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { collections } from '@/lib/server/db'
import {
  newSecret,
  hashSecret,
  setSession,
  clearSession,
  rateLimit,
} from '@/lib/server/auth'
import { AppError } from '@/lib/server/errors'
import { createInterview } from '@/lib/server/onboarding'
export const runtime = 'nodejs'
const input = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('register'),
    displayName: z.string().trim().min(1).max(60),
    adult: z.literal(true),
  }),
  z.object({
    action: z.literal('login'),
    accessKey: z.string().regex(/^[a-f0-9]{64}$/),
  }),
])
export const POST = route(async (request) => {
  await rateLimit(
    `auth:${request.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local'}`,
    12,
  )
  const data = await readJson(request, input)
  const c = await collections()
  if (data.action === 'login') {
    const user = await c.users.findOne({
      accessKeyHash: hashSecret(data.accessKey),
    })
    if (!user) throw new AppError(401, 'Invalid sign-in key.')
    await createInterview(user._id)
    await setSession(user._id)
    return { ok: true }
  }
  if (process.env.ALLOW_DEMO_AUTH !== 'true')
    throw new AppError(403, 'Use verified email sign-in to create an account.')
  const accessKey = newSecret()
  const id = randomUUID()
  await c.users.insertOne({
    _id: id,
    displayName: data.displayName,
    accessKeyHash: hashSecret(accessKey),
    createdAt: new Date(),
  })
  await createInterview(id)
  await setSession(id)
  return { accessKey }
}, true)
export const DELETE = route(async () => {
  await clearSession()
  return { ok: true }
}, true)
