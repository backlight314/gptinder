import { NextResponse } from 'next/server'
import { z } from 'zod'
import { enforceAirosRateLimit, publicError, readJsonBody } from '@/lib/airos-api'
import { refreshAirosProfilePhotos } from '@/lib/airos-photo-refresh'

export const runtime = 'nodejs'
export const maxDuration = 300

const requestSchema = z.object({
  badgeIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
}).strict()

export async function POST(request: Request) {
  try {
    await enforceAirosRateLimit(request, 'photo')
    const body = requestSchema.parse(await readJsonBody(request))
    return NextResponse.json(await refreshAirosProfilePhotos([...new Set(body.badgeIds)]))
  } catch (error) {
    console.error('AIROS profile photo refresh failed', error)
    const response = publicError(error)
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
