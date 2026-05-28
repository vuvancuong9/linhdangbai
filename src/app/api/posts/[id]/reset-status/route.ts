import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/[id]/reset-status — đưa post từ "lỗi" về trạng thái chờ tạo lại.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireAuth()
    const where = { id: params.id, userId: user.userId }
    const post = await prisma.post.findFirst({ where })
    if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 })
    await prisma.post.update({
      where: { id: params.id },
      data: { adError: null, adErrorAt: null, adErrorRetryCount: 0, adCreated: false, adCreatedAt: null },
    })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
  return safeError(e, "posts/[id]/reset-status")
}
}
