import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { collections, transaction } from './db'
import { hashSecret, newSecret, rateLimit } from './auth'
import { authEnv } from './env'
import { AppError } from './errors'

export const emailRequestSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((email) => email.trim().toLowerCase()),
  displayName: z.string().trim().min(1).max(60),
  adult: z.literal(true),
})

/** An address proves nothing until its one-use emailed secret is returned. */
export async function requestEmailSignIn(
  raw: z.input<typeof emailRequestSchema>,
) {
  const input = emailRequestSchema.parse(raw)
  await rateLimit(`email:${input.email}`, 3, 900)
  const config = z
    .object({
      RESEND_API_KEY: z.string().min(1),
      EMAIL_FROM: z.string().min(3),
    })
    .safeParse(process.env)
  if (!config.success)
    throw new AppError(
      503,
      'Email sign-in is not configured. Contact the demo organizer.',
    )
  const token = newSecret()
  const c = await collections()
  const id = hashSecret(token)
  await c.loginTokens.insertOne({
    _id: id,
    email: input.email,
    displayName: input.displayName,
    expiresAt: new Date(Date.now() + 15 * 60000),
  })
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.data.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `login-${id}`,
      },
      body: JSON.stringify({
        from: config.data.EMAIL_FROM,
        to: [input.email],
        subject: 'Your GPTinder sign-in code',
        text: `Return to ${new URL(authEnv().APP_URL).origin} and paste this single-use sign-in code:\n\n${token}\n\nIt expires in 15 minutes. This also restores access to your existing account. Never share this code. If you did not request it, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10000),
    })
    if (!response.ok) throw new Error('Email delivery failed')
  } catch {
    await c.loginTokens.deleteOne({ _id: id })
    throw new AppError(
      503,
      'Unable to send the sign-in email. Please retry later.',
    )
  }
  // Identical response for existing and new addresses; never return or log the secret.
  return { sent: true }
}

export async function verifyEmailSignIn(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    throw new AppError(401, 'Invalid or expired sign-in code.')
  const c = await collections()
  return transaction(async (session) => {
    const record = await c.loginTokens.findOneAndDelete(
      { _id: hashSecret(token), expiresAt: { $gt: new Date() } },
      { session },
    )
    if (!record) throw new AppError(401, 'Invalid or expired sign-in code.')
    // Atomic upsert plus unique email index prevents concurrent duplicate accounts.
    const user = await c.users.findOneAndUpdate(
      { email: record.email },
      {
        $setOnInsert: {
          _id: randomUUID(),
          displayName: record.displayName,
          accessKeyHash: hashSecret(newSecret()),
          emailVerifiedAt: new Date(),
          createdAt: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after', session },
    )
    if (!user) throw new AppError(503, 'Unable to restore account.')
    return user._id
  })
}
