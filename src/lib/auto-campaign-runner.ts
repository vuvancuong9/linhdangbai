import { prisma } from "./prisma"
import { createCampaignsForBatch, type CreateCampConfig } from "./fb-create-campaign"
import { AUTO_CAMP_RETRY_HOURS, AUTO_CAMP_MAX_RETRY } from "./constants-server"

// Cron auto-camp runner: chay moi dau gio (24/7).
// - Query users co autoCampaignEnabled = true
// - Voi moi user: tim posts can tao camp (campaignId != null, adCreated = false, deleted = false)
//   AND (adError IS NULL OR (adErrorAt < now - 6h AND adErrorRetryCount < 3))
// - Group theo page.accountId (skip posts page chua chi dinh TKQC)
// - Goi createCampaignsForBatch theo tung group acc
// - Update User.autoCampaignLast* de UI banner hien stats lan chay gan nhat
//
// Auto-retry: post adError duoc retry sau 6h (max 3 lan). Vuot 3 -> user manual.

const MAX_POSTS_PER_USER_PER_RUN = 50  // safety cap moi user/lan chay

export async function runAutoCampaignForAllUsers(): Promise<{
  processedUsers: number
  totalSuccess: number
  totalFailed: number
  totalSkipped: number
  perUser: Array<{ userId: string; userName: string; success: number; failed: number; skipped: number; error?: string }>
}> {
  const enabledUsers = await prisma.user.findMany({
    where: { autoCampaignEnabled: true, status: "ACTIVE" },
    select: { id: true, name: true, autoCampaignConfig: true },
  })

  const perUser: Array<{ userId: string; userName: string; success: number; failed: number; skipped: number; error?: string }> = []
  let totalSuccess = 0
  let totalFailed = 0
  let totalSkipped = 0

  for (const u of enabledUsers) {
    let userSuccess = 0
    let userFailed = 0
    let userSkipped = 0
    let userErr: string | undefined

    try {
      // Parse config; neu chua co thi skip user (chua manual tao bao gio)
      let config: CreateCampConfig
      try {
        config = u.autoCampaignConfig ? JSON.parse(u.autoCampaignConfig) : null
      } catch {
        config = null as any
      }
      if (!config) {
        userErr = "Chua co autoCampaignConfig - manual tao 1 lan de save config"
      } else {
        // Tim posts can tao camp.
        // - Posts moi (adError=null) -> tao luon
        // - Posts adError nhung adErrorAt > 6h truoc + retryCount < 3 -> auto-retry
        // QUAN TRONG: filter page.accountId != null trong WHERE de take:50 khong "kep"
        // vao posts cua page chua co TKQC (oldest first se loai het ready posts).
        const retryAfter = new Date(Date.now() - AUTO_CAMP_RETRY_HOURS * 3600 * 1000)
        const candidates = await prisma.post.findMany({
          where: {
            userId: u.id,
            campaignId: { not: null },
            adCreated: false,
            deleted: false,
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
          take: MAX_POSTS_PER_USER_PER_RUN,
          orderBy: { createdAt: "asc" },
          include: { page: { select: { id: true, accountId: true } } },
        })

        // Group theo page.accountId
        const byAcc = new Map<string, string[]>()  // accountId -> postIds
        for (const p of candidates) {
          if (!p.page?.accountId) {
            userSkipped++
            continue
          }
          const arr = byAcc.get(p.page.accountId) || []
          arr.push(p.id)
          byAcc.set(p.page.accountId, arr)
        }

        // Chay tung group acc tuan tu (khong parallel cross-acc de tranh rate limit FB token).
        for (const [accountId, postIds] of Array.from(byAcc.entries())) {
          try {
            const r = await createCampaignsForBatch({
              userId: u.id,
              accountId,
              postIds,
              config,
            })
            if (r.ok) {
              userSuccess += r.success
              userFailed += r.failed
            } else {
              // batch error (vd token thieu, acc khong ton tai...) -> dem la failed
              userFailed += postIds.length
              console.warn(`[AUTO-CAMP] User ${u.id} acc ${accountId}: batch error - ${r.error}`)
            }
          } catch (e: any) {
            userFailed += postIds.length
            console.error(`[AUTO-CAMP] User ${u.id} acc ${accountId}: exception`, e?.message)
          }
        }
      }
    } catch (e: any) {
      userErr = e?.message || String(e)
    }

    // Update stats user (du chay loi van update de UI biet co lan chay)
    try {
      await prisma.user.update({
        where: { id: u.id },
        data: {
          autoCampaignLastRunAt: new Date(),
          autoCampaignLastSuccess: userSuccess,
          autoCampaignLastFailed: userFailed,
        },
      })
    } catch {}

    perUser.push({
      userId: u.id,
      userName: u.name,
      success: userSuccess,
      failed: userFailed,
      skipped: userSkipped,
      error: userErr,
    })
    totalSuccess += userSuccess
    totalFailed += userFailed
    totalSkipped += userSkipped
  }

  return {
    processedUsers: enabledUsers.length,
    totalSuccess,
    totalFailed,
    totalSkipped,
    perUser,
  }
}
