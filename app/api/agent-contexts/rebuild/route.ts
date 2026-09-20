import { NextResponse } from 'next/server'
import { currentAgentContextUserId } from '@/lib/agent-contexts/access'
import { agentContextView, getRequiredAgentContext, rebuildAgentContext } from '@/lib/agent-contexts/store'

export const runtime = 'nodejs'
export const maxDuration = 300

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    const originHost = new URL(origin).host
    const requestHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || new URL(request.url).host
    return originHost === requestHost
  } catch {
    return false
  }
}

async function callerUserId() {
  const userId = await currentAgentContextUserId()
  if (!userId) throw new Error('No account is authorized to view or rebuild this agent prompt.')
  return userId
}

export async function GET() {
  try {
    const context = await getRequiredAgentContext(await callerUserId())
    return NextResponse.json({ agentContext: agentContextView(context) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The agent prompt could not be loaded.'
    return NextResponse.json({ error: message }, { status: 401 })
  }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 })
  try {
    // The account comes only from the signed, HttpOnly server-issued cookie.
    const context = await rebuildAgentContext(await callerUserId())
    return NextResponse.json({ agentContext: agentContextView(context) })
  } catch (error) {
    console.error('Agent context rebuild failed', error)
    const message = error instanceof Error ? error.message : 'The agent prompt could not be rebuilt.'
    const status = message.startsWith('No account') ? 401 : 500
    return NextResponse.json({ error: status === 500 ? 'The agent prompt could not be rebuilt. The previous prompt is still in use.' : message }, { status })
  }
}
