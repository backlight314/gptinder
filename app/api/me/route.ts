import { route } from '@/lib/server/http'
import { currentUser } from '@/lib/server/auth'
import { getMe } from '@/lib/server/onboarding'
export const runtime = 'nodejs'
export const GET = route(async () => getMe(await currentUser()))
