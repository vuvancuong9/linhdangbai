import { NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { fixFanpageForUser } from "@/lib/fix-fanpage"

// POST /api/posts/fix-fanpage
// Backfill pageId cho posts cũ. Logic dùng chung lib/fix-fanpage.ts.
// Endpoint giữ để debug / dev tool — UI đã ẩn nút vì cron sync-posts tự fix.
export async function POST() {
  try {
    const user = await requireAuth()
    const r = await fixFanpageForUser(user.userId)
    if (r.pagesInDb === 0) {
      return NextResponse.json({
        ok: true, ...r,
        message: "Không có Fanpage nào trong DB. Vào Keo Ads → Đồng bộ FB để tạo Fanpage trước.",
      })
    }
    return NextResponse.json({
      ok: true, ...r,
      message: `Đã sửa ${r.fixed} bài. Bỏ qua ${r.skipped} (Fanpage đã xoá hoặc fbId không hợp lệ).`,
    })
  } catch (e: any) {
    console.error("[fix-fanpage] Error:", e?.message, e?.stack)
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "posts/fix-fanpage")
  }
}
