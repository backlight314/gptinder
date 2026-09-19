import { route, readJson } from '@/lib/server/http'
import { currentUser } from '@/lib/server/auth'
import { approveProfile, approvalInput } from '@/lib/server/onboarding'
export const runtime = 'nodejs'
export const POST = route(
  async (request) =>
    approveProfile(
      (await currentUser())._id,
      await readJson(request, approvalInput),
    ),
  true,
)
