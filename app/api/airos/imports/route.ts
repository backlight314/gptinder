import { NextResponse } from 'next/server'
import { enforceAirosRateLimit, publicError, readJsonBody } from '@/lib/airos-api'
import { importAirosBatch } from '@/lib/airos-directory-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    await enforceAirosRateLimit(request, 'import')
    const body = await readJsonBody(request)
    return NextResponse.json(await importAirosBatch(body))
  } catch (error) {
    console.error('AIROS import failed', error)
    const response = publicError(error)
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
