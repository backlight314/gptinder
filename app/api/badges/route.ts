import { randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { route, readJson } from '@/lib/server/http'
import { currentUser, hashSecret, rateLimit } from '@/lib/server/auth'
import { collections } from '@/lib/server/db'
import { AppError } from '@/lib/server/errors'
export const runtime = 'nodejs'
export const POST = route(async () => {
  const user = await currentUser()
  await rateLimit(`badge:${user._id}`, 4)
  if (!user.profileVersionId)
    throw new AppError(409, 'Approve your profile before binding a badge.')
  const token = randomBytes(16).toString('hex')
  const id = randomUUID()
  const expiresAt = new Date(Date.now() + 7 * 86400000)
  await (
    await collections()
  ).badges.insertOne({
    _id: id,
    userId: user._id,
    tokenHash: hashSecret(token),
    status: 'active',
    expiresAt,
    createdAt: new Date(),
  })
  return { id, token, expiresAt }
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
