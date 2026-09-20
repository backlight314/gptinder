import { z } from 'zod'
import { storePersona } from '@/lib/persona-store'
import { manualPersonaSchema } from '@/lib/psychology/schemas'

export const runtime = 'nodejs'

const requestSchema = z.object({
  userId: z.string().trim().regex(/^usr_[a-z0-9_]{3,64}$/).optional(),
  slot: z.enum(['a', 'b']),
  persona: manualPersonaSchema,
})

export async function POST(request: Request) {
  try {
    const body = requestSchema.safeParse(await request.json())
    if (!body.success) {
      return Response.json(
        { error: 'Complete the profile, values, goals, and relationship preferences before saving.' },
        { status: 400 },
      )
    }

    const stored = await storePersona(body.data.persona, body.data.slot, body.data.userId)
    return Response.json(stored)
  } catch (error) {
    console.error('Persona save failed', error)
    return Response.json(
      { error: 'The persona could not be saved. Check the server configuration and try again.' },
      { status: 500 },
    )
  }
}
