import { NextResponse } from 'next/server'
import { z } from 'zod'
import { publicError, readJsonBody } from '@/lib/airos-api'
import { resetAirosDemoData } from '@/lib/airos-demo-reset'

export const runtime = 'nodejs'

const resetSchema = z.strictObject({
  confirmation: z.literal('RESET'),
})

export async function POST(request: Request) {
  try {
    resetSchema.parse(await readJsonBody(request))
    const result = await resetAirosDemoData()
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('AIROS demo reset failed', error instanceof Error ? error.message : 'Unknown reset error')
    const response = publicError(error)
    return NextResponse.json({ error: response.message }, { status: response.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
