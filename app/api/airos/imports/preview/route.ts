import { NextResponse } from 'next/server'
import { enforceAirosRateLimit, publicError, readJsonBody } from '@/lib/airos-api'
import { previewAirosImport } from '@/lib/airos-directory-store'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    await enforceAirosRateLimit(request, 'preview')
    const body = await readJsonBody(request)
    return NextResponse.json(await previewAirosImport(body))
  } catch (error) {
    console.error('AIROS import preview failed', error)
    const response = publicError(error)
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
