import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth } from '@/lib/auth'

function parseDevice(ua?: string | null) {
  if (!ua) return { browser: 'Unknown', os: 'Unknown' }
  let browser = 'Unknown'
  let os = 'Unknown'
  if (ua.includes('Edg/')) browser = 'Edge'
  else if (ua.includes('Chrome/')) browser = 'Chrome'
  else if (ua.includes('Firefox/')) browser = 'Firefox'
  else if (ua.includes('Safari/')) browser = 'Safari'
  if (ua.includes('Windows')) os = 'Windows'
  else if (ua.includes('Mac OS X')) os = 'macOS'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Linux')) os = 'Linux'
  return { browser, os }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const sessions = await prisma.loginSession.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const currentSessionId = user.sessionId
    const data = sessions.map(s => ({
      id: s.id,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      device: parseDevice(s.userAgent),
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      revokedAt: s.revokedAt,
      isCurrent: s.id === currentSessionId,
    }))
    return NextResponse.json({ success: true, data })
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return NextResponse.json({ success: false, message: 'Chưa đăng nhập' }, { status: 401 })
    return NextResponse.json({ success: false, message: 'Lỗi server' }, { status: 500 })
  }
}
