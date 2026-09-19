import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { currentUser, hashSecret, rateLimit } from '@/lib/server/auth'
import { collections } from '@/lib/server/db'
import { AppError } from '@/lib/server/errors'
import { parsePublicProfile, SocialImportError } from '@/lib/social-import'
export const runtime = 'nodejs'
const bindingSchema = z.object({
  profileUrl: z.string().trim().min(1).max(500),
  consent: z.literal(true),
})
export const POST = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`badge:${user._id}`, 4)
  if (!user.profileVersionId)
    throw new AppError(409, 'Approve your profile before binding a badge.')
  const input = await readJson(request, bindingSchema, 2048)
  let profileUrl: string
  try {
    profileUrl = parsePublicProfile(input.profileUrl).sourceUrl
  } catch (error) {
    if (error instanceof SocialImportError)
      throw new AppError(error.status, error.message)
    throw error
  }
  const token = randomBytes(16).toString('hex')
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 86400000)
  await (
    await collections()
  ).badges.insertOne({
    _id: id,
    userId: user._id,
    tokenHash: hashSecret(token),
    profileUrl,
    status: 'active',
    expiresAt,
    createdAt: new Date(),
  })
  return { id, token, profileUrl, expiresAt }
}, true)
export const DELETE = route(async (request) => {
  const user = await currentUser()
  const { id } = await readJson(request, z.object({ id: z.string().uuid() }))
  await (
    await collections()
  ).badges.updateOne(
    { _id: id, userId: user._id },
    { $set: { status: 'revoked' } },
  )
  return { ok: true }
}, true)
