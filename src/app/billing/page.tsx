"use client"
import { useEffect, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"
import { useConfirm } from "@/components/Confirm"
import PushSubscribeButton from "@/components/PushSubscribeButton"
import { useIsMobile } from "@/hooks/useIsMobile"

interface Snapshot {
  id: string
  adAccountId: string
  snapshotDate: string
  amountSpentTotal: string
  dailySpendLimit: string | null
  balance: string | null
  spendCap: string | null
  accountStatus: string
  currency: string
  fundingSource: string | null
  fundingType: string | null
  limitReduced: boolean
  limitDeltaPercent: number | null
  adAccount: {
    id: string
    name: string
    actId: string
    status: string
    businessId: string | null
    dailySpendLimit: string | null
    dailySpendLimitUpdatedAt: string | null
    bankName: string | null
    cardOwnerName: string | null
    cardLast4: string | null
    paymentThreshold: string | null
    billingNotes: string | null
  }
}

interface ThresholdRow {
  adAccountId: string
  actId: string
  name: string
  threshold: string | null
  currentBalance: string | null
  dailySpendRate: string
  daysToThreshold: number | null
  willHitSoon: boolean
}

const fmtVND = (n: string | number | null | bigint | undefined) => {
  if (n === null || n === undefined || n === "") return "—"
  const num = typeof n === "string" ? parseFloat(n) : Number(n)
  if (!Number.isFinite(num)) return "—"
  return num.toLocaleString("vi-VN") + " đ"
}

// Format không có " đ" suffix - giong UI FB Business Manager
const fmtNumber = (n: string | number | null | bigint | undefined) => {
  if (n === null || n === undefined || n === "") return "—"
  const num = typeof n === "string" ? parseFloat(n) : Number(n)
  if (!Number.isFinite(num)) return "—"
  return Math.round(num).toLocaleString("vi-VN")
}

const fmtDate = (s: string | null) => {
  if (!s) return "—"
  return new Date(s).toLocaleDateString("vi-VN")
}

// Parse "Visa ···· 8623" / "Mastercard ···· 5076" / "Tín dụng quảng cáo"
// -> { brand, last4, isCredit }
function parseFundingSource(s: string | null): { brand: string; last4: string; isCredit: boolean } {
  if (!s) return { brand: "", last4: "", isCredit: false }
  if (/tín\s*dụng\s*quảng\s*cáo/i.test(s)) return { brand: "Tín dụng QC", last4: "", isCredit: true }
  const m = s.match(/(visa|mastercard|jcb|amex|american\s*express)[^\d]*?(\d{4})/i)
  if (m) {
    const brand = m[1].toLowerCase().includes("master") ? "Mastercard" : m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()
    return { brand, last4: m[2], isCredit: false }
  }
  return { brand: s.slice(0, 30), last4: "", isCredit: false }
}

// Mau brand cho badge
function brandColor(brand: string): { bg: string; color: string } {
  const b = brand.toLowerCase()
  if (b.includes("visa")) return { bg: "rgba(26,31,113,.1)", color: "#1a1f71" }
  if (b.includes("master")) return { bg: "rgba(235,0,27,.1)", color: "#eb001b" }
  if (b.includes("jcb")) return { bg: "rgba(15,93,164,.1)", color: "#0f5da4" }
  if (b.includes("amex") || b.includes("express")) return { bg: "rgba(0,108,184,.1)", color: "#006cb8" }
  if (b.includes("tín dụng")) return { bg: "rgba(155,89,182,.1)", color: "#9b59b6" }
  return { bg: "var(--bg3)", color: "var(--muted)" }
}

export default function BillingPage() {
  const isMobile = useIsMobile()
  const [mobileFilter, setMobileFilter] = useState<"all" | "warn" | "ok">("all")
  const toast = useToast()
  const { ask } = useConfirm()
  const [latest, setLatest] = useState<Snapshot[]>([])
  const [thresholdStatus, setThresholdStatus] = useState<ThresholdRow[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ bankName: "", cardOwnerName: "", paymentThreshold: "", billingNotes: "" })
  // Sort table
  const [sortBy, setSortBy] = useState<"" | "balance" | "threshold" | "remaining" | "limit" | "spent">("")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  function toggleSort(col: typeof sortBy) {
    if (sortBy === col) {
      setSortDir(d => d === "desc" ? "asc" : "desc")
    } else {
      setSortBy(col)
      setSortDir("desc")
    }
  }

  // Card management modal state
  const [showCardModal, setShowCardModal] = useState(false)
  const [cards, setCards] = useState<Array<{ id: string; bankName: string; cardOwnerName: string; cardLast4: string; notes: string | null }>>([])
  const [cardForm, setCardForm] = useState({ bankName: "", cardOwnerName: "", cardLast4: "" })
  const [cardSaving, setCardSaving] = useState(false)
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  // Telegram alert config
  const [showTgConfig, setShowTgConfig] = useState(false)
  const [showPushConfig, setShowPushConfig] = useState(false)
  const [tgChatId, setTgChatId] = useState("")
  const [tgChatIdSaved, setTgChatIdSaved] = useState("")
  const [tgSaving, setTgSaving] = useState(false)
  const [tgTesting, setTgTesting] = useState(false)

  async function loadTgConfig() {
    try {
      const r = await fetch("/api/user/telegram", { credentials: "include" })
      if (!r.ok) return
      const d = await r.json()
      setTgChatId(d.chatId || "")
      setTgChatIdSaved(d.chatId || "")
    } catch {}
  }

  async function saveTgConfig() {
    setTgSaving(true)
    try {
      const r = await fetch("/api/user/telegram", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: tgChatId.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status)
      setTgChatIdSaved(d.chatId)
      toast.show(d.chatId ? "✅ Đã lưu Chat ID" : "✅ Đã xoá Chat ID (tắt alert)", "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setTgSaving(false) }
  }

  async function testTgSend() {
    setTgTesting(true)
    try {
      const r = await fetch("/api/user/telegram", { method: "POST", credentials: "include" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status)
      toast.show("✅ " + d.message, "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setTgTesting(false) }
  }

  useEffect(() => { loadTgConfig() }, [])

  async function loadAll() {
    setLoading(true)
    try {
      const [snapRes, thrRes] = await Promise.all([
        fetch("/api/fb/billing/snapshots?days=30").then(r => r.json()),
        fetch("/api/fb/billing/threshold").then(r => r.json()),
      ])
      // Guard: filter snapshot khong co adAccount (FbAdAccountBilling.adAccountId
      // nullable - SetNull khi sync recreate). UI assume s.adAccount luon ton tai
      // -> crash ".name of null" neu khong filter.
      const safeLatest = (snapRes.latest || []).filter((s: any) => s && s.adAccount)
      setLatest(safeLatest)
      setThresholdStatus(thrRes.results || [])
    } finally { setLoading(false) }
  }

  useEffect(() => { loadAll() }, [])

  async function refreshSnapshots() {
    setRefreshing(true)
    try {
      const r = await fetch("/api/fb/billing/refresh", { method: "POST" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      // Hiện chi tiết: nếu có TKQC fail → list ra để debug
      const errors = (d.results || []).filter((x: any) => !x.ok && x.error)
      if (errors.length > 0) {
        const firstErr = errors[0]
        toast.show(
          `⚠ Snapshot fail ${errors.length}/${d.summary.total} TKQC. Lỗi đầu: "${firstErr.name}" → ${firstErr.error}`,
          "warn" as any,
        )
        console.error("[billing/refresh] errors:", errors)
      } else {
        toast.show(
          `✓ Snapshot ${d.summary.success}/${d.summary.total} TKQC (${d.summary.limitReduced} bị giảm limit)`,
          "success" as any,
        )
      }
      loadAll()
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setRefreshing(false) }
  }

  async function loadCards() {
    try {
      const r = await fetch("/api/user-cards", { credentials: "include" })
      if (!r.ok) return
      const d = await r.json()
      setCards(d.cards || [])
    } catch {}
  }

  function openCardModal() {
    setCardForm({ bankName: "", cardOwnerName: "", cardLast4: "" })
    setEditingCardId(null)
    setShowCardModal(true)
    loadCards()
  }

  async function saveCard() {
    if (cardSaving) return
    const f = cardForm
    if (!f.bankName.trim() || !f.cardOwnerName.trim() || f.cardLast4.length !== 4) {
      toast.show("Cần điền đủ Bank + Chủ thẻ + 4 số cuối", "warn" as any)
      return
    }
    setCardSaving(true)
    try {
      const url = editingCardId ? `/api/user-cards/${editingCardId}` : "/api/user-cards"
      const method = editingCardId ? "PATCH" : "POST"
      const r = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(f),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status)
      toast.show(editingCardId ? "✅ Đã cập nhật thẻ" : "✅ Đã thêm thẻ", "success" as any)
      setCardForm({ bankName: "", cardOwnerName: "", cardLast4: "" })
      setEditingCardId(null)
      await loadCards()
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setCardSaving(false) }
  }

  function startEditCard(c: { id: string; bankName: string; cardOwnerName: string; cardLast4: string }) {
    setEditingCardId(c.id)
    setCardForm({ bankName: c.bankName, cardOwnerName: c.cardOwnerName, cardLast4: c.cardLast4 })
  }

  async function deleteCard(id: string, label: string) {
    if (!await ask(`Xoá thẻ ${label}?`, { danger: true })) return
    try {
      const r = await fetch(`/api/user-cards/${id}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) throw new Error("HTTP " + r.status)
      toast.show("✅ Đã xoá thẻ", "success" as any)
      await loadCards()
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    }
  }

  // Map: last4 -> UserCard (cho main table auto-match)
  const cardByLast4 = new Map<string, { bankName: string; cardOwnerName: string }>()
  for (const c of cards) cardByLast4.set(c.cardLast4, { bankName: c.bankName, cardOwnerName: c.cardOwnerName })

  // Load cards ngay sau khi mount de main table biet
  useEffect(() => { loadCards() }, [])

  function startEdit(s: Snapshot) {
    setEditingId(s.adAccountId)
    setEditForm({
      bankName: s.adAccount.bankName || "",
      cardOwnerName: s.adAccount.cardOwnerName || "",
      paymentThreshold: s.adAccount.paymentThreshold || "",
      billingNotes: s.adAccount.billingNotes || "",
    })
  }

  async function saveEdit() {
    if (!editingId) return
    try {
      const r = await fetch(`/api/accounts/${editingId}/billing-info`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error)
      toast.show("✓ Đã lưu", "success" as any)
      setEditingId(null)
      loadAll()
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    }
  }

  // Map adAccountId → threshold row
  const thrMap = new Map<string, ThresholdRow>()
  for (const t of thresholdStatus) thrMap.set(t.adAccountId, t)

  // Compute sort value per snapshot
  function sortValue(s: Snapshot, key: typeof sortBy): number {
    const balance = parseFloat(s.balance || "0")
    const threshold = parseFloat(s.adAccount.paymentThreshold || "0")
    const remaining = threshold > 0 ? Math.max(0, threshold - balance) : 0
    const dailyLimit = parseFloat(s.adAccount.dailySpendLimit || "0")
    const limit = dailyLimit > 0 ? dailyLimit : parseFloat(s.spendCap || "0")
    const spent = parseFloat(s.amountSpentTotal || "0")
    switch (key) {
      case "balance": return balance
      case "threshold": return threshold
      case "remaining": return remaining
      case "limit": return limit
      case "spent": return spent
      default: return 0
    }
  }
  // Sort latest array if sortBy is set
  const sortedLatest = sortBy
    ? [...latest].sort((a, b) => {
        const va = sortValue(a, sortBy)
        const vb = sortValue(b, sortBy)
        return sortDir === "desc" ? vb - va : va - vb
      })
    : latest

  const reducedAccounts = latest.filter(s => s.limitReduced)
  const willHitSoonAccounts = thresholdStatus.filter(t => t.willHitSoon)

  // ===== MOBILE LAYOUT =====
  if (isMobile) {
    const calcRatio = (s: Snapshot) => {
      const balance = parseFloat(s.balance || "0")
      const threshold = parseFloat(s.adAccount.paymentThreshold || "0")
      return threshold > 0 ? Math.min(100, Math.round((balance / threshold) * 100)) : 0
    }
    const totalDue = sortedLatest.reduce((sum, s) => {
      const balance = parseFloat(s.balance || "0")
      return sum + (balance || 0)
    }, 0)
    const totalSpentToday = sortedLatest.reduce((sum, s) => sum + parseFloat(s.amountSpentTotal || "0"), 0)
    const warnCount = sortedLatest.filter(s => calcRatio(s) >= 85).length

    // Filter cho card list
    const filtered = sortedLatest.filter(s => {
      const r = calcRatio(s)
      if (mobileFilter === "warn") return r >= 85
      if (mobileFilter === "ok") return r < 85
      return true
    })

    return (
      <AppLayout>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -.4 }}>Billing FB</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{sortedLatest.length} TKQC</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowPushConfig(true)} title="Push notification"
              style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--bg3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer" }}>🔔</button>
            <button onClick={refreshSnapshots} disabled={refreshing}
              style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--bg3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: refreshing ? "wait" : "pointer", opacity: refreshing ? .5 : 1 }}>🔄</button>
          </div>
        </div>

        {/* Summary big card */}
        <div style={{ background: "var(--bg2)", borderRadius: 14, padding: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, textTransform: "uppercase", letterSpacing: .5 }}>TỔNG BALANCE HIỆN TẠI</div>
              <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -.5, marginTop: 2 }}>{fmtNumber(totalDue.toString())}đ</div>
            </div>
            {warnCount > 0 && (
              <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 8, fontWeight: 700, background: "rgba(239,68,68,.1)", color: "var(--danger)" }}>{warnCount} TKQC ≥ 85%</span>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--muted)" }}>Tổng spend (đến nay)</span>
            <span style={{ fontWeight: 600 }}>{fmtNumber(totalSpentToday.toString())}đ</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", fontSize: 13, borderTop: "1px solid var(--border)" }}>
            <span style={{ color: "var(--muted)" }}>TKQC theo dõi</span>
            <span style={{ fontWeight: 600 }}>{sortedLatest.length}</span>
          </div>
        </div>

        {/* Filter chips */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", scrollbarWidth: "none" as any }}>
          {[
            { k: "all", l: `Tất cả (${sortedLatest.length})` },
            { k: "warn", l: `Cần chú ý (${warnCount})` },
            { k: "ok", l: `An toàn (${sortedLatest.length - warnCount})` },
          ].map(c => {
            const active = mobileFilter === c.k
            return (
              <button key={c.k} onClick={() => setMobileFilter(c.k as "all" | "warn" | "ok")}
                style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 20, background: active ? "var(--text)" : "var(--bg2)", color: active ? "var(--bg)" : "var(--text)", border: `1px solid ${active ? "var(--text)" : "var(--border)"}`, fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", cursor: "pointer", fontFamily: "inherit" }}>
                {c.l}
              </button>
            )
          })}
        </div>

        {/* TKQC cards */}
        {filtered.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Không có TKQC nào</div>
        ) : filtered.map(s => {
          const balance = parseFloat(s.balance || "0")
          const threshold = parseFloat(s.adAccount.paymentThreshold || "0")
          const ratio = calcRatio(s)
          const tone = ratio >= 90 ? "danger" : ratio >= 70 ? "warn" : "ok"
          const toneCfg = {
            danger: { bg: "rgba(239,68,68,.1)", color: "#ef4444", barColor: "#ef4444" },
            warn:   { bg: "rgba(245,158,11,.1)", color: "#f59e0b", barColor: "#f59e0b" },
            ok:     { bg: "rgba(22,163,74,.1)", color: "#16a34a", barColor: "#16a34a" },
          }[tone]
          return (
            <div key={s.id} style={{ background: "var(--bg2)", borderRadius: 14, padding: 14, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 38, height: 38, borderRadius: 12, background: toneCfg.bg, color: toneCfg.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18 }}>💳</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.adAccount.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1, fontVariantNumeric: "tabular-nums" }}>act_{s.adAccount.actId.replace(/^act_/, "")}</div>
                </div>
                <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 8, fontWeight: 700, background: toneCfg.bg, color: toneCfg.color, flexShrink: 0 }}>
                  {threshold > 0 ? `${ratio}%` : "—"}
                </span>
              </div>
              {threshold > 0 && (
                <>
                  <div style={{ height: 8, background: "var(--bg3)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${ratio}%`, height: "100%", background: toneCfg.barColor, borderRadius: 4 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 6 }}>
                    <span style={{ color: "var(--muted)" }}>Balance: <b style={{ color: "var(--text)" }}>{fmtNumber(s.balance)}đ</b></span>
                    <span style={{ color: "var(--muted)" }}>/ <b style={{ color: "var(--text)" }}>{fmtNumber(s.adAccount.paymentThreshold || "0")}đ</b></span>
                  </div>
                </>
              )}
              {(s.adAccount.bankName || s.adAccount.cardOwnerName) && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--muted)" }}>
                  💳 {[s.adAccount.bankName, s.adAccount.cardOwnerName].filter(Boolean).join(" • ")}
                </div>
              )}
            </div>
          )
        })}

        {/* Push modal — render giống desktop */}
        {showPushConfig && (
          <div onClick={(e) => { if (e.target === e.currentTarget) setShowPushConfig(false) }}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 200 }}>
            <div style={{ background: "var(--bg2)", borderRadius: "16px 16px 0 0", width: "100%", padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>🔔 Push Notification</div>
                <button onClick={() => setShowPushConfig(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer" }}>×</button>
              </div>
              <PushSubscribeButton />
            </div>
          </div>
        )}
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>💳 Billing FB Ads</div>
            <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
              Snapshot daily limit / balance + cảnh báo limit giảm + dự đoán ngày thanh toán + invoices cho kế toán.
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
              Auto cron snapshot 7h sáng VN. Bấm "Refresh" để snapshot ngay.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
            <button onClick={openCardModal} title="Quản lý danh sách thẻ thanh toán. App tự match với TKQC qua 4 số cuối từ FB."
              style={{ height: 30, padding: "0 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit", fontWeight: 500 }}>
              💳 Thông tin thẻ ({cards.length})
            </button>
            <button onClick={() => setShowTgConfig(true)} title="Cấu hình Telegram alert khi balance/threshold ≥ 80%"
              style={{ height: 30, padding: "0 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid " + (tgChatIdSaved ? "rgba(46,204,143,.4)" : "var(--border)"), background: tgChatIdSaved ? "rgba(46,204,143,.08)" : "transparent", color: tgChatIdSaved ? "var(--success)" : "var(--muted)", fontFamily: "inherit", fontWeight: 500 }}>
              {tgChatIdSaved ? "📱 Telegram: BẬT" : "📱 Telegram: TẮT"}
            </button>
            <button onClick={() => setShowPushConfig(true)} title="Push Notification PWA — nhận alert trực tiếp trên app/màn hình"
              style={{ height: 30, padding: "0 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit", fontWeight: 500 }}>
              🔔 Push App
            </button>
            <button onClick={refreshSnapshots} disabled={refreshing}
              style={{ height: 30, padding: "0 14px", borderRadius: 6, fontSize: 12, cursor: refreshing ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 600, opacity: refreshing ? 0.6 : 1 }}>
              {refreshing ? "⏳ Đang fetch..." : "🔄 Refresh snapshot"}
            </button>
          </div>
        </div>

        {/* Cảnh báo */}
        {(reducedAccounts.length > 0 || willHitSoonAccounts.length > 0) && (
          <div style={{ background: "rgba(232,77,45,.06)", border: "1px solid rgba(232,77,45,.25)", borderRadius: 8, padding: "10px 14px", display: "flex", flexDirection: "column" as const, gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--danger)" }}>⚠ Cảnh báo</div>
            {reducedAccounts.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text)" }}>
                <b>{reducedAccounts.length}</b> TKQC bị Meta giảm daily limit (&gt;30%): {reducedAccounts.map(s => s.adAccount.name).join(", ")}
              </div>
            )}
            {willHitSoonAccounts.length > 0 && (
              <div style={{ fontSize: 11, color: "var(--text)" }}>
                <b>{willHitSoonAccounts.length}</b> TKQC sắp đạt threshold thanh toán (&lt; 3 ngày): {willHitSoonAccounts.map(t => `${t.name} (${t.daysToThreshold}d)`).join(", ")}
              </div>
            )}
          </div>
        )}

        {/* Section 1: Bảng tổng quan TKQC */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 13, fontWeight: 600 }}>
            📋 Tổng quan {latest.length} TKQC
          </div>
          <div style={{ overflowX: "auto" as const }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100 }}>
              <thead style={{ background: "var(--bg3)" }}>
                <tr>
                  <th style={{ ...billingTh, width: 32 }}><input type="checkbox" disabled style={{ cursor: "not-allowed" }} /></th>
                  <th style={billingTh}>TT</th>
                  <th style={{ ...billingTh, textAlign: "left" as const }}>Tài khoản</th>
                  <th onClick={() => toggleSort("balance")} style={{ ...billingTh, textAlign: "right" as const, cursor: "pointer", background: sortBy === "balance" ? "rgba(79,126,248,.08)" : undefined }}>
                    Số dư {sortBy === "balance" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                  </th>
                  <th onClick={() => toggleSort("threshold")} style={{ ...billingTh, textAlign: "right" as const, cursor: "pointer", background: sortBy === "threshold" ? "rgba(79,126,248,.08)" : undefined }}>
                    Ngưỡng {sortBy === "threshold" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                  </th>
                  <th onClick={() => toggleSort("remaining")} style={{ ...billingTh, textAlign: "right" as const, cursor: "pointer", background: sortBy === "remaining" ? "rgba(79,126,248,.08)" : undefined }}>
                    Ngưỡng còn lại {sortBy === "remaining" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                  </th>
                  <th onClick={() => toggleSort("limit")} style={{ ...billingTh, textAlign: "right" as const, cursor: "pointer", background: sortBy === "limit" ? "rgba(79,126,248,.08)" : undefined }}>
                    Limit {sortBy === "limit" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                  </th>
                  <th onClick={() => toggleSort("spent")} style={{ ...billingTh, textAlign: "right" as const, cursor: "pointer", background: sortBy === "spent" ? "rgba(79,126,248,.08)" : undefined }}>
                    Tổng tiêu {sortBy === "spent" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                  </th>
                  <th style={billingTh}>Thẻ</th>
                  <th style={billingTh}>Thông tin thẻ</th>
                  <th style={{ ...billingTh, width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {latest.length === 0 ? (
                  <tr><td colSpan={11} style={{ padding: 30, textAlign: "center" as const, color: "var(--muted)" }}>
                    {loading ? "Đang tải..." : "Chưa có snapshot. Bấm Refresh để fetch lần đầu."}
                  </td></tr>
                ) : (() => {
                  // Compute totals for footer
                  // Limit: uu tien dailySpendLimit (extension scrape) > spendCap (API)
                  const totals = latest.reduce((acc, s) => {
                    const balance = parseFloat(s.balance || "0")
                    const threshold = parseFloat(s.adAccount.paymentThreshold || "0")
                    const remaining = threshold > 0 ? Math.max(0, threshold - balance) : 0
                    const dailyLimit = parseFloat(s.adAccount.dailySpendLimit || "0")
                    const cap = parseFloat(s.spendCap || "0")
                    const limitVal = dailyLimit > 0 ? dailyLimit : cap
                    const spent = parseFloat(s.amountSpentTotal || "0")
                    acc.balance += balance
                    acc.threshold += threshold
                    acc.remaining += remaining
                    acc.cap += limitVal
                    acc.spent += spent
                    return acc
                  }, { balance: 0, threshold: 0, remaining: 0, cap: 0, spent: 0 })

                  return (
                    <>
                      {sortedLatest.map(s => {
                        const isActive = s.accountStatus === "ACTIVE"
                        const balance = parseFloat(s.balance || "0")
                        const threshold = parseFloat(s.adAccount.paymentThreshold || "0")
                        const remaining = threshold > 0 ? Math.max(0, threshold - balance) : null
                        // Limit uu tien dailySpendLimit (Meta-imposed, scrape boi extension)
                        // > spendCap (user-set, tu FB API).
                        const dailyLimit = parseFloat(s.adAccount.dailySpendLimit || "0")
                        const cap = dailyLimit > 0 ? dailyLimit : parseFloat(s.spendCap || "0")
                        const limitSource = dailyLimit > 0 ? "Meta đặt (extension)" : (cap > 0 ? "Spend cap (user)" : "Chưa có data")
                        const fs = parseFundingSource(s.fundingSource)
                        const bc = brandColor(fs.brand)
                        // Uu tien cardLast4 manual (override TKQC) > last4 tu FB funding_source
                        const displayLast4 = s.adAccount.cardLast4 || fs.last4
                        // Lookup UserCard theo last4 -> auto-fill bank + owner
                        const matchedCard = displayLast4 ? cardByLast4.get(displayLast4) : null
                        const displayBank = matchedCard?.bankName || s.adAccount.bankName
                        const displayOwner = matchedCard?.cardOwnerName || s.adAccount.cardOwnerName
                        return (
                          <tr key={s.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={billingTd}><input type="checkbox" disabled style={{ cursor: "not-allowed" }} /></td>
                            <td style={billingTd}>
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: isActive ? "var(--success)" : "var(--danger)", fontWeight: 500 }}>
                                <span style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? "var(--success)" : "var(--danger)" }} />
                                {isActive ? "Hoạt động" : "Vô hiệu hóa"}
                              </span>
                            </td>
                            <td style={{ ...billingTd, textAlign: "left" as const }}>
                              <div style={{ fontWeight: 500 }}>{s.adAccount.name}</div>
                              <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{s.adAccount.actId.replace(/^act_/, "")}</div>
                            </td>
                            <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace" }}>
                              {fmtNumber(s.balance)}
                            </td>
                            <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace", color: threshold > 0 ? "var(--text)" : "var(--muted)" }}>
                              {threshold > 0 ? fmtNumber(threshold) : "—"}
                            </td>
                            <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace", color: remaining !== null && remaining < threshold * 0.2 ? "var(--danger)" : "var(--text)", fontWeight: remaining !== null && remaining < threshold * 0.2 ? 600 : 400 }}>
                              {remaining !== null ? fmtNumber(remaining) : "—"}
                            </td>
                            <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace", color: cap > 0 ? "var(--text)" : "var(--muted)" }} title={limitSource}>
                              {cap > 0 ? fmtNumber(cap) : "No limit"}
                              {dailyLimit > 0 && <div style={{ fontSize: 9, color: "var(--success)", fontWeight: 500 }}>Meta</div>}
                            </td>
                            <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace", color: "var(--muted)" }}>
                              {fmtNumber(s.amountSpentTotal)}
                            </td>
                            <td style={billingTd}>
                              {fs.brand || displayLast4 ? (
                                <span>{fs.brand ? fs.brand.toLowerCase() : ""}{displayLast4 ? ` ****${displayLast4}` : ""}</span>
                              ) : <span style={{ color: "var(--muted)" }}>—</span>}
                            </td>
                            <td style={billingTd}>
                              {displayBank || displayOwner ? (
                                <span>{displayBank || ""}{displayBank && displayOwner ? " - " : ""}{displayOwner || ""}</span>
                              ) : <span style={{ color: "var(--muted)" }}>—</span>}
                            </td>
                            <td style={billingTd}>
                              <button onClick={() => startEdit(s)} title="Sửa thông tin thanh toán" style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", fontFamily: "inherit" }}>
                                ✏
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                      {/* Footer total row */}
                      <tr style={{ background: "var(--bg3)", fontWeight: 600 }}>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                        <td style={{ ...billingTd, textAlign: "left" as const, fontWeight: 600 }}>{latest.length} Tài khoản quảng cáo</td>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                        <td style={{ ...billingTd, textAlign: "right" as const, fontFamily: "monospace", color: "var(--success)" }}>{fmtNumber(totals.spent)}</td>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                        <td style={billingTd}></td>
                      </tr>
                    </>
                  )
                })()}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invoices da tach sang trang /invoices rieng (2026-05-18) */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px", fontSize: 12, color: "var(--muted)" }}>
          📄 Invoices đã được tách sang trang riêng → <a href="/invoices" style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>vào trang Invoices</a>
        </div>
      </div>

      {/* Modal edit billing info */}
      {editingId && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: 480, padding: 22, display: "flex", flexDirection: "column" as const, gap: 12, position: "relative" as const }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>✏ Sửa thông tin thanh toán</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              FB không expose tên ngân hàng + tên chủ TK + threshold qua API. Mày nhập tay 1 lần.
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Tên ngân hàng</label>
              <input value={editForm.bankName} onChange={e => setEditForm(f => ({ ...f, bankName: e.target.value }))} placeholder="vd Vietcombank, VIB, Techcombank..." style={{ width: "100%", height: 34, fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "0 10px", outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Tên chủ thẻ</label>
              <input value={editForm.cardOwnerName} onChange={e => setEditForm(f => ({ ...f, cardOwnerName: e.target.value }))} placeholder="vd LE TRONG QUY" style={{ width: "100%", height: 34, fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "0 10px", outline: "none" }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Ngưỡng billing FB (VND) — copy từ Ads Manager</label>
              <input value={editForm.paymentThreshold} onChange={e => setEditForm(f => ({ ...f, paymentThreshold: e.target.value.replace(/\D/g, "") }))} placeholder="vd 7714647" style={{ width: "100%", height: 34, fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "0 10px", outline: "none", fontFamily: "monospace" }} />
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                Vào FB Ads Manager → Tài khoản → Hoạt động thanh toán → tìm "Số dư của bạn đạt: X đ"
              </div>
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Ghi chú khác</label>
              <textarea value={editForm.billingNotes} onChange={e => setEditForm(f => ({ ...f, billingNotes: e.target.value }))} placeholder="vd: Số tài khoản nội bộ, mã thuế..." rows={2} style={{ width: "100%", fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "8px 10px", outline: "none", resize: "vertical" as const }} />
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditingId(null)} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", height: 32 }}>Huỷ</button>
              <button onClick={saveEdit} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--success)", color: "#fff", fontWeight: 600, height: 32 }}>Lưu</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal BULK card edit */}
      {showCardModal && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowCardModal(false) }}
          style={{ position: "fixed" as const, inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: 720, maxWidth: "100%", maxHeight: "90vh", padding: 18, display: "flex", flexDirection: "column" as const, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>💳 Thông tin thẻ</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
                  Nhập thông tin các thẻ anh dùng để thanh toán FB Ads. App sẽ tự match TKQC qua 4 số cuối từ FB API → tự điền cột "Thông tin thẻ".
                </div>
              </div>
              <button onClick={() => setShowCardModal(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Form Add/Edit card */}
            <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6, padding: 12, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" as const }}>
              <div style={{ flex: "1 1 140px" }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Ngân hàng</label>
                <input
                  value={cardForm.bankName}
                  onChange={e => setCardForm(f => ({ ...f, bankName: e.target.value }))}
                  placeholder="VIB, TCB, MB, Vietcombank..."
                  style={{ width: "100%", height: 32, fontSize: 12, padding: "0 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", outline: "none" }}
                />
              </div>
              <div style={{ flex: "1 1 180px" }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Chủ thẻ</label>
                <input
                  value={cardForm.cardOwnerName}
                  onChange={e => setCardForm(f => ({ ...f, cardOwnerName: e.target.value }))}
                  placeholder="LE TRONG QUY"
                  style={{ width: "100%", height: 32, fontSize: 12, padding: "0 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", outline: "none" }}
                />
              </div>
              <div style={{ width: 100 }}>
                <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>4 số cuối</label>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={cardForm.cardLast4}
                  onChange={e => setCardForm(f => ({ ...f, cardLast4: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                  placeholder="1549"
                  style={{ width: "100%", height: 32, fontSize: 12, padding: "0 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", outline: "none", textAlign: "center" as const, fontFamily: "monospace", letterSpacing: "2px" }}
                />
              </div>
              <button
                onClick={saveCard}
                disabled={cardSaving}
                style={{ height: 32, padding: "0 16px", borderRadius: 5, fontSize: 12, cursor: cardSaving ? "wait" : "pointer", border: "none", background: "var(--success)", color: "#fff", fontWeight: 600, opacity: cardSaving ? 0.6 : 1 }}
              >
                {cardSaving ? "⏳" : editingCardId ? "✓ Cập nhật" : "+ Thêm thẻ"}
              </button>
              {editingCardId && (
                <button
                  onClick={() => { setEditingCardId(null); setCardForm({ bankName: "", cardOwnerName: "", cardLast4: "" }) }}
                  style={{ height: 32, padding: "0 10px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}
                >Huỷ sửa</button>
              )}
            </div>

            {/* List cards */}
            <div style={{ flex: 1, overflowY: "auto" as const, border: "1px solid var(--border)", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ background: "var(--bg3)" }}>
                  <tr>
                    <th style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "left" as const, borderBottom: "1px solid var(--border)" }}>Ngân hàng</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "left" as const, borderBottom: "1px solid var(--border)" }}>Chủ thẻ</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "center" as const, borderBottom: "1px solid var(--border)", width: 120 }}>4 số cuối</th>
                    <th style={{ padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textAlign: "center" as const, borderBottom: "1px solid var(--border)", width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {cards.length === 0 ? (
                    <tr><td colSpan={4} style={{ padding: 30, textAlign: "center" as const, color: "var(--muted)" }}>
                      Chưa có thẻ nào. Thêm thẻ ở form bên trên ↑
                    </td></tr>
                  ) : cards.map(c => (
                    <tr key={c.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 500 }}>{c.bankName}</td>
                      <td style={{ padding: "8px 10px" }}>{c.cardOwnerName}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" as const, fontFamily: "monospace", letterSpacing: "2px", fontWeight: 600 }}>{c.cardLast4}</td>
                      <td style={{ padding: "8px 10px", textAlign: "center" as const, display: "flex", gap: 5, justifyContent: "center" }}>
                        <button onClick={() => startEditCard(c)} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--accent)" }}>✏ Sửa</button>
                        <button onClick={() => deleteCard(c.id, `${c.bankName} ****${c.cardLast4}`)} style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.4)", background: "transparent", color: "var(--danger)" }}>🗑</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>
                Tổng <strong>{cards.length}</strong> thẻ
              </span>
              <button onClick={() => setShowCardModal(false)} style={{ padding: "6px 18px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Push Notification Config */}
      {showPushConfig && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowPushConfig(false) }}
          style={{ position: "fixed" as const, inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: 520, maxWidth: "100%", padding: 22, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>🔔 Push Notification (PWA)</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                  Nhận cảnh báo billing trực tiếp trên màn hình (giống app native).<br/>
                  Hỗ trợ Chrome/Edge/Firefox + iOS Safari 16.4+ (cần cài app vào màn hình trước).
                </div>
              </div>
              <button onClick={() => setShowPushConfig(false)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", padding: 0, marginLeft: 12, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <PushSubscribeButton />
          </div>
        </div>
      )}

      {/* Modal Telegram Alert Config */}
      {showTgConfig && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !tgSaving) setShowTgConfig(false) }}
          style={{ position: "fixed" as const, inset: 0, background: "rgba(0,0,0,.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: 520, maxWidth: "100%", padding: 22, display: "flex", flexDirection: "column" as const, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>📱 Cấu hình Telegram Alert</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4, lineHeight: 1.6 }}>
                  Cảnh báo qua Telegram khi <b>balance/threshold ≥ 80%</b> + <b>threshold &gt; 2.000.000đ</b>.<br/>
                  Cron check 7h sáng VN mỗi ngày. Mỗi TKQC tối đa 1 alert/ngày.
                </div>
              </div>
              <button onClick={() => setShowTgConfig(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            <div style={{ background: "rgba(79,126,248,.06)", border: "1px solid rgba(79,126,248,.2)", borderRadius: 6, padding: "10px 12px", fontSize: 10, lineHeight: 1.5, color: "var(--muted)" }}>
              <strong>Cách lấy Chat ID:</strong><br/>
              1. Trong Telegram → search <code>@userinfobot</code> → bấm Start.<br/>
              2. Bot trả về số <code>Id: 123456789</code> — copy vào ô bên dưới.<br/>
              3. <strong>Quan trọng:</strong> Search bot Telegram của bạn (tạo bằng @BotFather, set TELEGRAM_BOT_TOKEN trên server) → bấm Start để bot có quyền gửi tin.
            </div>

            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, marginBottom: 4, display: "block" }}>Chat ID Telegram</label>
              <input value={tgChatId} onChange={e => setTgChatId(e.target.value)} placeholder="vd 123456789 (lấy từ @userinfobot)"
                style={{ width: "100%", height: 36, fontSize: 13, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "0 10px", outline: "none", fontFamily: "monospace" }} />
              <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>
                Để trống = tắt alert. Hiện tại: <strong style={{ color: tgChatIdSaved ? "var(--success)" : "var(--muted)" }}>{tgChatIdSaved || "chưa cấu hình"}</strong>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button onClick={testTgSend} disabled={tgTesting || !tgChatIdSaved} title={tgChatIdSaved ? "Gửi tin test" : "Lưu Chat ID trước khi test"}
                style={{ padding: "6px 12px", borderRadius: 5, fontSize: 11, cursor: (tgTesting || !tgChatIdSaved) ? "not-allowed" : "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--accent)", fontFamily: "inherit", opacity: (tgTesting || !tgChatIdSaved) ? 0.5 : 1 }}>
                {tgTesting ? "⏳ Đang gửi..." : "🧪 Test gửi tin"}
              </button>
              <button onClick={() => setShowTgConfig(false)} disabled={tgSaving} style={{ padding: "6px 14px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>Huỷ</button>
              <button onClick={saveTgConfig} disabled={tgSaving} style={{ padding: "6px 18px", borderRadius: 5, fontSize: 11, cursor: tgSaving ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontWeight: 600, fontFamily: "inherit" }}>
                {tgSaving ? "Đang lưu..." : "💾 Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

const billingTh: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: ".4px",
  color: "var(--muted)",
  fontWeight: 600,
  textAlign: "center" as const,
  whiteSpace: "nowrap" as const,
  borderBottom: "1px solid var(--border)",
}

const billingTd: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "center" as const,
  whiteSpace: "nowrap" as const,
  fontSize: 12,
}
