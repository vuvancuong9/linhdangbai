import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

// GET /api/pages/auto-manage-config
// Trả list fanpage + 2 threshold (autoBudgetUpThreshold, autoOffThreshold) cho UI config modal.
export async function GET() {
  try {
    const user = await requireAuth()
    const pages = await prisma.fanPage.findMany({
      where: { userId: user.userId },
      select: {
        id: true,
        name: true,
        pageId: true,
        autoBudgetUpThreshold: true,
        autoOffThreshold: true,
      },
      orderBy: { name: "asc" },
    })
    return NextResponse.json({ ok: true, pages })
  } catch (e: any) {
  return safeError(e, "pages/auto-manage-config")
}
}

// PATCH /api/pages/auto-manage-config
// Body: { updates: [{ pageId: string, autoBudgetUpThreshold: number|null, autoOffThreshold: number|null }, ...] }
// Bulk update — dùng cho cả 1 fanpage lẫn "Áp tất cả".
// Threshold: số nguyên 0-1000 (%), null = clear config (skip).
export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth()
    const body = await req.json().catch(() => ({}))
    const updates: any[] = Array.isArray(body?.updates) ? body.updates : []
    if (updates.length === 0) return NextResponse.json({ error: "Thiếu updates" }, { status: 400 })

    // Validate + collect valid updates
    const valid: Array<{ id: string; data: { autoBudgetUpThreshold?: number | null; autoOffThreshold?: number | null } }> = []
    for (const u of updates) {
      if (!u?.pageId || typeof u.pageId !== "string") continue
      const data: any = {}
      if (u.autoBudgetUpThreshold !== undefined) {
        if (u.autoBudgetUpThreshold === null || u.autoBudgetUpThreshold === "") {
          data.autoBudgetUpThreshold = null
        } else {
          const n = Number(u.autoBudgetUpThreshold)
          if (Number.isFinite(n) && n >= 0 && n <= 1000) data.autoBudgetUpThreshold = Math.round(n)
        }
      }
      if (u.autoOffThreshold !== undefined) {
        if (u.autoOffThreshold === null || u.autoOffThreshold === "") {
          data.autoOffThreshold = null
        } else {
          const n = Number(u.autoOffThreshold)
          if (Number.isFinite(n) && n >= 0 && n <= 1000) data.autoOffThreshold = Math.round(n)
        }
      }
      if (Object.keys(data).length > 0) valid.push({ id: u.pageId, data })
    }
    if (valid.length === 0) return NextResponse.json({ error: "Không có update hợp lệ" }, { status: 400 })

    // updateMany với guard userId — 1 round-trip thay vì N updates.
    // Tách theo "data shape" để batch. Đa số case: tất cả update cùng 2 field.
    let updated = 0
    for (const v of valid) {
      const r = await prisma.fanPage.updateMany({
        where: { id: v.id, userId: user.userId },
        data: v.data,
      })
      updated += r.count
    }

    return NextResponse.json({ ok: true, updated })
  } catch (e: any) {
  return safeError(e, "pages/auto-manage-config")
}
}
