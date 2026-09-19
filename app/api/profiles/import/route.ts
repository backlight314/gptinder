import { z } from 'zod'
import { SocialImportError, importPublicProfile, parsePublicProfile } from '@/lib/social-import'
import { storeSocialImport } from '@/lib/social-store'
import type { SocialPlatform } from '@/lib/social-types'

export const runtime = 'nodejs'
export const maxDuration = 300

const requestSchema = z.object({
  url: z.string().trim().min(1).max(500).optional(),
  urls: z.array(z.string().trim().min(1).max(500)).min(1).max(3).optional(),
  personaSlot: z.enum(['a', 'b']),
  consent: z.literal(true),
  userId: z.string().trim().regex(/^usr_[a-z0-9_]{3,64}$/).optional(),
}).refine((value) => Boolean(value.url || value.urls?.length), {
  message: 'At least one profile URL is required.',
})

const platformOrder: SocialPlatform[] = ['linkedin', 'instagram', 'x']
type ParsedProfile = ReturnType<typeof parsePublicProfile>

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

    const requestedUrls = [...(body.data.url ? [body.data.url] : []), ...(body.data.urls || [])]
    const byPlatform = new Map<SocialPlatform, ParsedProfile>()
    for (const requestedUrl of requestedUrls) {
      const parsed = parsePublicProfile(requestedUrl)
      const existing = byPlatform.get(parsed.platform)
      if (existing && existing.handle.toLowerCase() !== parsed.handle.toLowerCase()) {
        return Response.json(
          { error: `Only one ${parsed.platform} profile can be linked to a user.` },
          { status: 400 },
        )
      }
      byPlatform.set(parsed.platform, parsed)
    }

    const orderedProfiles = platformOrder
      .map((platform) => byPlatform.get(platform))
      .filter((profile): profile is ParsedProfile => Boolean(profile))
    const importedProfiles = await Promise.all(
      orderedProfiles.map((profile) => importPublicProfile(profile.sourceUrl)),
    )

    let userId = body.data.userId
    const storedImports = []
    for (const imported of importedProfiles) {
      const stored = await storeSocialImport(imported, userId)
      userId = stored.userId
      storedImports.push({ imported, stored })
    }

    const primary = storedImports[0]
    return Response.json({
      profileId: primary.stored.profileId,
      userId,
      storedProfileCount: storedImports.length,
      storedPostCount: storedImports.reduce((total, item) => total + item.stored.storedPostCount, 0),
      storedCommentCount: storedImports.reduce((total, item) => total + item.stored.storedCommentCount, 0),
      storedSectionCount: storedImports.reduce((total, item) => total + item.stored.storedSectionCount, 0),
      storedProfileImage: storedImports.some((item) => item.stored.storedProfileImage),
      storedCoverImage: storedImports.some((item) => item.stored.storedCoverImage),
      profile: primary.imported.profile,
      profiles: storedImports.map((item) => item.imported.profile),
      posts: primary.imported.posts.map(({ sourceData: _sourceData, ...post }) => post),
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
