import { route } from '@/lib/server/http'
import { currentUser, rateLimit } from '@/lib/server/auth'
import { deleteImport, getImport } from '@/lib/server/imports'
import { retryImport } from '@/lib/server/import-dispatch'
export const runtime = 'nodejs'
export const maxDuration = 60
const idFrom = (request: Request) =>
  new URL(request.url).pathname.split('/').pop() ?? ''
export const GET = route(async (request) =>
  getImport((await currentUser())._id, idFrom(request)),
)
export const DELETE = route(
  async (request) => deleteImport((await currentUser())._id, idFrom(request)),
  true,
)
export const POST = route(async (request) => {
  const user = await currentUser()
  await rateLimit(`import-retry:${user._id}`, 6)
  await retryImport(idFrom(request), user._id)
  return { ok: true }
}, true)
