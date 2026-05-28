import { prisma } from "./prisma"
import { sendTelegramMessage, fmtVndShort } from "./telegram"
import { sendPushToUser } from "./web-push-server"
import { getFbToken } from "./token-store"

// Rule cảnh báo Telegram:
//   - threshold > 2.000.000đ
//   - balance / threshold >= 0.8 (sắp bị FB thu tiền - hạ từ 0.9 → 0.8 ngày 2026-05-16 để có thêm thời gian chuẩn bị)
//   - Re-alert sau khi FB charge: balance hiện tại < lastAlertBalance × 0.5 (reset)
//
// State per TKQC trong User.telegramLastAlertAt:
//   { [actId]: { alertedAt: ISO timestamp, balance: number } }

const MIN_THRESHOLD = BigInt(2_000_000) // chỉ alert nếu threshold > 2tr
const ALERT_RATIO = 0.8          // balance/threshold >= 80%
const RESET_RATIO = 0.5          // balance giảm > 50% so lần alert trước = đã reset
const RE_ALERT_HOURS = 12        // alert lai sau N gio neu van >= 80% (de nguoi dung khong bo lo)

type AlertState = { alertedAt: string; balance: number }
type AlertStateMap = Record<string, AlertState>

// Gọi sau khi snapshotUserBilling xong (trong cron 7h sáng).
// Lỗi non-blocking — không throw, chỉ log warning.
export async function checkAndAlertBillingForUser(userId: string): Promise<{
  checked: number
  alerted: number
  skippedNoChat: boolean
  errors: string[]
}> {
  const errors: string[] = []
  try {
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, telegramLastAlertAt: true },
    })
    if (!u?.telegramChatId) return { checked: 0, alerted: 0, skippedNoChat: true, errors }

    const lastAlertMap: AlertStateMap = (u.telegramLastAlertAt as any) || {}

    // Lấy threshold + bank + chủ TK của user (từ AdAccountBillingInfo)
    const billingInfos = await prisma.adAccountBillingInfo.findMany({
      where: { userId, paymentThreshold: { not: null } },
      select: { actId: true, paymentThreshold: true, bankName: true, cardOwnerName: true },
    })
    if (billingInfos.length === 0) return { checked: 0, alerted: 0, skippedNoChat: false, errors }

    // Lookup AdAccount để biết tên + DB id
    const accs = await prisma.adAccount.findMany({
      where: { userId, actId: { in: billingInfos.map(b => b.actId) } },
      select: { id: true, actId: true, name: true },
    })
    const accByActId = new Map(accs.map(a => [a.actId, a]))

    // Snapshot mới nhất per TKQC (lấy thêm fundingSource = "Visa **** 6090" → tách 4 số cuối)
    const accIds = accs.map(a => a.id)
    if (accIds.length === 0) return { checked: 0, alerted: 0, skippedNoChat: false, errors }
    const snapshots = await prisma.fbAdAccountBilling.findMany({
      where: { userId, adAccountId: { in: accIds } },
      orderBy: { snapshotDate: "desc" },
      select: { adAccountId: true, balance: true, snapshotDate: true, fundingSource: true },
    })
    const latestByAccId = new Map<string, { balance: bigint | null; fundingSource: string | null }>()
    for (const s of snapshots) {
      if (s.adAccountId && !latestByAccId.has(s.adAccountId)) {
        latestByAccId.set(s.adAccountId, { balance: s.balance, fundingSource: s.fundingSource })
      }
    }

    let checked = 0, alerted = 0
    const newLastAlertMap = { ...lastAlertMap }
    const alertsToSend: Array<{ actId: string; name: string; balance: bigint; threshold: bigint; ratio: number; bank: string | null; owner: string | null; cardLast4: string | null }> = []

    for (const bi of billingInfos) {
      if (!bi.paymentThreshold || bi.paymentThreshold <= MIN_THRESHOLD) continue
      const acc = accByActId.get(bi.actId)
      if (!acc) continue
      const latest = latestByAccId.get(acc.id)
      if (!latest?.balance) continue
      checked++

      const balanceNum = Number(latest.balance)
      const ratio = balanceNum / Number(bi.paymentThreshold)
      if (ratio < ALERT_RATIO) continue

      // State logic:
      //   - Chua alert lan nao (state null) -> alert
      //   - Da alert: re-alert neu:
      //     (a) balance hien tai < lastBalance * 0.5 (FB da charge - reset)
      //     (b) HOAC alertedAt > 12h truoc (de nguoi dung khong bo lo neu balance van cao)
      const prevState = lastAlertMap[bi.actId]
      if (prevState) {
        const balanceReset = balanceNum < prevState.balance * RESET_RATIO
        const alertAge = Date.now() - new Date(prevState.alertedAt).getTime()
        const alertExpired = alertAge > RE_ALERT_HOURS * 3600 * 1000
        if (!balanceReset && !alertExpired) continue
      }

      alertsToSend.push({
        actId: bi.actId,
        name: acc.name,
        balance: latest.balance,
        threshold: bi.paymentThreshold,
        ratio,
        bank: bi.bankName,
        owner: bi.cardOwnerName,
        cardLast4: extractLast4(latest.fundingSource),
      })
      newLastAlertMap[bi.actId] = { alertedAt: new Date().toISOString(), balance: balanceNum }
    }

    if (alertsToSend.length === 0) return { checked, alerted: 0, skippedNoChat: false, errors }

    // Gom 1 message tổng nếu nhiều TKQC alert cùng lúc
    const lines = alertsToSend.map((a, i) => {
      const cardLine = formatCardLine(a.bank, a.owner, a.cardLast4)
      return `${i + 1}. <b>${escapeHtml(a.name)}</b>${cardLine ? `\n   <i>${cardLine}</i>` : ""}\n   Balance: ${fmtVndShort(a.balance)} / Threshold: ${fmtVndShort(a.threshold)} = <b>${(a.ratio * 100).toFixed(1)}%</b>`
    })
    const text = `⚠️ <b>Cảnh báo Billing FB</b>\n\n${alertsToSend.length} TKQC sắp đạt threshold (≥80%):\n\n${lines.join("\n\n")}\n\n💳 Chuẩn bị thanh toán hoặc nạp quỹ.`
    const r = await sendTelegramMessage(u.telegramChatId, text)
    // Song song: gửi Web Push (PWA) — fire-and-forget, không block telegram flow.
    sendPushToUser(userId, {
      title: "⚠️ Cảnh báo Billing FB",
      body: `${alertsToSend.length} TKQC sắp đạt threshold (≥80%). Chạm để xem.`,
      url: "/billing",
      tag: "billing-alert",
      requireInteraction: true,
    }).catch(() => {})
    if (r.ok) {
      alerted = alertsToSend.length
      // Save cache để không gửi lại trong ngày
      await prisma.user.update({
        where: { id: userId },
        data: { telegramLastAlertAt: newLastAlertMap as any },
      })
    } else {
      errors.push(r.error || "Telegram send fail")
    }

    return { checked, alerted, skippedNoChat: false, errors }
  } catch (e: any) {
    errors.push(e?.message || String(e))
    return { checked: 0, alerted: 0, skippedNoChat: false, errors }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c))
}

// Extract 4 số cuối thẻ từ FB fundingSource (vd "Visa **** 6090", "Mastercard ending in 5076", "VISA *7701").
function extractLast4(fundingSource: string | null): string | null {
  if (!fundingSource) return null
  const m = fundingSource.match(/(\d{4})(?!.*\d)/) // 4 digits cuối cùng trong chuỗi
  return m ? m[1] : null
}

// Format dòng card info: "Vietcombank • LE TRONG QUY • *6090" — skip nếu cả 3 đều null
function formatCardLine(bank: string | null | undefined, owner: string | null | undefined, last4: string | null): string {
  const parts: string[] = []
  if (bank) parts.push(escapeHtml(bank))
  if (owner) parts.push(escapeHtml(owner))
  if (last4) parts.push("*" + last4)
  return parts.join(" • ")
}

// =============== LIGHTWEIGHT CHECK (cron 10p) ===============
// Chỉ fetch balance từ FB API per TKQC (1 call/acc), KHÔNG snapshot full.
// Áp dụng cùng rule re-alert sau reset trong checkAndAlertBillingForUser.

const FB_VER = "v19.0"

export async function lightweightBalanceCheckForAllUsers(): Promise<{
  processedUsers: number
  totalAlerted: number
  errors: string[]
}> {
  const users = await prisma.user.findMany({
    where: { telegramChatId: { not: null }, status: "ACTIVE" },
    select: { id: true, name: true },
  })

  let totalAlerted = 0
  const errors: string[] = []

  // Concurrency 3 user song song để không quá tải FB rate limit user-level
  const CONC = 3
  for (let i = 0; i < users.length; i += CONC) {
    const batch = users.slice(i, i + CONC)
    const results = await Promise.all(batch.map(async (u) => {
      try {
        const r = await lightweightBalanceCheckForUser(u.id)
        if (r.alerted > 0) console.log(`[CRON-BALANCE-CHECK] User ${u.name}: alert ${r.alerted}/${r.checked} TKQC`)
        if (r.errors.length > 0) errors.push(`${u.name}: ${r.errors[0]}`)
        return r.alerted
      } catch (e: any) {
        errors.push(`${u.name}: ${e?.message?.slice(0, 100)}`)
        return 0
      }
    }))
    totalAlerted += results.reduce((s, n) => s + n, 0)
  }

  return { processedUsers: users.length, totalAlerted, errors }
}

async function lightweightBalanceCheckForUser(userId: string): Promise<{
  checked: number
  alerted: number
  errors: string[]
}> {
  const errors: string[] = []
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { telegramChatId: true, telegramLastAlertAt: true },
  })
  if (!u?.telegramChatId) return { checked: 0, alerted: 0, errors }

  // FB token
  const tokenRec = await getFbToken(userId)
  if (!tokenRec) return { checked: 0, alerted: 0, errors: ["No FB token"] }
  const token = tokenRec.longToken

  // Threshold + bank + owner per TKQC
  const billingInfos = await prisma.adAccountBillingInfo.findMany({
    where: { userId, paymentThreshold: { gt: MIN_THRESHOLD } },
    select: { actId: true, paymentThreshold: true, bankName: true, cardOwnerName: true },
  })
  if (billingInfos.length === 0) return { checked: 0, alerted: 0, errors }

  const accs = await prisma.adAccount.findMany({
    where: { userId, actId: { in: billingInfos.map(b => b.actId) }, status: "ON" },
    select: { id: true, actId: true, name: true },
  })
  const accByActId = new Map(accs.map(a => [a.actId, a]))

  // Funding source mới nhất per TKQC (để lấy 4 số cuối thẻ)
  const snapshots = await prisma.fbAdAccountBilling.findMany({
    where: { userId, adAccountId: { in: accs.map(a => a.id) } },
    orderBy: { snapshotDate: "desc" },
    select: { adAccountId: true, fundingSource: true },
  })
  const fundingByAccId = new Map<string, string | null>()
  for (const s of snapshots) {
    if (s.adAccountId && !fundingByAccId.has(s.adAccountId)) {
      fundingByAccId.set(s.adAccountId, s.fundingSource)
    }
  }

  const lastAlertMap: AlertStateMap = (u.telegramLastAlertAt as any) || {}
  const newLastAlertMap = { ...lastAlertMap }
  const alertsToSend: Array<{ actId: string; name: string; balance: number; threshold: bigint; ratio: number; bank: string | null; owner: string | null; cardLast4: string | null }> = []
  let checked = 0

  // Fetch balance per TKQC (parallel, không snapshot full)
  await Promise.all(billingInfos.map(async (bi) => {
    const acc = accByActId.get(bi.actId)
    if (!acc || !bi.paymentThreshold) return
    try {
      const actPath = acc.actId.startsWith("act_") ? acc.actId : `act_${acc.actId}`
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 8000)
      const url = `https://graph.facebook.com/${FB_VER}/${actPath}?fields=balance&access_token=${encodeURIComponent(token)}`
      const res = await fetch(url, { signal: ctrl.signal })
      clearTimeout(timer)
      const data: any = await res.json().catch(() => ({}))
      if (data.error || !data.balance) return
      const balance = Number(data.balance)
      if (!Number.isFinite(balance)) return
      checked++

      const ratio = balance / Number(bi.paymentThreshold)
      if (ratio < ALERT_RATIO) {
        // Nếu balance reset (< RESET_RATIO * lastBalance) → xoá state để lần sau alert lại
        const prev = lastAlertMap[bi.actId]
        if (prev && balance < prev.balance * RESET_RATIO) {
          delete newLastAlertMap[bi.actId]
        }
        return
      }

      // Check state - skip neu da alert va (chua reset balance) va (chua qua 12h)
      const prevState = lastAlertMap[bi.actId]
      if (prevState) {
        const balanceReset = balance < prevState.balance * RESET_RATIO
        const alertAge = Date.now() - new Date(prevState.alertedAt).getTime()
        const alertExpired = alertAge > RE_ALERT_HOURS * 3600 * 1000
        if (!balanceReset && !alertExpired) return
      }

      alertsToSend.push({
        actId: bi.actId,
        name: acc.name,
        balance,
        threshold: bi.paymentThreshold,
        ratio,
        bank: bi.bankName,
        owner: bi.cardOwnerName,
        cardLast4: extractLast4(fundingByAccId.get(acc.id) || null),
      })
      newLastAlertMap[bi.actId] = { alertedAt: new Date().toISOString(), balance }
    } catch (e: any) {
      errors.push(`${acc.name}: ${e?.message?.slice(0, 80)}`)
    }
  }))

  if (alertsToSend.length === 0) {
    // Vẫn save state nếu có balance reset (clear key)
    if (Object.keys(newLastAlertMap).length !== Object.keys(lastAlertMap).length) {
      try {
        await prisma.user.update({ where: { id: userId }, data: { telegramLastAlertAt: newLastAlertMap as any } })
      } catch {}
    }
    return { checked, alerted: 0, errors }
  }

  // Send 1 message gộp (kèm card info: bank • owner • *last4)
  const lines = alertsToSend.map((a, i) => {
    const cardLine = formatCardLine(a.bank, a.owner, a.cardLast4)
    return `${i + 1}. <b>${escapeHtml(a.name)}</b>${cardLine ? `\n   <i>${cardLine}</i>` : ""}\n   Balance: ${fmtVndShort(a.balance)} / Threshold: ${fmtVndShort(a.threshold)} = <b>${(a.ratio * 100).toFixed(1)}%</b>`
  })
  const text = `⚠️ <b>Cảnh báo Billing FB</b>\n\n${alertsToSend.length} TKQC sắp đạt threshold (≥80%):\n\n${lines.join("\n\n")}\n\n💳 Chuẩn bị thanh toán hoặc nạp quỹ.`
  const r = await sendTelegramMessage(u.telegramChatId, text)
  // Song song Web Push (fire-and-forget).
  sendPushToUser(userId, {
    title: "⚠️ Cảnh báo Billing FB",
    body: `${alertsToSend.length} TKQC sắp đạt threshold (≥80%). Chạm để xem.`,
    url: "/billing",
    tag: "billing-alert",
    requireInteraction: true,
  }).catch(() => {})
  if (!r.ok) {
    errors.push(r.error || "Telegram send fail")
    return { checked, alerted: 0, errors }
  }

  // Save state
  try {
    await prisma.user.update({ where: { id: userId }, data: { telegramLastAlertAt: newLastAlertMap as any } })
  } catch {}

  return { checked, alerted: alertsToSend.length, errors }
}
