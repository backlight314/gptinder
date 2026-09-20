import { listEncounters } from '@/lib/learning/store'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const requested = Number(new URL(request.url).searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 100) : 50
  const offset = Math.max(0, Math.min(1000000, Math.trunc(Number(new URL(request.url).searchParams.get('offset')) || 0)))
  try {
    const encounters = await listEncounters(limit, offset)
    return Response.json({ encounters, nextOffset: encounters.length === limit ? offset + limit : null })
  } catch (error) {
    console.error('Conversation log failed', error)
    return Response.json({ error: 'The conversation log could not be loaded.' }, { status: 500 })
  }
}
