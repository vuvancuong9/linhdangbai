import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAuth, isAdminRole } from '@/lib/auth'
import { safeError } from "@/lib/api"

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const skip = (page - 1) * limit
    const where: any = {
      userId: user.userId,
      exported: true,
      deleted: false,
    }
    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where, orderBy: { exportedAt: 'desc' },
        take: limit, skip,
        include: { page: true, campaign: true },
      }),
      prisma.post.count({ where }),
    ])
    return NextResponse.json({ posts, total, page, limit })
  } catch (e: any) {
  return safeError(e, "posts/exported")
}
}
