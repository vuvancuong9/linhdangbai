import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, invalidateSessionCache } from '@/lib/auth'

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const session = await prisma.loginSession.findUnique({ where: { id: params.id } })
    if (!session || session.userId !== user.userId) {
      return NextResponse.json({ success: false, message: 'Không tìm thấy session' }, { status: 404 })
    }
    if (session.revokedAt) {
      return NextResponse.json({ success: false, message: 'Session đã bị đăng xuất rồi' }, { status: 400 })
    }
    await prisma.loginSession.update({
      where: { id: params.id },
      data: { revokedAt: new Date() }
    })
    // Invalidate cache để session bị revoke có hiệu lực ngay (không phải đợi TTL 60s).
    invalidateSessionCache(params.id)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    if (e?.message === 'UNAUTHORIZED') return NextResponse.json({ success: false, message: 'Chưa đăng nhập' }, { status: 401 })
    return NextResponse.json({ success: false, message: 'Lỗi server' }, { status: 500 })
  }
}
