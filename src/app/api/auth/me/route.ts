import { getCurrentUser } from '@/lib/auth'
import { ok, unauthorized } from '@/lib/api'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return unauthorized()
  return ok({ user })
}
