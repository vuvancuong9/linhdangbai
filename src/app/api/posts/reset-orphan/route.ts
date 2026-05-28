import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/reset-orphan
// Reset các post bị "orphan": đã đánh dấu adCreated=true nhưng adAccountId=null
// (post bị lỗi nửa chừng — campaign trên FB có thể chưa tạo xong, cần làm lại).
// Đưa về pending để hiện ở trang chính, user có thể chọn và Tạo Campaign lại.
export async function POST() {
  try {
    const user = await requireAuth()
    const userScope = { userId: user.userId }

    const r = await prisma.post.updateMany({
      where: {
        ...(userScope as any),
        adCreated: true,
        adAccountId: null,
        deleted: false,
      },
      data: {
        adCreated: false,
        adCreatedAt: null,
        adError: null,
        adErrorAt: null,
      },
    })

    return NextResponse.json({
      ok: true,
      reset: r.count,
      message: `Đã reset ${r.count} bài về trạng thái chờ tạo lại.`,
    })
  } catch (e: any) {
  return safeError(e, "posts/reset-orphan")
}
}
