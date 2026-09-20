import { start } from 'workflow/api'
import { z } from 'zod'
import { feedbackRequestSchema } from '@/lib/learning/schemas'
import { recordEncounterFeedback } from '@/lib/learning/store'
import { feedbackAdaptationWorkflow } from '@/workflows/feedback-adaptation'

export const runtime = 'nodejs'
export const maxDuration = 300

const idSchema = z.string().regex(/^enc_[0-9a-f-]{36}$/)

export async function POST(request: Request, context: { params: Promise<{ encounterId: string }> }) {
  const { encounterId } = await context.params
  if (!idSchema.safeParse(encounterId).success) return Response.json({ error: 'Invalid encounter ID.' }, { status: 400 })
  const body = feedbackRequestSchema.safeParse(await request.json().catch(() => null))
  if (!body.success) return Response.json({ error: 'Report whether the date went well.' }, { status: 400 })
  try {
    const result = await recordEncounterFeedback(encounterId, body.data.outcome)
    if (result.status === 'applied' || result.status === 'learning')
      return Response.json({ encounterId, outcome: result.outcome, status: result.status, alreadyRecorded: true })
    await start(feedbackAdaptationWorkflow, [encounterId])
    return Response.json({ encounterId, outcome: result.outcome, status: 'pending' }, { status: 202 })
  } catch (error) {
    console.error('Feedback save failed', error)
    const message = error instanceof Error && error.message === 'The conversation is not complete yet'
      ? 'Wait until the conversation finishes before reporting the date.'
      : 'The date report could not be saved.'
    return Response.json({ error: message }, { status: 400 })
  }
}
