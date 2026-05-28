import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { getCurrentUser } from '@/lib/auth'

export default async function RootPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Detect mobile qua User-Agent — mobile mặc định vào /dashboard
  // (theo yêu cầu user: tối giản mobile, chỉ Dashboard + Billing).
  const ua = headers().get('user-agent') || ''
  const isMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua)
  if (isMobile) redirect('/dashboard')

  // Desktop: giữ logic cũ.
  if (user.role === 'ADMIN') redirect('/admin')
  redirect('/keo-ads')
}
