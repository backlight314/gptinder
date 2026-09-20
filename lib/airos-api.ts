import 'server-only'

import { createHash } from 'node:crypto'
import { getMongoDatabase } from '@/lib/mongodb'

const MAX_REQUEST_BYTES = 256 * 1024

export class AirosHttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
  }
}

export async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (declaredLength > MAX_REQUEST_BYTES) throw new AirosHttpError('Request body is too large.', 413)
  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) {
    throw new AirosHttpError('Request body is too large.', 413)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new AirosHttpError('Request body must be valid JSON.', 400)
  }
}

function clientAddress(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')?.trim()
    || 'unknown'
}

function configuredLimit(kind: 'preview' | 'import' | 'analyze') {
  const fallback = kind === 'preview' ? 30 : kind === 'import' ? 10 : 5
  const key = `AIROS_${kind.toUpperCase()}_LIMIT_PER_HOUR`
  const value = Number(process.env[key])
  return Number.isInteger(value) && value > 0 && value <= 10_000 ? value : fallback
}

export async function enforceAirosRateLimit(request: Request, kind: 'preview' | 'import' | 'analyze') {
  const hostname = new URL(request.url).hostname
  const isLocalRequest = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  const salt = process.env.AIROS_RATE_LIMIT_SALT
    || (process.env.NODE_ENV !== 'production' || isLocalRequest ? 'airos-development-only-salt' : null)
  if (!salt) throw new AirosHttpError('Anonymous write rate limiting is not configured.', 503)
  const addressHash = createHash('sha256').update(`${salt}:${clientAddress(request)}`).digest('hex')
  const now = Date.now()
  const windowStart = Math.floor(now / 3_600_000) * 3_600_000
  const expiresAt = new Date(windowStart + 2 * 3_600_000)
  const id = createHash('sha256').update(`${kind}:${addressHash}:${windowStart}`).digest('hex')
  const database = await getMongoDatabase()
  const result = await database.collection<{ _id: string; count: number }>('airos_rate_limits').findOneAndUpdate(
    { _id: id },
    {
      $inc: { count: 1 },
      $setOnInsert: { kind, addressHash, windowStart: new Date(windowStart), expiresAt, createdAt: new Date(now) },
    },
    { upsert: true, returnDocument: 'after' },
  )
  if (!result || result.count > configuredLimit(kind)) {
    throw new AirosHttpError(`Too many ${kind} requests. Try again later.`, 429)
  }
}

export function publicError(error: unknown) {
  if (error instanceof AirosHttpError) return { message: error.message, status: error.status }
  if (error && typeof error === 'object' && 'issues' in error) {
    return { message: 'The submitted badge data is invalid.', status: 400 }
  }
  if (error instanceof Error && error.message === 'MONGODB_URI is not configured') {
    return { message: 'The Hack the Heart database is not configured.', status: 503 }
  }
  return { message: 'The request could not be completed.', status: 500 }
}
