import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireAuth } from "@/lib/auth"
import { safeError } from "@/lib/api"
import { getFbToken } from "@/lib/token-store"

// Concurrency cap khi gọi FB Marketing API per account.
// Vượt quá có thể bị FB rate limit; 4 là an toàn cho hầu hết app.
const ACC_CONCURRENCY = 4

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    const userId = user.userId
    const tokenRecord = await getFbToken(userId)
    if (!tokenRecord) return NextResponse.json({ error: "Chua co token" }, { status: 400 })

    const token = tokenRecord.longToken
    const body = await req.json().catch(() => ({}))
    const { dateFrom, dateTo, accountId } = body

    const accounts = accountId
      ? await prisma.adAccount.findMany({ where: { userId, id: accountId } })
      : await prisma.adAccount.findMany({ where: { userId } })

    let totalUpdated = 0
    const errors: string[] = []
    const allCampaigns: any[] = []
    const syncedCampIds: string[] = []

    // Process từng batch ACC_CONCURRENCY tài khoản song song.
    const processOneAccount = async (acc: any) => {
      try {
        const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
        const fields = "id,name,status,daily_budget,lifetime_budget,created_time"
        const trEncoded = dateFrom && dateTo
          ? encodeURIComponent(JSON.stringify({ since: dateFrom, until: dateTo }))
          : null

        const fetchCamps = async () => {
          let nextUrl: string | null = `https://graph.facebook.com/v19.0/${actPath}/campaigns?fields=${fields}&limit=200&access_token=${token}`
          const out: any[] = []
          while (nextUrl) {
            const r: any = await fetch(nextUrl)
            const d: any = await r.json()
            if (d.error) { errors.push(`${acc.name}: ${d.error.message}`); break }
            for (const it of (d.data || [])) out.push(it)
            nextUrl = d.paging && d.paging.next ? d.paging.next : null
          }
          return out
        }

        // STEP 1: Account-level insights — 1 HTTP request lấy hết camp có spend.
        // Cực nhanh, ~5-10x so với per-camp batch.
        // Camp không có data trong range → không xuất hiện ở response → tự coi spend=0.
        const fetchAccountInsights = async () => {
          const map: Record<string, any> = {}
          const fields = "campaign_id,spend,clicks,inline_link_clicks,cpc,cost_per_inline_link_click"
          const dateParam = trEncoded ? `&time_range=${trEncoded}` : "&date_preset=last_30d"
          // DIAGNOSTIC: log dateFrom/dateTo + dateParam được gửi cho FB API
          console.log(`[sync-metrics] ${acc.name}: dateFrom=${dateFrom} dateTo=${dateTo} → dateParam="${dateParam}"`)
          let nextUrl: string | null = `https://graph.facebook.com/v19.0/${actPath}/insights?fields=${fields}&level=campaign&limit=1000${dateParam}&access_token=${token}`
          let pages = 0
          while (nextUrl && pages < 10) {
            const r: any = await fetch(nextUrl)
            const d: any = await r.json()
            if (d.error) {
              console.error(`[sync-metrics] account-level error:`, d.error.message)
              return null // signal fallback
            }
            for (const ins of (d.data || [])) {
              if (ins.campaign_id) map[ins.campaign_id] = ins
            }
            nextUrl = d.paging?.next || null
            pages++
          }
          return map
        }

        // STEP 2 (fallback): Per-camp Batch API nếu account-level không hoạt động.
        const fetchInsightsBatch = async (camps: any[]) => {
          const map: Record<string, any> = {}
          const BATCH_SIZE = 50
          const CONC = 5 // tăng từ 3 lên 5
          const batches: any[][] = []
          for (let i = 0; i < camps.length; i += BATCH_SIZE) {
            batches.push(camps.slice(i, i + BATCH_SIZE))
          }
          for (let i = 0; i < batches.length; i += CONC) {
            const group = batches.slice(i, i + CONC)
            await Promise.all(group.map(async (batch: any[]) => {
              const subRequests = batch.map((camp: any) => ({
                method: "GET",
                relative_url: `${camp.id}/insights?fields=spend,clicks,inline_link_clicks,cpc,cost_per_inline_link_click&${trEncoded ? `time_range=${trEncoded}` : "date_preset=last_30d"}`,
              }))
              try {
                const formData = new URLSearchParams()
                formData.set("batch", JSON.stringify(subRequests))
                formData.set("access_token", token)
                const r = await fetch("https://graph.facebook.com/v19.0/", { method: "POST", body: formData })
                const results: any = await r.json()
                if (!Array.isArray(results)) return
                for (let j = 0; j < results.length; j++) {
                  const camp = batch[j]
                  const sub = results[j]
                  if (!sub || sub.code !== 200) continue
                  try {
                    const body = JSON.parse(sub.body || "{}")
                    const row = body.data?.[0]
                    if (row) map[camp.id] = row
                  } catch {}
                }
              } catch {}
            }))
          }
          return map
        }

        // Parallel: fetchCamps + try account-level insights cùng lúc
        const [fbCamps, accountInsights] = await Promise.all([fetchCamps(), fetchAccountInsights()])
        if (fbCamps.length === 0) return

        let insights: Record<string, any>
        // Nếu account-level OK + có data → dùng (siêu nhanh)
        if (accountInsights && Object.keys(accountInsights).length > 0) {
          insights = accountInsights
          console.log(`[sync-metrics] ${acc.name}: account-level OK, ${Object.keys(insights).length}/${fbCamps.length} camps có data`)
        } else {
          // Fallback per-camp khi account-level lỗi/empty (1 số account FB không support)
          insights = await fetchInsightsBatch(fbCamps)
          console.log(`[sync-metrics] ${acc.name}: fallback per-camp Batch API, ${Object.keys(insights).length}/${fbCamps.length} camps`)
        }

        const fbCampIds = fbCamps.map((c: any) => c.id)
        const existingCamps = await prisma.campaign.findMany({ where: { userId, campId: { in: fbCampIds } } })
        const existingMap: Record<string, any> = {}
        for (const c of existingCamps) existingMap[c.campId] = c

        // Tách thành updates (existing) và inserts (mới) → batch DB write hiệu quả.
        const toUpdate: any[] = []
        const toCreate: any[] = []
        for (const fbCamp of fbCamps) {
          const ins = insights[fbCamp.id]
          const spend = ins ? Math.round(parseFloat(ins.spend || "0")) : 0
          // Dùng inline_link_clicks ("Lượt click vào liên kết") thay cho clicks (all clicks)
          // → khớp với số FB Ads UI hiển thị.
          const clicks = ins ? parseInt(ins.inline_link_clicks || ins.clicks || "0") : 0
          // CPC link click: ưu tiên cost_per_inline_link_click, fallback cpc
          const cpc = ins ? Math.round(parseFloat(ins.cost_per_inline_link_click || ins.cpc || "0")) : 0
          // DIAGNOSTIC: log raw FB response cho 1 camp đầu tiên có data — debug discrepancy
          if (ins && spend > 0 && !(globalThis as any).__loggedSyncSample) {
            ;(globalThis as any).__loggedSyncSample = true
            console.log(`[sync-metrics SAMPLE] camp=${fbCamp.name} (${fbCamp.id}) FB_raw:`, JSON.stringify(ins), `→ stored spend=${spend} clicks=${clicks} cpc=${cpc}`)
            // Reset cờ sau 60s để log lại
            setTimeout(() => { (globalThis as any).__loggedSyncSample = false }, 60_000)
          }
          const status = fbCamp.status === "ACTIVE" ? "on" : fbCamp.status === "PAUSED" ? "off" : "err"
          const budget = fbCamp.daily_budget ? parseInt(fbCamp.daily_budget) : 100000
          const existing = existingMap[fbCamp.id]
          // Parse fbCreatedTime (lan dau co trong fields = 2026-05-17). Chi luu khi DB chua co
          // vi created_time immutable - khong can override.
          const fbCreatedTime = fbCamp.created_time ? new Date(fbCamp.created_time) : null
          const needSetFbCreatedTime = fbCreatedTime && (!existing || !existing.fbCreatedTime)
          const row = {
            id: existing ? existing.id : `new_${fbCamp.id}`,
            userId,
            name: fbCamp.name,
            campId: fbCamp.id,
            status,
            budget,
            spend,
            clicks,
            cpc,
            commission: existing ? existing.commission : 0,
            clickSP: existing ? existing.clickSP : 0,
            createdAt: existing ? existing.createdAt : new Date(),
            updatedAt: new Date(),
          }
          allCampaigns.push(row)
          syncedCampIds.push(fbCamp.id)
          if (existing) {
            // Skip update nếu data không đổi → tiết kiệm DB write.
            // Khi can backfill fbCreatedTime (DB chua co) thi van update.
            const unchanged = existing.spend === spend
              && existing.clicks === clicks
              && existing.cpc === cpc
              && existing.status === status
              && existing.budget === budget
              && existing.name === fbCamp.name
              && existing.adAccountId === acc.id
              && !needSetFbCreatedTime
            if (!unchanged) {
              toUpdate.push({
                id: existing.id, status, spend, clicks, cpc, budget,
                name: fbCamp.name, adAccountId: acc.id,
                fbCreatedTime: needSetFbCreatedTime ? fbCreatedTime : undefined,
              })
            }
          } else {
            toCreate.push({
              userId, name: fbCamp.name, campId: fbCamp.id, status, budget, spend, clicks, cpc,
              adAccountId: acc.id,
              fbCreatedTime: fbCreatedTime || undefined,
            })
          }
        }
        totalUpdated += fbCamps.length

        // DB writes: chunk 15 update song song / batch (pool DATABASE_URL connection_limit=15).
        // Đã thử bulk UPDATE FROM VALUES nhưng có nguy cơ gán sai giá trị do type inference
        // → revert về parallel update cho chắc chắn đúng data.
        const DB_CONC = 15
        for (let k = 0; k < toUpdate.length; k += DB_CONC) {
          const slice = toUpdate.slice(k, k + DB_CONC)
          await Promise.all(slice.map((u) =>
            prisma.campaign.update({
              where: { id: u.id },
              data: {
                name: u.name, status: u.status, spend: u.spend, clicks: u.clicks, cpc: u.cpc,
                budget: u.budget, adAccountId: u.adAccountId, updatedAt: new Date(),
                ...(u.fbCreatedTime ? { fbCreatedTime: u.fbCreatedTime } : {}),
              },
            }).catch((e) => { console.error(`[sync-metrics] update ${u.id} failed:`, e?.message) })
          ))
        }
        if (toCreate.length > 0) {
          await prisma.campaign.createMany({ data: toCreate }).catch((e) => { console.error(`[sync-metrics] createMany failed:`, e?.message) })
        }

        // Dọn rác: camp trong DB có adAccountId = acc này NHƯNG không còn ở FB → đã xóa trên FB.
        // Detach posts + camplogs trước khi delete (FK constraint).
        const fbCampIdSet = new Set(fbCampIds)
        const orphanCamps = await prisma.campaign.findMany({
          where: { userId, adAccountId: acc.id, campId: { notIn: Array.from(fbCampIdSet) } },
          select: { id: true },
        })
        if (orphanCamps.length > 0) {
          const orphanIds = orphanCamps.map((c) => c.id)
          console.log(`[sync-metrics] ${acc.name}: xoa ${orphanIds.length} camp da bi delete tren FB`)
          await prisma.$transaction([
            prisma.post.updateMany({ where: { campaignId: { in: orphanIds } }, data: { campaignId: null } }),
            prisma.campLog.updateMany({ where: { campaignId: { in: orphanIds } }, data: { campaignId: null } }),
            prisma.campaign.deleteMany({ where: { id: { in: orphanIds } } }),
          ]).catch((e) => { console.error(`[sync-metrics] cleanup failed:`, e?.message) })
        }
      } catch (e: any) {
        errors.push(`${acc.name}: ${e.message}`)
      }
    }

    // Run accounts với concurrency cap (chia thành batch).
    // (xử lý ngay sau lambda)
    for (let i = 0; i < accounts.length; i += ACC_CONCURRENCY) {
      const batch = accounts.slice(i, i + ACC_CONCURRENCY)
      await Promise.all(batch.map(processOneAccount))
    }

    return NextResponse.json({
      ok: true,
      totalUpdated,
      accountsProcessed: accounts.length,
      syncedCampIds,
      campaigns: allCampaigns,
      errors,
      message: `Sync xong! Cap nhat ${totalUpdated} campaigns tu ${accounts.length} tai khoan.`,
    })
  } catch (e: any) {
  return safeError(e, "fb/sync-metrics")
}
}
