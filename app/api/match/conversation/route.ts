import { start } from 'workflow/api'
import { z } from 'zod'
import { createEncounter } from '@/lib/encounters/store'
import { psychologyConversationWorkflow } from '@/workflows/psychology-conversation'
import { CONVERSATION_TURNS, type ConversationScenario } from '@/lib/compatibility'

export const runtime = 'nodejs'
export const maxDuration = 300

const requestSchema = z.object({
  participants: z.object({
    a: z.object({ userId: z.string().min(1).max(100) }),
    b: z.object({ userId: z.string().min(1).max(100) }),
  }),
  turns: z.number().int().min(2).max(CONVERSATION_TURNS).default(CONVERSATION_TURNS),
  scenario: z.enum(['natural', 'friction']).default('natural'),
})

export async function POST(request: Request) {
  try {
    const body = requestSchema.safeParse(await request.json().catch(() => null))
    if (!body.success) return Response.json({ error: 'Both approved profiles and user IDs are required.' }, { status: 400 })
    if (body.data.participants.a.userId === body.data.participants.b.userId)
      return Response.json({ error: 'Choose two different people.' }, { status: 400 })
    const encounterId = await createEncounter(body.data as { participants: Record<'a' | 'b', { userId: string }>; turns: number; scenario: ConversationScenario })
    await start(psychologyConversationWorkflow, [encounterId])
    return Response.json({ encounterId, status: 'pending_start' }, { status: 202 })
  } catch (error) {
    console.error('Conversation start failed', error)
    return Response.json({ error: 'The conversation could not be started.' }, { status: 500 })
  }
}
