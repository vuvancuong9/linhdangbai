import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { syncOneMapping, syncAllUsersLatestMapping } from "@/lib/mapping-sync"
import { verifyCronSecret } from "@/lib/cron-auth"

export async function GET() {
  try {
    const user = await requireAuth()
    const mappings = await prisma.sheetMapping.findMany({
      where: { userId: user.userId },
      orderBy: { updatedAt: "desc" },
    })
    return NextResponse.json(mappings)
  } catch (e: any) {
  return safeError(e, "mapping")
}
}

export async function POST(req: NextRequest) {
  try {
    // Cron call: header x-cron-secret → sync mapping mới nhất của tất cả user.
    if (verifyCronSecret(req.headers.get("x-cron-secret"))) {
      const results = await syncAllUsersLatestMapping(3)
      const okCount = results.filter((r) => r.ok).length
      const totalUpdated = results.reduce((s, r) => s + (r.updatedPosts || 0), 0)
      return NextResponse.json({ ok: true, syncedUsers: okCount, totalUpdated, results })
    }

    // Manual call: requireAuth + body { sheetUrl, sheetName }
    const user = await requireAuth()
    const { sheetUrl, sheetName } = await req.json()
    if (!sheetUrl) return NextResponse.json({ error: "Thiếu URL" }, { status: 400 })

    const r = await syncOneMapping(user.userId, sheetUrl, sheetName || "Sheet1")
    if (!r.ok) return NextResponse.json({ error: r.error || "Lỗi sync" }, { status: 400 })
    return NextResponse.json({
      ok: true,
      mappingId: r.mappingId,
      totalRows: r.totalRows,
      updatedPosts: r.updatedPosts,
      message: `Sync thành công! ${r.totalRows} dòng mapping, cập nhật ${r.updatedPosts} bài post.`,
    })
  } catch (e: any) {
  return safeError(e, "mapping")
}
}
