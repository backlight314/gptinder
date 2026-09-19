import { z } from 'zod'
import { SocialImportError, importPublicProfile } from '@/lib/social-import'
import { storeSocialImport } from '@/lib/social-store'

export const runtime = 'nodejs'
export const maxDuration = 300

const requestSchema = z.object({
  url: z.string().trim().min(1).max(500),
  personaSlot: z.enum(['a', 'b']),
  consent: z.literal(true),
})

export async function POST(request: Request) {
  try {
    if (!process.env.MONGODB_URI) {
      return Response.json(
        { error: 'MongoDB is not configured yet. Add MONGODB_URI to the server environment.' },
        { status: 503 },
      )
    }

    const body = requestSchema.safeParse(await request.json())
    if (!body.success) {
      return Response.json(
        { error: 'Enter a supported profile and confirm you have permission to import it.' },
        { status: 400 },
      )
    }

    const imported = await importPublicProfile(
      body.data.url,
      body.data.personaSlot === 'a' ? 'coral' : 'violet',
    )
    const stored = await storeSocialImport(imported)

    return Response.json({
      profileId: stored.profileId,
      storedPostCount: stored.storedPostCount,
      storedCommentCount: stored.storedCommentCount,
      storedSectionCount: stored.storedSectionCount,
      storedProfileImage: stored.storedProfileImage,
      storedCoverImage: stored.storedCoverImage,
      profile: imported.profile,
      posts: imported.posts.map(({ sourceData: _sourceData, ...post }) => post),
      persona: imported.persona,
    })
  } catch (error) {
    if (error instanceof SocialImportError) {
      return Response.json({ error: error.message }, { status: error.status })
    }

    console.error('Profile import failed', error)
    return Response.json(
      { error: 'The profile could not be imported or stored. Check the server configuration and try again.' },
      { status: 500 },
    )
  }
}
