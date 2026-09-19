import { route, readJson } from '@/lib/server/http'
import { currentUser } from '@/lib/server/auth'
import { approveImport, approveImportInput } from '@/lib/server/imports'
export const runtime = 'nodejs'
export const POST = route(
  async (request) =>
    approveImport(
      (await currentUser())._id,
      new URL(request.url).pathname.split('/').at(-2) ?? '',
      await readJson(request, approveImportInput),
    ),
  true,
)
