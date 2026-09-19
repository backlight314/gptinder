import { z } from 'zod'
import { storePersona } from '@/lib/persona-store'

export const runtime = 'nodejs'

const requestSchema = z.object({
  userId: z.string().trim().regex(/^usr_[a-z0-9_]{3,64}$/).optional(),
  slot: z.enum(['a', 'b']),
  persona: z.object({
    name: z.string().trim().min(1).max(80),
    bio: z.string().trim().min(1).max(600),
    traits: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    interests: z.array(z.string().trim().min(1).max(80)).min(1).max(12),
    style: z.string().trim().min(1).max(400),
  }),
})

export async function POST(request: Request) {
  try {
    const body = requestSchema.safeParse(await request.json())
    if (!body.success) {
      return Response.json(
        { error: 'Complete the name, bio, traits, interests, and conversation style before saving.' },
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
