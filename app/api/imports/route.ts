import { route, readJson } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import { collections } from '@/lib/server/db'
import { importInputSchema } from '@/lib/import-domain'
import { createImport } from '@/lib/server/imports'
import { dispatchImport } from '@/lib/server/import-dispatch'
export const runtime = 'nodejs'
export const maxDuration = 60
export const POST = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`imports:${user._id}`, 4)
  const source = await createImport(
    user._id,
    await readJson(request, importInputSchema, 350000),
  )
  await dispatchImport(source._id)
  return { importId: source._id }
}, true)
export const GET = route(async () =>
  (await collections()).imports
    .find(
      { userId: (await currentUser())._id, status: { $ne: 'deleted' } },
      { projection: { _id: 1, label: 1, status: 1, createdAt: 1 } },
    )
    .sort({ createdAt: -1 })
    .limit(3)
    .toArray(),
)
