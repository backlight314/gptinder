import { z } from 'zod'
import { listLabProfiles, storePersona } from '@/lib/persona-store'
import { manualPersonaSchema } from '@/lib/psychology/schemas'
import { agentContextAccessCookie, currentAgentContextUserId } from '@/lib/agent-contexts/access'

export const runtime = 'nodejs'

const requestSchema = z.object({
  userId: z.string().trim().regex(/^usr_[a-z0-9_]{3,64}$/).optional(),
  slot: z.enum(['a', 'b']),
  persona: manualPersonaSchema,
})

export async function GET(request: Request) {
  const requestedSlot = new URL(request.url).searchParams.get('slot')
  if (requestedSlot && requestedSlot !== 'a' && requestedSlot !== 'b') {
    return Response.json({ error: 'Slot must be a or b.' }, { status: 400 })
  }
  try {
    const currentUserId = await currentAgentContextUserId()
    const profiles = await listLabProfiles(requestedSlot as 'a' | 'b' | undefined)
    return Response.json({ profiles: profiles.map(profile => ({ ...profile, owned: profile.userId === currentUserId })) })
  } catch (error) {
    console.error('Persona list failed', error)
    return Response.json(
      { error: 'The stored profiles could not be loaded. Check the server configuration and try again.' },
      { status: 500 },
    )
  }
}

export async function POST(request: Request) {
  try {
    const body = requestSchema.safeParse(await request.json())
    if (!body.success) {
      return Response.json(
        { error: 'Complete the profile, values, goals, and relationship preferences before saving.' },
        { status: 400 },
      )
    }
    const currentUserId = await currentAgentContextUserId()
    if (body.data.userId && body.data.userId !== currentUserId) {
      return Response.json({ error: 'This account is not authorized in the current browser session.' }, { status: 403 })
    }

    const stored = await storePersona(body.data.persona, body.data.slot, body.data.userId)
    const canAccessAccount = stored.userCreated || currentUserId === stored.userId
    const response = Response.json(canAccessAccount ? stored : { ...stored, agentContext: undefined })
    if (canAccessAccount)
      response.headers.set('Set-Cookie', agentContextAccessCookie(stored.userId))
    return response
  } catch (error) {
    console.error('Persona save failed', error)
    return Response.json(
      { error: 'The persona could not be saved. Check the server configuration and try again.' },
      { status: 500 },
    )
  }
}
