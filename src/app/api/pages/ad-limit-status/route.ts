import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"

// GET /api/pages/ad-limit-status
// Trả về list page kèm metrics ad limit (snapshot từ cron 6h hoặc manual sync).
// FE filter/sort theo % usage để hiển thị tab "Cảnh báo" / "Vượt limit".
export async function GET() {
  try {
    const user = await requireAuth()
    const pages = await prisma.fanPage.findMany({
      where: { userId: user.userId, isSelected: true },
      select: {
        id: true,
        name: true,
        pageId: true,
        accountId: true,
        account: { select: { name: true, actId: true } },
        pageAdsTotal: true,
        pageAdsCurrentAccount: true,
        pageAdLimit: true,
        pageAdLimitCheckedAt: true,
        pageAdLimitError: true,
      },
      orderBy: { name: "asc" },
    })

    // Tính % usage cho FE sort dễ.
    const enriched = pages.map((p) => {
      const total = p.pageAdsTotal ?? 0
      const limit = p.pageAdLimit ?? 0
      const usagePct = limit > 0 ? Math.round((total / limit) * 100) : null
      const otherAccountAds = (total > 0 && p.pageAdsCurrentAccount != null)
        ? Math.max(0, total - p.pageAdsCurrentAccount)
        : null
      // Status: ok (<80%), warning (80-99%), over (≥100%), no-data (chưa sync hoặc page chưa gán TKQC).
      let status: "ok" | "warning" | "over" | "no-data" | "error" = "no-data"
      if (p.pageAdLimitError) status = "error"
      else if (usagePct == null) status = "no-data"
      else if (usagePct >= 100) status = "over"
      else if (usagePct >= 80) status = "warning"
      else status = "ok"
      return { ...p, usagePct, otherAccountAds, status }
    })

    // Last sync time = max checkedAt giữa các page.
    const lastSyncAt = enriched.reduce<Date | null>((acc, p) => {
      if (!p.pageAdLimitCheckedAt) return acc
      if (!acc || p.pageAdLimitCheckedAt > acc) return p.pageAdLimitCheckedAt
      return acc
    }, null)

    // Aggregate counts cho tab.
    const counts = {
      total: enriched.length,
      ok: enriched.filter(p => p.status === "ok").length,
      warning: enriched.filter(p => p.status === "warning").length,
      over: enriched.filter(p => p.status === "over").length,
      noData: enriched.filter(p => p.status === "no-data").length,
      error: enriched.filter(p => p.status === "error").length,
    }

    return NextResponse.json({ pages: enriched, lastSyncAt, counts })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    return safeError(e, "pages/ad-limit-status")
  }
}
