import { prisma } from "./prisma"
import { getFbToken } from "./token-store"
import {
  AUTO_MANAGE_DAYS_WINDOW,
  AUTO_MANAGE_BUDGET_MULTIPLIER,
  AUTO_MANAGE_BUDGET_MAX,
  AUTO_OFF_NO_SPEND_TOTAL,
  AUTO_OFF_NO_SPEND_DAILY,
  AUTO_OFF_NO_SPEND_DAYS,
} from "./constants-server"

// Auto-manage runner: cron 13h chieu VN daily.
//
// Rule per-FANPAGE (config trong FanPage.autoBudgetUpThreshold + autoOffThreshold):
//   - Camp duoc gan voi 1 fanpage (qua Post.pageId, lay Post dau tien cua camp).
//   - Neu fanpage CHUA config (ca 2 null) -> SKIP camp do.
//
//   Rule 1 (TAT): camp ON, ads/hh 3 ngay (D0..D2) DEU > autoOffThreshold%
//                 AND tong spend D0..D2 > 100k -> PAUSED.
//   Rule 2 (TANG BUDGET): camp ON, ads/hh 3 ngay DEU < autoBudgetUpThreshold%
//                          AND tong spend > 100k -> budget x 1.30.
//   Rule 3 (TAT camp KHONG CAN TIEN): camp ON, tong spend 5 ngay (D0..D4) < 50k
//                                      AND moi ngay < 15k AND camp tao truoc D4 -> PAUSED.
//                                      Chay TRUOC rule 1/2 (khong can fanpage config).
//
//   ads/hh = spend / commission * 100 (%); khi commission=0 -> ads/hh = +Infinity (loi cao).
//
// Khong retry trong cung run, khong dung lai. Log chi tiet vao console.

const AUTO_MANAGE_MIN_SPEND = 100_000 // Tong spend D0..D2 toi thieu de apply rule

// Default thresholds cho camp KHONG co fanpage (vd: tao truc tiep tu FB Ads Manager,
// hoac Post bi xoa). Apply nhu mot fanpage da config voi 65/110.
// User Quy chu chu y: "camp khong co fanpage thi auto tang budget khi ads/hh 3 ngay
// < 65% va tat khi > 110%".
const DEFAULT_BUDGET_UP_THRESHOLD = 65
const DEFAULT_OFF_THRESHOLD = 110

const FB_VER = "v19.0"

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10)
}

type ActionType = "off" | "off_no_spend" | "budget_up" | "skip"
type CampAction = {
  campaignDbId: string
  campName: string
  campFbId: string
  pageName?: string
  action: ActionType
  reason: string
  daily: Array<{ spend: number; commission: number; adsHh: number | null }>
  totalSpend: number
  oldBudget?: number
  newBudget?: number
  fbError?: string
}

export async function runAutoManageForAllUsers(): Promise<{
  processedUsers: number
  totalOff: number
  totalBudgetUp: number
  perUser: Array<{ userId: string; userName: string; off: number; budgetUp: number; skipped: number; error?: string; actions?: CampAction[] }>
}> {
  const enabledUsers = await prisma.user.findMany({
    where: { autoManageEnabled: true, status: "ACTIVE" },
    select: { id: true, name: true },
  })

  const perUser: Array<{ userId: string; userName: string; off: number; budgetUp: number; skipped: number; error?: string; actions?: CampAction[] }> = []
  let totalOff = 0
  let totalBudgetUp = 0

  // Tinh range D0..D(N-1). D0 = hom QUA.
  // Fetch max(rule 1/2 window, rule 3 window) ngay -> du data cho ca 2 logic.
  const DAYS_TO_FETCH = Math.max(AUTO_MANAGE_DAYS_WINDOW, AUTO_OFF_NO_SPEND_DAYS)
  const baseDate = new Date()
  baseDate.setHours(0, 0, 0, 0)
  baseDate.setDate(baseDate.getDate() - 1)
  const dates: string[] = []
  for (let i = 0; i < DAYS_TO_FETCH; i++) {
    const d = new Date(baseDate)
    d.setDate(d.getDate() - i)
    dates.push(dateKey(d))
  }
  const since = dates[dates.length - 1]
  const until = dates[0]
  // Cutoff: camp phai tao truoc ngay D(N-1) moi xet rule 3 (tranh false-positive cho camp moi tao)
  const noSpendCutoffDate = new Date(dates[AUTO_OFF_NO_SPEND_DAYS - 1] + "T00:00:00Z")

  for (const u of enabledUsers) {
    let userErr: string | undefined
    const actions: CampAction[] = []
    let off = 0, budgetUp = 0, skipped = 0

    try {
      const tokenRec = await getFbToken(u.id)
      if (!tokenRec) {
        userErr = "Chua co FB token"
        await updateUserStats(u.id, 0, 0, userErr)
        perUser.push({ userId: u.id, userName: u.name, off: 0, budgetUp: 0, skipped: 0, error: userErr })
        continue
      }
      const token = tokenRec.longToken

      const accounts = await prisma.adAccount.findMany({
        where: { userId: u.id, status: "ON" },
        select: { id: true, actId: true, name: true },
      })

      // Fetch spend daily per camp tu FB Insights (parallel cac accounts)
      const spendByCamp = new Map<string, Map<string, number>>()
      await Promise.all(accounts.map(async (acc) => {
        const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
        const fields = "campaign_id,spend,date_start"
        const trEncoded = encodeURIComponent(JSON.stringify({ since, until }))
        let nextUrl: string | null = `https://graph.facebook.com/${FB_VER}/${actPath}/insights?fields=${fields}&level=campaign&time_increment=1&time_range=${trEncoded}&limit=1000&access_token=${token}`
        let pages = 0
        try {
          while (nextUrl && pages < 10) {
            const r: any = await fetch(nextUrl)
            const d: any = await r.json()
            if (d.error) {
              console.warn(`[AUTO-MANAGE] User ${u.name} acc ${acc.name}: FB insights error - ${d.error.message}`)
              break
            }
            for (const ins of (d.data || [])) {
              if (!ins.campaign_id || !ins.date_start) continue
              let m = spendByCamp.get(ins.campaign_id)
              if (!m) { m = new Map(); spendByCamp.set(ins.campaign_id, m) }
              m.set(ins.date_start, Math.round(parseFloat(ins.spend || "0")))
            }
            nextUrl = d.paging?.next || null
            pages++
          }
        } catch (e: any) {
          console.warn(`[AUTO-MANAGE] User ${u.name} acc ${acc.name}: fetch exception - ${e?.message}`)
        }
      }))

      // Camps ON cua user (chi camp ON moi check rule)
      const camps = await prisma.campaign.findMany({
        where: { userId: u.id, status: "on" },
        select: { id: true, name: true, campId: true, budget: true, createdAt: true, fbCreatedTime: true },
      })
      if (camps.length === 0) {
        await updateUserStats(u.id, 0, 0)
        perUser.push({ userId: u.id, userName: u.name, off: 0, budgetUp: 0, skipped: 0 })
        continue
      }

      // Map camp -> fanpage (qua Post dau tien cua camp).
      // Sau do lookup threshold cua fanpage. Neu fanpage chua config -> SKIP.
      const campIds = camps.map(c => c.id)
      const posts = await prisma.post.findMany({
        where: { userId: u.id, campaignId: { in: campIds }, deleted: false, pageId: { not: null } },
        select: {
          campaignId: true,
          page: {
            select: { id: true, name: true, autoBudgetUpThreshold: true, autoOffThreshold: true },
          },
        },
        orderBy: { createdAt: "asc" },
      })
      type PageConfig = { id: string; name: string; budgetUp: number | null; off: number | null }
      const pageByCampId = new Map<string, PageConfig>()
      for (const p of posts) {
        if (p.campaignId && p.page && !pageByCampId.has(p.campaignId)) {
          pageByCampId.set(p.campaignId, {
            id: p.page.id,
            name: p.page.name,
            budgetUp: p.page.autoBudgetUpThreshold,
            off: p.page.autoOffThreshold,
          })
        }
      }

      // Commission daily per camp tu OrderCommission
      const sinceDate = new Date(since + "T00:00:00Z")
      const untilExclusive = new Date(until + "T00:00:00Z")
      untilExclusive.setUTCDate(untilExclusive.getUTCDate() + 1)
      const subIds = Array.from(new Set(camps.map(c => c.name).filter(Boolean)))
      const commGrouped = subIds.length > 0 ? await prisma.orderCommission.groupBy({
        by: ["subId2", "clickDate"],
        where: {
          userId: u.id,
          subId2: { in: subIds },
          clickDate: { gte: sinceDate, lt: untilExclusive },
          status: { not: "cancelled" },
        },
        _sum: { commission: true },
      }) : []
      const commByCamp = new Map<string, Map<string, number>>()
      for (const g of commGrouped) {
        if (!g.subId2 || !g.clickDate) continue
        const dk = dateKey(g.clickDate as Date)
        let m = commByCamp.get(g.subId2)
        if (!m) { m = new Map(); commByCamp.set(g.subId2, m) }
        m.set(dk, g._sum.commission ?? 0)
      }

      // Voi moi camp -> compute D0..D4 spend -> apply rules
      for (const c of camps) {
        if (!c.campId) { skipped++; continue }

        // Compute daily TRUOC khi check fanpage config -> rule 3 chay duoc cho ca camp
        // chua co fanpage hoac fanpage chua config nguong ads/hh.
        const spendMap = spendByCamp.get(c.campId)
        const commMap = commByCamp.get(c.name)
        const daily = dates.map(d => {
          const spend = spendMap?.get(d) ?? 0
          const commission = commMap?.get(d) ?? 0
          let adsHh: number | null = null
          if (commission > 0) adsHh = Math.round((spend / commission) * 1000) / 10
          else if (spend > 0) adsHh = Number.POSITIVE_INFINITY
          else adsHh = null
          return { spend, commission, adsHh }
        })
        const daily3 = daily.slice(0, AUTO_MANAGE_DAYS_WINDOW)
        const totalSpend3 = daily3.reduce((s, d) => s + d.spend, 0)

        // Lookup pageName + fanpage thresholds (cho action log + rule 1/2)
        const pageCfg = pageByCampId.get(c.id)
        const pageName: string = pageCfg ? pageCfg.name : "(không xác định)"

        // Rule 3 (TAT camp KHONG CAN TIEN) - chay TRUOC rule 1/2, KHONG can fanpage config.
        // Dieu kien: tong spend D0..D4 < 50k VA moi ngay < 15k VA camp tao truoc D4.
        // Uu tien fbCreatedTime (ngay FB tao that), fallback DB createdAt.
        const campCreatedAt = c.fbCreatedTime || c.createdAt
        if (campCreatedAt < noSpendCutoffDate) {
          const daily5 = daily.slice(0, AUTO_OFF_NO_SPEND_DAYS)
          const totalSpend5 = daily5.reduce((s, d) => s + d.spend, 0)
          const allUnderDaily = daily5.every(d => d.spend < AUTO_OFF_NO_SPEND_DAILY)
          if (totalSpend5 < AUTO_OFF_NO_SPEND_TOTAL && allUnderDaily) {
            const fbErr = await fbToggleStatus(c.campId, "PAUSED", token)
            const spendSummary = daily5.map(d => Math.round(d.spend / 1000) + "k").join("/")
            if (!fbErr) {
              try {
                await prisma.campaign.update({ where: { id: c.id }, data: { status: "off", updatedAt: new Date() } })
              } catch {}
              off++
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "off_no_spend", reason: `Spend 5 ngày ${spendSummary} < 15k/ngày + tổng ${Math.round(totalSpend5/1000)}k < 50k`,
                daily: daily5, totalSpend: totalSpend5,
              })
            } else {
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "skip", reason: "FB toggle-status failed (rule 3)", daily: daily5, totalSpend: totalSpend5, fbError: fbErr,
              })
              skipped++
            }
            continue
          }
        }

        // Rule 1/2: can fanpage config (default 65/110 cho camp khong co fanpage)
        let budgetUpThreshold: number | null
        let offThreshold: number | null
        if (!pageCfg) {
          budgetUpThreshold = DEFAULT_BUDGET_UP_THRESHOLD
          offThreshold = DEFAULT_OFF_THRESHOLD
        } else {
          budgetUpThreshold = pageCfg.budgetUp
          offThreshold = pageCfg.off
          // Fanpage co trong DB nhung user chua config ca 2 nguong -> SKIP rule 1/2
          if (budgetUpThreshold == null && offThreshold == null) {
            skipped++
            continue
          }
        }

        // Bo qua neu chua du spend toi thieu 100k cho rule 1/2 (tinh tren 3 ngay)
        if (totalSpend3 <= AUTO_MANAGE_MIN_SPEND) {
          skipped++
          continue
        }

        // Rule 1 (TAT): ads/hh 3 ngay DEU > offThreshold (loi nang)
        if (offThreshold != null) {
          const allOverOff = daily3.every(d => d.adsHh != null && d.adsHh > offThreshold!)
          if (allOverOff) {
            const fbErr = await fbToggleStatus(c.campId, "PAUSED", token)
            const adsHhSummary = daily3.map(d => d.adsHh === Number.POSITIVE_INFINITY ? "∞" : (d.adsHh ?? "—")).join("/")
            if (!fbErr) {
              try {
                await prisma.campaign.update({ where: { id: c.id }, data: { status: "off", updatedAt: new Date() } })
              } catch {}
              off++
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "off", reason: `ads/hh ${adsHhSummary}% > ${offThreshold}% (3 ngày liên tiếp)`,
                daily: daily3, totalSpend: totalSpend3,
              })
            } else {
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "skip", reason: "FB toggle-status failed", daily: daily3, totalSpend: totalSpend3, fbError: fbErr,
              })
              skipped++
            }
            continue
          }
        }

        // Rule 2 (TANG BUDGET): ads/hh 3 ngay DEU < budgetUpThreshold (lai tot)
        // Cap newBudget tai AUTO_MANAGE_BUDGET_MAX (500k) — tranh budget vot qua kha nang
        // chi tieu thuc te + risk FB quet.
        if (budgetUpThreshold != null) {
          const allUnderUp = daily3.every(d => d.adsHh != null && d.adsHh !== Number.POSITIVE_INFINITY && d.adsHh < budgetUpThreshold!)
          if (allUnderUp) {
            // Skip neu da o muc max
            if (c.budget >= AUTO_MANAGE_BUDGET_MAX) {
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "skip", reason: `budget da o max ${AUTO_MANAGE_BUDGET_MAX.toLocaleString("vi-VN")}đ`,
                daily: daily3, totalSpend: totalSpend3,
              })
              skipped++
              continue
            }
            const rawNew = Math.round(c.budget * AUTO_MANAGE_BUDGET_MULTIPLIER)
            const newBudget = Math.min(rawNew, AUTO_MANAGE_BUDGET_MAX)
            const cappedNote = newBudget < rawNew ? ` (cap ${AUTO_MANAGE_BUDGET_MAX.toLocaleString("vi-VN")}đ)` : ""
            const fbErr = await fbUpdateBudget(c.campId, newBudget, token)
            const adsHhSummary = daily3.map(d => d.adsHh ?? "—").join("/")
            if (!fbErr) {
              try {
                await prisma.campaign.update({ where: { id: c.id }, data: { budget: newBudget, updatedAt: new Date() } })
              } catch {}
              budgetUp++
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "budget_up", reason: `ads/hh ${adsHhSummary}% < ${budgetUpThreshold}% (3 ngày liên tiếp)${cappedNote}`,
                daily: daily3, totalSpend: totalSpend3, oldBudget: c.budget, newBudget,
              })
            } else {
              actions.push({
                campaignDbId: c.id, campName: c.name, campFbId: c.campId, pageName,
                action: "skip", reason: "FB update-budget failed", daily: daily3, totalSpend: totalSpend3, fbError: fbErr,
              })
              skipped++
            }
            continue
          }
        }

        skipped++
      }

      await updateUserStats(u.id, off, budgetUp)
    } catch (e: any) {
      userErr = e?.message || String(e)
      await updateUserStats(u.id, off, budgetUp, userErr)
    }

    perUser.push({ userId: u.id, userName: u.name, off, budgetUp, skipped, error: userErr, actions })
    totalOff += off
    totalBudgetUp += budgetUp
  }

  return { processedUsers: enabledUsers.length, totalOff, totalBudgetUp, perUser }
}

async function fbToggleStatus(campFbId: string, fbStatus: "PAUSED" | "ACTIVE", token: string): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/${FB_VER}/${campFbId}`
    const p = new URLSearchParams()
    p.set("status", fbStatus)
    p.set("access_token", token)
    const r = await fetch(url, { method: "POST", body: p })
    const d: any = await r.json()
    if (d.error) return d.error.message || "FB error"
    return null
  } catch (e: any) {
    return e?.message || "Fetch error"
  }
}

async function fbUpdateBudget(campFbId: string, dailyBudget: number, token: string): Promise<string | null> {
  try {
    const url = `https://graph.facebook.com/${FB_VER}/${campFbId}`
    const p = new URLSearchParams()
    p.set("daily_budget", String(Math.round(dailyBudget)))
    p.set("access_token", token)
    const r = await fetch(url, { method: "POST", body: p })
    const d: any = await r.json()
    if (d.error) return d.error.message || "FB error"
    return null
  } catch (e: any) {
    return e?.message || "Fetch error"
  }
}

async function updateUserStats(userId: string, off: number, budgetUp: number, error?: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: {
        autoManageLastRunAt: new Date(),
        autoManageLastOffCount: off,
        autoManageLastBudgetUpCount: budgetUp,
        autoManageLastError: error || null,
      },
    })
  } catch {}
}
