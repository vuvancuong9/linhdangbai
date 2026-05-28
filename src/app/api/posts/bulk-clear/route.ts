import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// POST /api/posts/bulk-clear
// Body: { mode: "delete-created" | "delete-errors" | "reset-errors" | "reset-created", postIds?: string[] }
// - delete-created: XOÁ HẲN posts có adCreated=true (camp đã tạo). Camp trên FB không động đến.
// - delete-errors: XOÁ HẲN posts có adError ≠ null (camp lỗi).
// - reset-errors: Reset post lỗi về pending (giữ post, xoá adError → cho tạo lại).
// - reset-created: Reset post đã tạo về pending → cho tạo lại camp (camp cũ trên FB GIỮ NGUYÊN, có thể trùng tên).
// - postIds (optional): nếu cung cấp → chỉ apply cho các posts có id trong list (sub-set của filter mode).
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (req.headers.get("x-confirm") !== "yes") {
      return NextResponse.json({ error: "Cần header X-Confirm=yes (destructive op)" }, { status: 400 })
    }
    const body = await req.json().catch(() => ({}))
    const { mode, postIds } = body
    if (!["delete-created", "delete-errors", "reset-errors", "reset-created"].includes(mode)) {
      return NextResponse.json({ error: "mode invalid" }, { status: 400 })
    }

    // Mỗi user chỉ thao tác trên data của mình.
    const where: any = { userId: user.userId }
    if (mode === "delete-created" || mode === "reset-created") where.adCreated = true
    else if (mode === "delete-errors" || mode === "reset-errors") where.adError = { not: null }

    // Filter theo postIds nếu có (bulk action trên specific posts đã chọn)
    if (Array.isArray(postIds) && postIds.length > 0) {
      where.id = { in: postIds.filter((x: any) => typeof x === "string").slice(0, 5000) }
    }

    if (mode === "reset-errors" || mode === "reset-created") {
      const r = await prisma.post.updateMany({
        where,
        data: { adError: null, adErrorAt: null, adErrorRetryCount: 0, adCreated: false, adCreatedAt: null },
      })
      return NextResponse.json({ ok: true, count: r.count, message: `Đã reset ${r.count} bài về pending` })
    }

    // delete-created OR delete-errors → SOFT delete (giữ record để sync-posts skip).
    const r = await prisma.post.updateMany({
      where,
      data: { deleted: true, deletedAt: new Date() },
    })
    if (r.count === 0) return NextResponse.json({ ok: true, count: 0, message: "Không có bài nào để xoá" })

    return NextResponse.json({ ok: true, count: r.count, message: `Đã xoá ${r.count} bài` })
  } catch (e: any) {
  return safeError(e, "posts/bulk-clear")
}
}
