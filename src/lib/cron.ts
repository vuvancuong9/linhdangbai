import cron from "node-cron"
import { prisma } from "./prisma"

let isRunning = false
let isMappingRunning = false
let isCleanupRunning = false
let isBillingRunning = false
let isAutoCampRunning = false
let isAutoManageRunning = false
let isBalanceCheckRunning = false
let isBalanceRefreshRunning = false
let isShopeeAffRunning = false
let isPageAdLimitRunning = false

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
// CRON_SECRET KHÔNG có fallback hardcode — bắt buộc set trong env, nếu không cron không chạy.
const CRON_SECRET = (): string => {
  const s = process.env.CRON_SECRET
  if (!s || s.length < 16) throw new Error("CRON_SECRET env phải ≥16 ký tự — set trên Railway")
  return s
}

export function startCronJobs() {
  // Sync posts FB mỗi 10 phút.
  // FLAG isRunning được reset trong FINALLY để tránh stuck nếu crash.
  // Trước là 5 phút, giảm xuống 10 phút để tiết kiệm I/O Supabase (Quy 2026-05-08).
  cron.schedule(
    "*/10 * * * *",
    async () => {
      if (isRunning) return
      isRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON] ${now} - Dang sync posts tu FB...`)
      try {
        const res = await fetch(`${APP_URL()}/api/fb/sync-posts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-cron-secret": CRON_SECRET() },
        })
        const data = await res.json()
        if (data.ok) {
          const totalNew = data.results?.reduce((s: number, r: any) => s + (r.totalNew || 0), 0) || 0
          console.log(`[CRON] OK: ${data.syncedUsers} users, ${totalNew} bai moi`)
        } else {
          console.log(`[CRON] Loi:`, JSON.stringify(data))
        }
      } catch (e: any) {
        console.log(`[CRON] Exception:`, e?.message || e)
      } finally {
        isRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Sync Mapping Google Sheet + AffiliateLink table mỗi 15 phút, OFFSET 3 phút sau sync-posts.
  // Gọi trực tiếp function thay vì self-fetch HTTP → ổn định, không phụ thuộc APP_URL/CRON_SECRET.
  // Chạy SHEET trước, AFFLINK sau → AffLink override đúng (key match dài hơn thường thắng).
  // Lý do offset: tránh race với sync-posts (chạy ở phút 0,10,20,30...) — mapping chạy ở phút 3,18,33,48 sau khi posts đã insert xong.
  // Trước là 5 phút, giảm xuống 15 phút để tiết kiệm I/O Supabase (Quy 2026-05-08).
  cron.schedule(
    "3,18,33,48 * * * *",
    async () => {
      if (isMappingRunning) return
      isMappingRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-MAPPING] ${now} - Dang sync mapping (Sheet)...`)
      try {
        const { syncAllUsersLatestMapping } = await import("./mapping-sync")
        const sheetRes = await syncAllUsersLatestMapping(3)
        const sheetOk = sheetRes.filter((r: any) => r.ok).length
        const sheetUpd = sheetRes.reduce((s: number, r: any) => s + (r.updatedPosts || 0), 0)
        console.log(`[CRON-MAPPING] Sheet: ${sheetOk}/${sheetRes.length} users, ${sheetUpd} posts updated`)
      } catch (e: any) {
        console.log(`[CRON-MAPPING] Exception:`, e?.message || e)
      } finally {
        isMappingRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Cleanup DB: chạy mỗi Chủ nhật 03:00 sáng (giờ VN). Xoá data cũ
  // (LoginSession, CampLog, OrderCommission cancelled, AffiliateCommissionDaily, Post soft-deleted).
  // Lý do giờ này: traffic thấp nhất → Postgres VACUUM nhanh, không ảnh hưởng user.
  cron.schedule(
    "0 3 * * 0",
    async () => {
      if (isCleanupRunning) return
      isCleanupRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-CLEANUP] ${now} - Bat dau don dep DB...`)
      try {
        const { cleanupOldData } = await import("./db-cleanup")
        const r = await cleanupOldData()
        console.log(
          `[CRON-CLEANUP] OK (${r.durationMs}ms): xoa ${r.totalDeleted} rows ` +
          `(login_revoked=${r.loginSessionRevoked}, login_stale=${r.loginSessionStale}, ` +
          `camp_log=${r.campLogOld}, order_cancelled=${r.orderCommissionCancelled}, ` +
          `aff_click=${r.affiliateClicksOld}, post_softdel=${r.postsSoftDeleted})`
        )
      } catch (e: any) {
        console.error(`[CRON-CLEANUP] Exception:`, e?.message || e)
      } finally {
        isCleanupRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Page Ad Limit check mỗi 30 phút — fetch ads_volume per page qua
  // /act_{accId}/ads_volume?page_id=X. Lưu pageAdsTotal + pageAdsCurrentAccount
  // + pageAdLimit + checkedAt vào FanPage. UI /gioi-han-quang-cao hiển thị.
  // 14 page × 1 call = 14 calls/30p = 28/h → safe vs FB rate limit 200/h.
  cron.schedule(
    "*/30 * * * *",
    async () => {
      if (isPageAdLimitRunning) return
      isPageAdLimitRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-PAGEADLIMIT] ${now} - Bat dau check page ad limit...`)
      try {
        const { runPageAdLimitForAllUsers } = await import("./page-ad-limit")
        const r = await runPageAdLimitForAllUsers()
        console.log(`[CRON-PAGEADLIMIT] OK: ${r.users} users, ${r.pagesChecked} pages, ok=${r.ok}, failed=${r.failed}`)
      } catch (e: any) {
        console.error("[CRON-PAGEADLIMIT] Exception:", e?.message || e)
      } finally {
        isPageAdLimitRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Billing snapshot daily 07:00 VN — fetch daily_spend_limit, balance, funding_source
  // cho mỗi TKQC + sync invoices. Compare với hôm qua, flag nếu limit giảm > 30%.
  cron.schedule(
    "0 7 * * *",
    async () => {
      if (isBillingRunning) return
      isBillingRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-BILLING] ${now} - Bat dau snapshot billing...`)
      try {
        const { snapshotUserBilling, syncUserInvoices } = await import("./fb-billing")
        const { prisma } = await import("./prisma")
        const usersWithToken = await prisma.fbToken.findMany({ select: { userId: true } })
        // PERFORMANCE: chạy parallel concurrency 3 thay vì tuần tự
        // (5 users × ~3 phút mỗi user = 15 phút → 3 parallel ~5 phút)
        const CONCURRENCY = 3
        const runUser = async (u: { userId: string }) => {
          try {
            const snapRes = await snapshotUserBilling(u.userId)
            const ok = snapRes.filter((r) => r.ok).length
            const reduced = snapRes.filter((r) => r.limitReduced).length
            console.log(`[CRON-BILLING] User ${u.userId}: snapshot ${ok}/${snapRes.length} (${reduced} limit giam)`)
            const invRes = await syncUserInvoices(u.userId)
            const invOk = invRes.filter((r) => r.ok).length
            const invTotal = invRes.reduce((s, r) => s + r.fetched, 0)
            console.log(`[CRON-BILLING] User ${u.userId}: invoices ${invOk}/${invRes.length} (${invTotal} fetched)`)
            // Sau snapshot xong → check rule alert Telegram (balance/threshold ≥90% AND threshold >2tr)
            try {
              const { checkAndAlertBillingForUser } = await import("./billing-alert")
              const alertRes = await checkAndAlertBillingForUser(u.userId)
              if (alertRes.alerted > 0) {
                console.log(`[CRON-BILLING] User ${u.userId}: Telegram alert ${alertRes.alerted}/${alertRes.checked} TKQC`)
              }
              if (alertRes.errors.length > 0) {
                console.warn(`[CRON-BILLING] User ${u.userId}: Telegram errors:`, alertRes.errors)
              }
            } catch (e: any) {
              console.warn(`[CRON-BILLING] User ${u.userId}: alert fail -`, e?.message)
            }
          } catch (e: any) {
            console.error(`[CRON-BILLING] User ${u.userId} FAIL:`, e?.message?.slice(0, 200))
          }
        }
        for (let i = 0; i < usersWithToken.length; i += CONCURRENCY) {
          const batch = usersWithToken.slice(i, i + CONCURRENCY)
          await Promise.all(batch.map(runUser))
        }
      } catch (e: any) {
        console.error("[CRON-BILLING] Exception:", e?.message || e)
      } finally {
        isBillingRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Shopee Affiliate sync daily 07:30 VN - fetch conversions tu Open API
  // cho moi user co ShopeeAffiliateToken. Upsert OrderCommission + AffiliateCommissionDaily.
  cron.schedule(
    "30 7 * * *",
    async () => {
      if (isShopeeAffRunning) return
      isShopeeAffRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-SHOPEE-AFF] ${now} - Bat dau sync Shopee Affiliate API...`)
      try {
        const { syncShopeeAffForAllUsers } = await import("./shopee-aff-sync")
        const r = await syncShopeeAffForAllUsers(7) // 7 ngay gan day
        console.log(
          `[CRON-SHOPEE-AFF] OK: ${r.totalUsers} users, ${r.totalTokens} tokens, ` +
          `${r.totalConversions} conversions fetched, ${r.totalOrdersUpserted} orders upserted`
        )
        for (const u of r.results) {
          for (const t of u.tokens) {
            if (!t.ok) console.warn(`[CRON-SHOPEE-AFF] ${u.userName} - ${t.tokenName}: ${t.error}`)
          }
        }
      } catch (e: any) {
        console.error("[CRON-SHOPEE-AFF] Exception:", e?.message || e)
      } finally {
        isShopeeAffRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Auto-create campaign moi dau gio (24/7).
  // - User bat autoCampaignEnabled = true tu UI
  // - Tim posts campaignId != null AND adCreated = false AND adError = null AND deleted = false
  // - Group theo page.accountId, goi createCampaignsForBatch tung group
  // - Posts adError -> SKIP (option 2b - khong retry tu dong, user phai click Retry thu cong)
  cron.schedule(
    "0 * * * *",
    async () => {
      if (isAutoCampRunning) return
      isAutoCampRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-AUTOCAMP] ${now} - Bat dau auto-create campaign...`)
      try {
        const { runAutoCampaignForAllUsers } = await import("./auto-campaign-runner")
        const r = await runAutoCampaignForAllUsers()
        console.log(
          `[CRON-AUTOCAMP] OK: ${r.processedUsers} users, ` +
          `success=${r.totalSuccess}, failed=${r.totalFailed}, skipped=${r.totalSkipped}`
        )
        for (const pu of r.perUser) {
          if (pu.error) console.warn(`[CRON-AUTOCAMP] User ${pu.userName}: ${pu.error}`)
          else if (pu.success || pu.failed || pu.skipped) {
            console.log(`[CRON-AUTOCAMP] User ${pu.userName}: ok=${pu.success}, fail=${pu.failed}, skip=${pu.skipped}`)
          }
        }
      } catch (e: any) {
        console.error("[CRON-AUTOCAMP] Exception:", e?.message || e)
      } finally {
        isAutoCampRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  // Auto-manage camp: 13h chieu VN daily.
  // - Tat camp lo 3 ngay lien tiep va tong > AUTO_MANAGE_LOSS_THRESHOLD
  // - Tang budget x1.30 neu lai 3 ngay lien tiep va tong > AUTO_MANAGE_PROFIT_THRESHOLD
  // Chay 13h vi data D0=hom qua va commission Shopee da co du them buffer time.
  cron.schedule(
    "0 13 * * *",
    async () => {
      if (isAutoManageRunning) return
      isAutoManageRunning = true
      const now = new Date().toLocaleString("vi-VN")
      console.log(`[CRON-AUTOMANAGE] ${now} - Bat dau auto-manage camp...`)
      try {
        const { runAutoManageForAllUsers } = await import("./auto-manage-runner")
        const r = await runAutoManageForAllUsers()
        console.log(`[CRON-AUTOMANAGE] OK: ${r.processedUsers} users, tat=${r.totalOff}, tang_budget=${r.totalBudgetUp}`)
        for (const pu of r.perUser) {
          if (pu.error) console.warn(`[CRON-AUTOMANAGE] User ${pu.userName}: ${pu.error}`)
          else if (pu.off || pu.budgetUp) {
            console.log(`[CRON-AUTOMANAGE] User ${pu.userName}: tat=${pu.off}, tang_budget=${pu.budgetUp}, skip=${pu.skipped}`)
          }
        }
      } catch (e: any) {
        console.error("[CRON-AUTOMANAGE] Exception:", e?.message || e)
      } finally {
        isAutoManageRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  //Auto-refresh snapshot + alert 10p/lan cho user co telegramChatId.
  // Phut 2,12,22,32,42,52 - 3p truoc cron sync-posts (5,15,25,...) de tranh chong cheo.
  // Snapshot full -> save DB (UI /billing fresh) -> sau do alert theo data DB.
  cron.schedule(
    "2,12,22,32,42,52 * * * *",
    async () => {
      if (isBalanceRefreshRunning) return
      isBalanceRefreshRunning = true
      try {
        const { snapshotUserBilling } = await import("./fb-billing")
        const { checkAndAlertBillingForUser } = await import("./billing-alert")
        const users = await prisma.user.findMany({
          where: { telegramChatId: { not: null }, status: "ACTIVE" },
          select: { id: true, name: true },
        })
        const CONC = 3
        let totalSnapped = 0
        let totalAlerted = 0
        for (let i = 0; i < users.length; i += CONC) {
          const batch = users.slice(i, i + CONC)
          await Promise.all(batch.map(async (u) => {
            try {
              // 1. Snapshot full (update DB) - UI /billing duoc fresh
              const r = await snapshotUserBilling(u.id)
              totalSnapped += r.filter((x) => x.ok).length
              // 2. Alert dua tren snapshot moi nhat tu DB (re-alert sau reset balance)
              const alertR = await checkAndAlertBillingForUser(u.id)
              totalAlerted += alertR.alerted
              if (alertR.errors.length > 0) {
                console.warn(`[CRON-BALANCE-10P] User ${u.name} alert errors:`, alertR.errors.slice(0, 3))
              }
            } catch (e: any) {
              console.warn(`[CRON-BALANCE-10P] User ${u.name} fail:`, e?.message?.slice(0, 100))
            }
          }))
        }
        if (totalSnapped > 0 || totalAlerted > 0) {
          console.log(`[CRON-BALANCE-10P] OK: ${users.length} users, snapped=${totalSnapped}, alerted=${totalAlerted}`)
        }
      } catch (e: any) {
        console.error("[CRON-BALANCE-10P] Exception:", e?.message || e)
      } finally {
        isBalanceRefreshRunning = false
      }
    },
    { timezone: "Asia/Ho_Chi_Minh" }
  )

  console.log("[CRON] Cron jobs da khoi dong: FB sync moi 10p + Mapping moi 15p + Cleanup DB CN 3h + PageAdLimit moi 30p + Billing 7h + Balance10p (snapshot+alert) + AutoCamp moi dau gio + AutoManage 13h chieu (VN)")

  // Initial sync after startup BỎ — mỗi lần redeploy đè data, tốn I/O Supabase. Cron tới giờ tự chạy.
}