import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"

export const runtime = "nodejs"
export const maxDuration = 60

// POST /api/campaigns/cleanup-legacy-dupes
// Dọn camp legacy (adAccountId=null) có name TRÙNG với camp khác đã có adAccountId.
// Logic:
//   1. Group camp theo name
//   2. Với mỗi name có 2+ camps: chọn canonical = camp có adAccountId (mới nhất nếu nhiều)
//   3. Reassign posts + camp_logs từ legacy → canonical
//   4. Delete legacy camps
// Trả về: { ok, removed, reassignedPosts, reassignedLogs }
export async function POST() {
  try {
    const user = await requireAuth()

    // Fetch tất cả camps của user
    const all = await prisma.campaign.findMany({
      where: { userId: user.userId },
      select: { id: true, name: true, adAccountId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    })

    // Group by name (chuẩn hoá để bắt được "camp 1" và "Camp 1" cùng group)
    const byName = new Map<string, typeof all>()
    for (const c of all) {
      const key = (c.name || "").trim().toLowerCase()
      if (!key) continue
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(c)
    }

    let removed = 0
    let reassignedPosts = 0
    let reassignedLogs = 0
    const removedDetails: Array<{ name: string; legacyId: string; canonicalId: string }> = []

    for (const camps of Array.from(byName.values())) {
      if (camps.length < 2) continue
      // Canonical = camp đã có adAccountId, ưu tiên createdAt mới nhất (sort desc → phần tử đầu)
      const withAcc = camps.filter((c) => c.adAccountId)
      const withoutAcc = camps.filter((c) => !c.adAccountId)
      if (withAcc.length === 0 || withoutAcc.length === 0) continue
      // Nếu có nhiều camp có adAccountId cùng name → KHÔNG đụng (đó là duplicate THẬT, user cần biết)
      // Chỉ cleanup khi pattern là: 1+ legacy + 1+ valid
      const canonical = withAcc[0]

      for (const legacy of withoutAcc) {
        // Reassign posts
        const r1 = await prisma.post.updateMany({
          where: { userId: user.userId, campaignId: legacy.id },
          data: { campaignId: canonical.id },
        })
        reassignedPosts += r1.count

        // Reassign camp_logs
        const r2 = await prisma.campLog.updateMany({
          where: { userId: user.userId, campaignId: legacy.id },
          data: { campaignId: canonical.id },
        })
        reassignedLogs += r2.count

        // Delete legacy
        await prisma.campaign.delete({ where: { id: legacy.id } })
        removed++
        removedDetails.push({ name: legacy.name, legacyId: legacy.id, canonicalId: canonical.id })
      }
    }

    console.log(`[cleanup-legacy] user=${user.userId} removed=${removed} posts=${reassignedPosts} logs=${reassignedLogs}`)

    return NextResponse.json({
      ok: true,
      removed,
      reassignedPosts,
      reassignedLogs,
      details: removedDetails.slice(0, 50), // cap show 50 lines
    })
  } catch (e: any) {
    if (e?.message === "UNAUTHORIZED") return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    console.error("[cleanup-legacy] error:", e?.message || e)
    return safeError(e, "campaigns/cleanup-legacy-dupes")
  }
}
