import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { prisma } from "@/lib/prisma"
import { createCampaignsForBatch, type CreateCampConfig } from "@/lib/fb-create-campaign"
import { AUTO_CAMP_RETRY_HOURS, AUTO_CAMP_MAX_RETRY } from "@/lib/constants-server"

// POST /api/posts/auto-camp-trigger
// Manual trigger auto-camp NGAY cho user hiện tại (không cần đợi cron đầu giờ).
// Trả về detailed log: mỗi post xử lý thế nào, FB API response, error chi tiết.
export async function POST(_req: NextRequest) {
  try {
    const user = await requireAuth()
    const u = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, name: true, autoCampaignEnabled: true, autoCampaignConfig: true },
    })
    if (!u) return NextResponse.json({ error: "User not found" }, { status: 404 })

    // BUG FIX (2026-05-27): Trước đây endpoint này KHÔNG check autoCampaignEnabled
    // → user tắt auto-camp ở UI nhưng nếu bấm "⚡ Trigger NGAY" vẫn chạy + update
    // autoCampaignLastRunAt → banner show "Lần chạy gần nhất X:XX" gây hiểu nhầm
    // là cron vẫn auto chạy. Reject hard nếu user đã tắt.
    if (!u.autoCampaignEnabled) {
      console.warn(`[AUTO-CAMP-TRIGGER] user=${u.id} (${u.name}) bấm trigger nhưng autoCampaignEnabled=false → REJECT`)
      return NextResponse.json({
        error: "Auto-camp đang TẮT. Vào header /fanpage-posts bấm nút '🤖 Auto-camp: TAT' để bật trước khi trigger.",
      }, { status: 400 })
    }

    let config: CreateCampConfig | null = null
    try {
      config = u.autoCampaignConfig ? JSON.parse(u.autoCampaignConfig) : null
    } catch {}

    if (!config) {
      return NextResponse.json({
        error: "Chưa có autoCampaignConfig — vào fanpage-posts → tạo manual 1 lần để save config",
      }, { status: 400 })
    }

    const retryAfter = new Date(Date.now() - AUTO_CAMP_RETRY_HOURS * 3600 * 1000)
    const candidates = await prisma.post.findMany({
      where: {
        userId: u.id,
        campaignId: { not: null },
        adCreated: false,
        deleted: false,
        // Filter ngay trong WHERE - tránh take:50 lấy toàn posts page chưa TKQC
        page: { accountId: { not: null } },
        OR: [
          { adError: null },
          {
            AND: [
              { adError: { not: null } },
              { adErrorAt: { lt: retryAfter } },
              { adErrorRetryCount: { lt: AUTO_CAMP_MAX_RETRY } },
            ],
          },
        ],
      },
      take: 50,
      orderBy: { createdAt: "asc" },
      include: {
        page: { select: { id: true, name: true, accountId: true } },
        campaign: { select: { id: true, name: true } },
      },
    })

    const log: any = {
      enabledUser: u.autoCampaignEnabled,
      hasConfig: !!config,
      totalCandidates: candidates.length,
      candidatesByAccount: {} as Record<string, { accountId: string; postCount: number; posts: string[] }>,
      skipped: [] as Array<{ postId: string; pageName: string; reason: string }>,
      batches: [] as Array<{ accountId: string; postIds: string[]; result: any }>,
      totalSuccess: 0,
      totalFailed: 0,
      totalSkipped: 0,
    }

    // Group theo page.accountId
    const byAcc = new Map<string, string[]>()
    for (const p of candidates) {
      if (!p.page?.accountId) {
        log.skipped.push({ postId: p.id, pageName: p.page?.name || "?", reason: "page.accountId = null" })
        log.totalSkipped++
        continue
      }
      const arr = byAcc.get(p.page.accountId) || []
      arr.push(p.id)
      byAcc.set(p.page.accountId, arr)
    }

    // Resolve account names for log
    const accIds = Array.from(byAcc.keys())
    const accs = await prisma.adAccount.findMany({
      where: { id: { in: accIds }, userId: u.id },
      select: { id: true, name: true, actId: true },
    })
    const accNameMap = new Map(accs.map((a) => [a.id, `${a.name} (${a.actId})`]))

    for (const [accountId, postIds] of Array.from(byAcc.entries())) {
      log.candidatesByAccount[accountId] = {
        accountId,
        accountName: accNameMap.get(accountId) || accountId,
        postCount: postIds.length,
        posts: postIds,
      } as any

      try {
        const r = await createCampaignsForBatch({
          userId: u.id,
          accountId,
          postIds,
          config,
        })
        log.batches.push({
          accountId,
          accountName: accNameMap.get(accountId) || accountId,
          postIds,
          result: {
            ok: r.ok,
            success: r.success,
            failed: r.failed,
            totalRequested: r.totalRequested,
            error: r.error,
            results: r.results,
          },
        })
        if (r.ok) {
          log.totalSuccess += r.success
          log.totalFailed += r.failed
        } else {
          log.totalFailed += postIds.length
        }
      } catch (e: any) {
        log.batches.push({
          accountId,
          accountName: accNameMap.get(accountId) || accountId,
          postIds,
          result: { ok: false, error: String(e?.message || e) },
        })
        log.totalFailed += postIds.length
      }
    }

    // Update banner stats
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          autoCampaignLastRunAt: new Date(),
          autoCampaignLastSuccess: log.totalSuccess,
          autoCampaignLastFailed: log.totalFailed,
        },
      })
    } catch {}

    return NextResponse.json({ ok: true, log })
  } catch (e: any) {
  return safeError(e, "posts/auto-camp-trigger")
}
}
