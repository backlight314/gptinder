import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'agent_context_account'
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30

function signingSecret() {
  const secret = process.env.AGENT_CONTEXT_SESSION_SECRET || process.env.MONGODB_URI
  if (!secret) throw new Error('AGENT_CONTEXT_SESSION_SECRET is not configured')
  return secret
}

function signature(payload: string) {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

export function agentContextAccessCookie(userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS
  const payload = `${Buffer.from(userId).toString('base64url')}.${expiresAt}`
  const value = `${payload}.${signature(payload)}`
  return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

export async function currentAgentContextUserId(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE_NAME)?.value
  if (!value) return null
  const [encodedUserId, expiresAtText, receivedSignature, ...extra] = value.split('.')
  if (!encodedUserId || !expiresAtText || !receivedSignature || extra.length || !/^\d+$/.test(expiresAtText)) return null
  const payload = `${encodedUserId}.${expiresAtText}`
  const expectedSignature = signature(payload)
  const expected = Buffer.from(expectedSignature)
  const received = Buffer.from(receivedSignature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  if (Number(expiresAtText) < Math.floor(Date.now() / 1000)) return null
  const userId = Buffer.from(encodedUserId, 'base64url').toString('utf8')
  return /^usr_[a-z0-9_]{3,64}$/.test(userId) ? userId : null
}
