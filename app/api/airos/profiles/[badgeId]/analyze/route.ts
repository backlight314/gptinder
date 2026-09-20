import { NextResponse } from 'next/server'
import { enforceAirosRateLimit, publicError } from '@/lib/airos-api'
import { analyzeAirosProfile } from '@/lib/airos-profile-analysis'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, context: { params: Promise<{ badgeId: string }> }) {
  try {
    await enforceAirosRateLimit(request, 'analyze')
    const { badgeId } = await context.params
    return NextResponse.json(await analyzeAirosProfile(badgeId))
  } catch (error) {
    console.error('AIROS profile analysis failed', error)
    const response = publicError(error)
    return NextResponse.json({ error: response.message }, { status: response.status })
  }
}
