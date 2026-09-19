import 'server-only'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { authEnv } from './env'
import { collections } from './db'
import { AppError } from './errors'

const COOKIE = 'gptinder_session'
export const newSecret = () => randomBytes(32).toString('hex')
export const hashSecret = (value: string) =>
  createHmac('sha256', authEnv().AUTH_SECRET).update(value).digest('hex')
export function signSession(userId: string, now = Date.now()) {
  const data = Buffer.from(
    JSON.stringify({ userId, expires: now + 7 * 86400000 }),
  ).toString('base64url')
  return `${data}.${hashSecret(data)}`
}
export function verifySession(value: string, now = Date.now()): string | null {
  const [data, signature, extra] = value.split('.')
  if (!data || !signature || extra || !/^[a-f0-9]{64}$/.test(signature))
    return null
  const expected = Buffer.from(hashSecret(data), 'hex')
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null
  try {
    const parsed = JSON.parse(Buffer.from(data, 'base64url').toString())
    return typeof parsed.userId === 'string' &&
      Number.isFinite(parsed.expires) &&
      parsed.expires > now
      ? parsed.userId
      : null
  } catch {
    return null
  }
}
export async function setSession(userId: string) {
  ;(await cookies()).set(COOKIE, signSession(userId), {
    httpOnly: true,
    secure: new URL(authEnv().APP_URL).protocol === 'https:',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 86400,
  })
}
export async function clearSession() {
  ;(await cookies()).delete(COOKIE)
}
export async function currentUser() {
  const token = (await cookies()).get(COOKIE)?.value
  const id = token ? verifySession(token) : null
  if (!id) throw new AppError(401, 'Please sign in to continue.')
  const user = await (await collections()).users.findOne({ _id: id })
  if (!user) throw new AppError(401, 'Your session is no longer valid.')
  return user
}
export function checkOrigin(request: Request) {
  const expected = new URL(authEnv().APP_URL).origin
  if (request.headers.get('origin') !== expected)
    throw new AppError(403, 'Request origin does not match this application.')
}
export async function rateLimit(key: string, limit: number, seconds = 60) {
  const bucket = Math.floor(Date.now() / (seconds * 1000))
  const c = await collections()
  const record = await c.limits.findOneAndUpdate(
    { _id: hashSecret(`${key}:${bucket}`) },
    {
      $inc: { count: 1 },
      $setOnInsert: { expiresAt: new Date((bucket + 2) * seconds * 1000) },
    },
    { upsert: true, returnDocument: 'after' },
  )
  if (record && record.count > limit)
    throw new AppError(
      429,
      'Too many requests. Please wait a minute and try again.',
    )
}
