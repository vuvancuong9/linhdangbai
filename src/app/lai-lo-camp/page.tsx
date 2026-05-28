"use client"
import { useEffect, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"
import { useConfirm } from "@/components/Confirm"
import { useIsMobile } from "@/hooks/useIsMobile"

// Trang Lai/Lo Camp: hien top 100 lai nhat + 100 lo nhat cua N ngay gan day.
// Chi hien camp dang BAT (status=on). Co bulk select de tat hang loat va doi budget hang loat.

type Daily = { date: string; dayOffset: number; commission: number; spend: number; pl: number }
type Row = {
  id: string
  name: string
  campId: string
  status: string
  budget: number
  adAccountId: string | null
  pageName: string
  daily: Daily[]
  totalPL: number
  hasAnyData: boolean
}
type Resp = {
  days: number
  dates: string[]
  totalCamps: number
  activeCamps: number
  rows: Row[]
  fbErrors: string[]
}

const DEFAULT_BUDGET = 100000
const DEFAULT_BUDGET_STR = "100.000"

// Format so VND voi dau cham hang nghin: 100000 -> "100.000"
function fmtThousands(s: string | number): string {
  const digits = String(s).replace(/[^\d]/g, "")
  if (!digits) return ""
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")
}
// Parse string "100.000" -> 100000
function parseThousands(s: string): number {
  const digits = String(s).replace(/[^\d]/g, "")
  return digits ? Number(digits) : 0
}

function fmtVnd(n: number): string {
  if (!Number.isFinite(n)) return "—"
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (abs >= 1_000) return (n / 1_000).toFixed(1) + "k"
  return n.toLocaleString("vi-VN")
}
function fmtSign(n: number): string {
  if (!Number.isFinite(n)) return "—"
  if (n === 0) return "0"
  return (n > 0 ? "+" : "") + fmtVnd(n)
}
function fmtDateShort(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? `${m[3]}/${m[2]}` : s
}

export default function LaiLoCampPage() {
  const isMobile = useIsMobile()
  const toast = useToast()
  const { ask } = useConfirm()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [days, setDays] = useState(3)
  const [togglingId, setTogglingId] = useState<string>("")
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc")
  const [sortBy, setSortBy] = useState<"pl" | "spend">("spend")
  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBudget, setBulkBudget] = useState<string>(DEFAULT_BUDGET_STR)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; ok: number; fail: number } | null>(null)
  // Range select (Tu STT X -> Y)
  const [rangeFrom, setRangeFrom] = useState<string>("1")
  const [rangeTo, setRangeTo] = useState<string>("20")
  // Auto-manage (cron 9h sang daily)
  const [autoManage, setAutoManage] = useState<{
    enabled: boolean
    lastRunAt: string | null
    lastOffCount: number
    lastBudgetUpCount: number
    lastError: string | null
    rules: { daysWindow: number; lossThreshold: number; profitThreshold: number; budgetMultiplier: number }
  } | null>(null)
  const [autoManageBusy, setAutoManageBusy] = useState(false)
  // Auto-manage per-fanpage config modal
  const [showAutoConfig, setShowAutoConfig] = useState(false)
  const [autoConfigPages, setAutoConfigPages] = useState<Array<{ id: string; name: string; pageId: string; autoBudgetUpThreshold: number | null; autoOffThreshold: number | null }>>([])
  const [autoConfigDrafts, setAutoConfigDrafts] = useState<Record<string, { up: string; off: string }>>({})
  const [autoConfigSearch, setAutoConfigSearch] = useState("")
  const [autoConfigBulk, setAutoConfigBulk] = useState({ up: "", off: "" })
  const [autoConfigSaving, setAutoConfigSaving] = useState(false)
  const [autoConfigSelected, setAutoConfigSelected] = useState<Set<string>>(new Set())

  async function loadAutoConfigPages() {
    try {
      const r = await fetch("/api/pages/auto-manage-config", { credentials: "include" })
      if (!r.ok) throw new Error("HTTP " + r.status)
      const d = await r.json()
      setAutoConfigPages(d.pages || [])
      // Build drafts từ data hiện tại
      const drafts: Record<string, { up: string; off: string }> = {}
      for (const p of (d.pages || [])) {
        drafts[p.id] = {
          up: p.autoBudgetUpThreshold != null ? String(p.autoBudgetUpThreshold) : "",
          off: p.autoOffThreshold != null ? String(p.autoOffThreshold) : "",
        }
      }
      setAutoConfigDrafts(drafts)
    } catch (e: any) {
      toast.show("❌ Load fanpage lỗi: " + (e?.message || "unknown"), "error" as any)
    }
  }

  function applyAutoConfigBulk() {
    const up = autoConfigBulk.up.trim()
    const off = autoConfigBulk.off.trim()
    if (!up && !off) {
      toast.show("Nhập ít nhất 1 ô (Tăng budget % hoặc Tắt %)", "warn" as any)
      return
    }
    if (autoConfigSelected.size === 0) {
      toast.show("Chưa tích chọn fanpage nào ở cột checkbox", "warn" as any)
      return
    }
    setAutoConfigDrafts(prev => {
      const next = { ...prev }
      for (const p of autoConfigPages) {
        if (!autoConfigSelected.has(p.id)) continue
        next[p.id] = {
          up: up || next[p.id]?.up || "",
          off: off || next[p.id]?.off || "",
        }
      }
      return next
    })
    toast.show(`✅ Đã áp cho ${autoConfigSelected.size} fanpage đã chọn`, "success" as any)
  }

  async function saveAutoConfig() {
    if (autoConfigSaving) return
    setAutoConfigSaving(true)
    try {
      const updates = autoConfigPages.map(p => {
        const d = autoConfigDrafts[p.id] || { up: "", off: "" }
        return {
          pageId: p.id,
          autoBudgetUpThreshold: d.up.trim() === "" ? null : Number(d.up),
          autoOffThreshold: d.off.trim() === "" ? null : Number(d.off),
        }
      })
      const r = await fetch("/api/pages/auto-manage-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ updates }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "HTTP " + r.status)
      toast.show(`✅ Đã lưu ${d.updated}/${updates.length} fanpage`, "success" as any)
      setShowAutoConfig(false)
      // Reload để hiện data mới
      loadAutoConfigPages()
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi save"), "error" as any)
    } finally { setAutoConfigSaving(false) }
  }

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/campaigns/profit-loss?days=${days}`, { credentials: "include", cache: "no-store" })
      if (r.ok) {
        const d: Resp = await r.json()
        setData(d)
        setSelected(new Set())
      } else {
        const e = await r.json().catch(() => ({}))
        toast.show("❌ " + (e?.error || "HTTP " + r.status), "error" as any)
      }
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Loi"), "error" as any)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchAutoManage() {
    try {
      const r = await fetch("/api/user/auto-manage", { credentials: "include", cache: "no-store" })
      if (r.ok) setAutoManage(await r.json())
    } catch {}
  }
  useEffect(() => { fetchAutoManage() }, [])

  async function toggleAutoManage() {
    if (autoManageBusy || !autoManage) return
    const next = !autoManage.enabled
    setAutoManageBusy(true)
    try {
      const r = await fetch("/api/user/auto-manage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: next }),
      })
      if (!r.ok) throw new Error("HTTP " + r.status)
      setAutoManage(prev => prev ? { ...prev, enabled: next } : prev)
      toast.show(next ? "🤖 Auto-manage ĐÃ BẬT — chạy 9h sáng mỗi ngày" : "Auto-manage ĐÃ TẮT", "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Loi"), "error" as any)
    } finally {
      setAutoManageBusy(false)
    }
  }

  // Chi giu camp status = on (yeu cau user)
  const onRows = (data?.rows || []).filter(r => r.status === "on")
  const sortedRows = onRows.slice().sort((a, b) => {
    if (sortBy === "spend") {
      const sa = a.daily.reduce((s, d) => s + (d.spend || 0), 0)
      const sb = b.daily.reduce((s, d) => s + (d.spend || 0), 0)
      return sortDir === "desc" ? sb - sa : sa - sb
    }
    return sortDir === "desc" ? b.totalPL - a.totalPL : a.totalPL - b.totalPL
  })
  const dates = data?.dates || []

  const allSelected = sortedRows.length > 0 && sortedRows.every(r => selected.has(r.id))
  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(sortedRows.map(r => r.id)))
  }
  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }
  function selectRange() {
    const from = Math.max(1, Math.floor(Number(rangeFrom) || 0))
    const to = Math.max(from, Math.floor(Number(rangeTo) || 0))
    if (!from || !to) {
      toast.show("Nhap STT hop le", "error" as any)
      return
    }
    // STT 1-based -> index 0-based
    const ids = sortedRows.slice(from - 1, to).map(r => r.id)
    if (ids.length === 0) {
      toast.show("Khong co camp nao trong khoang STT do", "error" as any)
      return
    }
    setSelected(new Set(ids))
  }

  async function saveBudget(row: Row, value: number) {
    if (!row.campId) {
      toast.show("Camp chua co campId tu FB, khong update duoc", "error" as any)
      return false
    }
    if (value <= 0) {
      toast.show("Budget phai > 0", "error" as any)
      return false
    }
    try {
      const r = await fetch("/api/fb/update-budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campId: row.campId, dailyBudget: value }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status)
      setData(prev => prev ? { ...prev, rows: prev.rows.map(x => x.id === row.id ? { ...x, budget: value } : x) } : prev)
      return true
    } catch (e: any) {
      console.error("saveBudget fail", row.name, e?.message)
      return false
    }
  }

  async function toggleStatus(row: Row) {
    if (!row.campId) {
      toast.show("Camp chua co campId tu FB", "error" as any)
      return
    }
    const newStatus = row.status === "on" ? "off" : "on"
    if (newStatus === "off" && !await ask(`Tat camp "${row.name}"?`, { title: "Xac nhan tat camp", danger: true, okText: "Tắt" })) return
    setTogglingId(row.id)
    try {
      const r = await fetch("/api/fb/toggle-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ campId: row.campId, status: newStatus }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status)
      if (d?.deleted) {
        setData(prev => prev ? { ...prev, rows: prev.rows.filter(x => x.id !== row.id) } : prev)
        setSelected(prev => { const n = new Set(prev); n.delete(row.id); return n })
        toast.show("🧹 Camp đã bị xoá trên FB → đã dọn khỏi danh sách", "warn" as any)
      } else {
        setData(prev => prev ? { ...prev, rows: prev.rows.map(x => x.id === row.id ? { ...x, status: newStatus } : x) } : prev)
        setSelected(prev => { const n = new Set(prev); n.delete(row.id); return n })
        toast.show(newStatus === "on" ? "✅ Da BAT camp" : "✅ Da TAT camp", "success" as any)
      }
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Loi"), "error" as any)
    } finally {
      setTogglingId("")
    }
  }

  async function bulkOff() {
    if (selected.size === 0) return
    if (!await ask(`Tat ${selected.size} camp duoc chon?`, { title: "Xac nhan TAT hang loat", danger: true, okText: "Tắt" })) return
    const ids = Array.from(selected)
    const target = sortedRows.filter(r => ids.includes(r.id) && r.campId)
    setBulkBusy(true)
    setBulkProgress({ done: 0, total: target.length, ok: 0, fail: 0 })
    let ok = 0, fail = 0, cleaned = 0
    const failDetails: string[] = []
    for (let i = 0; i < target.length; i++) {
      const row = target[i]
      try {
        const r = await fetch("/api/fb/toggle-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ campId: row.campId, status: "off" }),
        })
        const d = await r.json().catch(() => ({}))
        if (r.ok) {
          if (d?.deleted) {
            cleaned++
            setData(prev => prev ? { ...prev, rows: prev.rows.filter(x => x.id !== row.id) } : prev)
          } else {
            ok++
            setData(prev => prev ? { ...prev, rows: prev.rows.map(x => x.id === row.id ? { ...x, status: "off" } : x) } : prev)
          }
        } else {
          fail++
          const reason = d?.error || `HTTP ${r.status}`
          failDetails.push(`${row.name}: ${reason}`)
          console.warn(`[bulkOff] ${row.name} (${row.campId}) → ${reason}`)
        }
      } catch (e: any) {
        fail++
        failDetails.push(`${row.name}: ${e?.message || "network error"}`)
      }
      setBulkProgress({ done: i + 1, total: target.length, ok: ok + cleaned, fail })
    }
    const baseMsg = `✅ Tắt ${ok}/${target.length} camp` + (cleaned > 0 ? ` · 🧹 dọn ${cleaned} camp đã xoá trên FB` : "") + (fail > 0 ? ` · ❌ lỗi ${fail}` : "")
    const detailMsg = failDetails.length > 0 ? "\n" + failDetails.slice(0, 3).join("\n") + (failDetails.length > 3 ? `\n…và ${failDetails.length - 3} lỗi khác` : "") : ""
    toast.show(baseMsg + detailMsg, fail > 0 ? "error" as any : "success" as any)
    setSelected(new Set())
    setBulkBusy(false)
    setTimeout(() => setBulkProgress(null), 2000)
  }

  async function bulkApplyBudget() {
    if (selected.size === 0) return
    const v = parseThousands(bulkBudget)
    if (v <= 0) {
      toast.show("Budget phai > 0", "error" as any)
      return
    }
    if (!await ask(`Doi budget ${selected.size} camp ve ${fmtVnd(v)}?`, { title: "Xac nhan doi budget hang loat" })) return
    const ids = Array.from(selected)
    const target = sortedRows.filter(r => ids.includes(r.id) && r.campId)
    setBulkBusy(true)
    setBulkProgress({ done: 0, total: target.length, ok: 0, fail: 0 })
    let ok = 0, fail = 0
    for (let i = 0; i < target.length; i++) {
      const row = target[i]
      const success = await saveBudget(row, v)
      if (success) ok++; else fail++
      setBulkProgress({ done: i + 1, total: target.length, ok, fail })
    }
    toast.show(`✅ Da doi budget ${ok}/${target.length} camp${fail > 0 ? ` · loi ${fail}` : ""}`, fail > 0 ? "error" as any : "success" as any)
    setBulkBusy(false)
    setTimeout(() => setBulkProgress(null), 2000)
  }

  // ===== MOBILE LAYOUT =====
  if (isMobile) {
    const totalProfit = sortedRows.filter(r => r.totalPL > 0).reduce((s, r) => s + r.totalPL, 0)
    const totalLoss = sortedRows.filter(r => r.totalPL < 0).reduce((s, r) => s + r.totalPL, 0)
    const totalNet = totalProfit + totalLoss

    // Mobile filter: top lãi (desc), top lỗ (asc), tất cả (default sort).
    const sortedRowsMobile = sortBy === "pl"
      ? sortedRows
      : [...sortedRows].sort((a, b) => sortDir === "desc" ? b.totalPL - a.totalPL : a.totalPL - b.totalPL)

    return (
      <AppLayout>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -.4 }}>Lãi/Lỗ Camp</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>{data?.activeCamps ?? 0} camp ON • {days} ngày qua</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setShowAutoConfig(true)}
              style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--bg3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: "pointer" }}>⚙️</button>
            <button onClick={load} disabled={loading}
              style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--bg3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, cursor: loading ? "wait" : "pointer", opacity: loading ? .5 : 1 }}>🔄</button>
          </div>
        </div>

        {/* 3 summary cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
          <div style={{ background: "var(--bg2)", borderRadius: 12, padding: "12px 10px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Tổng lãi</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: "var(--success)" }}>{fmtSign(totalProfit)}</div>
          </div>
          <div style={{ background: "var(--bg2)", borderRadius: 12, padding: "12px 10px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Tổng lỗ</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: "var(--danger)" }}>{fmtSign(totalLoss)}</div>
          </div>
          <div style={{ background: "var(--bg2)", borderRadius: 12, padding: "12px 10px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: .5 }}>Net</div>
            <div style={{ fontSize: 17, fontWeight: 800, marginTop: 3, color: totalNet >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtSign(totalNet)}</div>
          </div>
        </div>

        {/* Segmented control */}
        <div style={{ display: "flex", background: "var(--bg2)", borderRadius: 12, padding: 4, boxShadow: "0 1px 3px rgba(0,0,0,.06)", marginBottom: 12 }}>
          {[
            { key: "topProfit", label: "Top lãi", onClick: () => { setSortBy("pl"); setSortDir("desc") } },
            { key: "topLoss", label: "Top lỗ", onClick: () => { setSortBy("pl"); setSortDir("asc") } },
            { key: "all", label: "Tất cả", onClick: () => { setSortBy("spend"); setSortDir("desc") } },
          ].map((tab) => {
            const isActive = (tab.key === "topProfit" && sortBy === "pl" && sortDir === "desc")
              || (tab.key === "topLoss" && sortBy === "pl" && sortDir === "asc")
              || (tab.key === "all" && sortBy === "spend")
            return (
              <button key={tab.key} onClick={tab.onClick}
                style={{ flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 600, border: "none", background: isActive ? "var(--text)" : "transparent", color: isActive ? "var(--bg)" : "var(--muted)", borderRadius: 9, cursor: "pointer", fontFamily: "inherit" }}>
                {tab.label}
              </button>
            )
          })}
        </div>

        {/* Auto-manage banner — autoManage có thể null trước khi load xong */}
        {(() => {
          const amEnabled = !!autoManage?.enabled
          return (
            <div style={{ background: amEnabled ? "linear-gradient(135deg, rgba(22,163,74,.08), rgba(22,163,74,.02))" : "rgba(0,0,0,.03)", padding: "12px 14px", border: `1px solid ${amEnabled ? "rgba(22,163,74,.2)" : "var(--border)"}`, borderRadius: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 10, background: amEnabled ? "var(--success)" : "var(--muted)", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700 }}>Auto-manage: {amEnabled ? "BẬT" : "TẮT"}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {amEnabled ? `Cron 13h • Tắt ${autoManage?.lastOffCount ?? 0} • Tăng budget ${autoManage?.lastBudgetUpCount ?? 0}` : "Bấm để bật auto tắt camp lỗ / tăng budget camp lãi"}
                </div>
              </div>
              <button onClick={toggleAutoManage} disabled={autoManageBusy}
                style={{ width: 44, height: 26, borderRadius: 13, background: amEnabled ? "var(--success)" : "var(--muted)", border: "none", cursor: autoManageBusy ? "wait" : "pointer", position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 3, [amEnabled ? "right" : "left"]: 3, width: 20, height: 20, background: "white", borderRadius: "50%", boxShadow: "0 1px 2px rgba(0,0,0,.2)" } as any} />
              </button>
            </div>
          )
        })()}

        {/* Camp cards */}
        {loading && sortedRowsMobile.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>⏳ Đang tải...</div>
        ) : sortedRowsMobile.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Không có camp nào ≥ 100k ads {days} ngày qua.</div>
        ) : sortedRowsMobile.slice(0, 100).map((r) => {
          const isOn = r.status === "on"
          const dailyShown = r.daily.slice(0, 3)
          return (
            <div key={r.id} style={{ background: "var(--bg2)", borderRadius: 14, padding: 14, marginBottom: 10, boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: isOn ? "var(--success)" : "var(--muted)", boxShadow: isOn ? "0 0 0 3px rgba(22,163,74,.15)" : "0 0 0 3px rgba(0,0,0,.05)", flexShrink: 0 }} />
                <div style={{ fontSize: 15, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                <button onClick={() => toggleStatus(r)} disabled={togglingId === r.id}
                  style={{ width: 44, height: 26, borderRadius: 13, background: isOn ? "var(--success)" : "var(--muted)", border: "none", cursor: togglingId === r.id ? "wait" : "pointer", position: "relative", flexShrink: 0, opacity: togglingId === r.id ? .5 : 1 }}>
                  <span style={{ position: "absolute", top: 3, [isOn ? "right" : "left"]: 3, width: 20, height: 20, background: "white", borderRadius: "50%", boxShadow: "0 1px 2px rgba(0,0,0,.2)" } as any} />
                </button>
              </div>
              <div style={{ display: "inline-block", fontSize: 11, padding: "2px 8px", background: r.pageName ? "rgba(79,126,248,.1)" : "var(--bg3)", color: r.pageName ? "var(--accent)" : "var(--muted)", borderRadius: 10, fontWeight: 600, marginBottom: 10 }}>
                {r.pageName || "— chưa gán page"}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${dailyShown.length}, 1fr)`, gap: 8 }}>
                {dailyShown.map((d, i) => (
                  <div key={i} style={{ background: "var(--bg3)", borderRadius: 10, padding: 8, textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>D{d.dayOffset} {fmtDateShort(d.date)}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, color: d.pl > 0 ? "var(--success)" : d.pl < 0 ? "var(--danger)" : "var(--text)" }}>{fmtSign(d.pl)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>NS/ngày: <b style={{ color: "var(--text)" }}>{fmtVnd(r.budget)}</b></div>
                <div style={{ fontSize: 16, fontWeight: 800, color: r.totalPL > 0 ? "var(--success)" : r.totalPL < 0 ? "var(--danger)" : "var(--text)" }}>{fmtSign(r.totalPL)}</div>
              </div>
            </div>
          )
        })}
        {sortedRowsMobile.length > 100 && (
          <div style={{ padding: 12, textAlign: "center", color: "var(--muted)", fontSize: 11 }}>
            Hiển thị 100/{sortedRowsMobile.length} camp. Vào desktop để xem tất cả.
          </div>
        )}
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>💰 Lãi/Lỗ Camp</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              Hiện tất cả camp <strong>BẬT</strong> có tổng ads {days} ngày &gt; 100k.
              Cron 13h: rule theo ngưỡng <strong>ads/hh</strong> cấu hình per fanpage.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              onClick={toggleAutoManage}
              disabled={autoManageBusy || !autoManage}
              title={autoManage?.enabled
                ? "Auto-manage ĐANG BẬT — click để TẮT. Cron chạy 13h chiều VN mỗi ngày."
                : "Auto-manage ĐANG TẮT — click để BẬT. Sẽ tự TẮT camp lỗ 3 ngày + tăng budget 30% camp lãi 3 ngày."}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 5, fontSize: 11,
                cursor: autoManageBusy ? "wait" : "pointer", border: "none", fontFamily: "inherit", fontWeight: 600,
                background: autoManage?.enabled ? "var(--success)" : "var(--bg3)",
                color: autoManage?.enabled ? "#fff" : "var(--muted)",
                height: 28, opacity: autoManageBusy || !autoManage ? 0.6 : 1,
              }}
            >
              🤖 Auto-manage: {autoManage?.enabled ? "BẬT" : "TẮT"}
            </button>
            <button
              onClick={() => { setShowAutoConfig(true); loadAutoConfigPages() }}
              title="Cấu hình ngưỡng ads/hh tăng budget / tắt camp theo từng Fanpage"
              style={{
                display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 5, fontSize: 11,
                cursor: "pointer", border: "1px solid var(--border2)", fontFamily: "inherit", fontWeight: 500,
                background: "var(--bg3)", color: "var(--text)", height: 28,
              }}
            >
              ⚙️ Cấu hình Auto-manage
            </button>
            <span style={{ height: 28, padding: "0 10px", display: "inline-flex", alignItems: "center", borderRadius: 5, fontSize: 11, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--muted)" }}>
              3 ngày
            </span>
            <button onClick={load} disabled={loading} style={{ padding: "0 12px", height: 28, borderRadius: 5, fontSize: 11, cursor: loading ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
              {loading ? "⏳ Đang tải..." : "🔄 Refresh"}
            </button>
          </div>
        </div>

        {autoManage?.enabled && (
          <div style={{ background: "rgba(46,204,143,.08)", border: "1px solid rgba(46,204,143,.25)", borderRadius: 6, padding: "8px 12px", fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
            🤖 <strong>Auto-manage ĐANG BẬT</strong> · Chạy 13h chiều VN mỗi ngày.
            {autoManage.lastRunAt && (
              <span style={{ color: "var(--muted)", marginLeft: "auto" }}>
                Lần chạy gần nhất: <strong>{new Date(autoManage.lastRunAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong>
                {" · "}Tắt: <strong>{autoManage.lastOffCount}</strong>
                {" · "}Tăng budget: <strong>{autoManage.lastBudgetUpCount}</strong>
                {autoManage.lastError && <span style={{ color: "var(--danger)", marginLeft: 6 }}>⚠ {autoManage.lastError}</span>}
              </span>
            )}
          </div>
        )}

        {data?.fbErrors && data.fbErrors.length > 0 && (
          <div style={{ background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", borderRadius: 6, padding: "8px 12px", fontSize: 11, color: "var(--warn)" }}>
            ⚠ FB API lỗi 1 vài TKQC: {data.fbErrors.join(" · ")}
          </div>
        )}

        {data && (
          <div style={{ fontSize: 11, color: "var(--muted)" }}>
            Tổng: <strong>{data.totalCamps}</strong> camps · Lọc tổng ads &gt; 100k: <strong>{data.activeCamps}</strong> · Status ON: <strong>{onRows.length}</strong> · Sort: <strong style={{ color: "var(--text)" }}>{sortBy === "spend" ? "Tổng ads" : "Lãi/Lỗ"} {sortDir === "desc" ? "↓" : "↑"}</strong>
          </div>
        )}

        {/* Toolbar luon hien: Chon tat ca / Range select */}
        {sortedRows.length > 0 && (
          <div style={{ padding: "8px 12px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const, fontSize: 11 }}>
            <span style={{ color: "var(--muted)" }}>{sortedRows.length} camp ON</span>
            <button onClick={toggleAll} style={{ padding: "4px 10px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit" }}>
              {allSelected ? "Bỏ chọn tất cả" : "Chọn tất cả"}
            </button>
            <div style={{ width: 1, height: 18, background: "var(--border)" }} />
            <span style={{ color: "var(--muted)" }}>Từ STT</span>
            <input
              type="number"
              min={1}
              value={rangeFrom}
              onChange={e => setRangeFrom(e.target.value)}
              style={{ width: 60, height: 26, padding: "0 6px", borderRadius: 4, fontSize: 11, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontFamily: "inherit", outline: "none" }}
            />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input
              type="number"
              min={1}
              value={rangeTo}
              onChange={e => setRangeTo(e.target.value)}
              style={{ width: 60, height: 26, padding: "0 6px", borderRadius: 4, fontSize: 11, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontFamily: "inherit", outline: "none" }}
            />
            <button onClick={selectRange} style={{ padding: "4px 12px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
              Chọn
            </button>
            {selected.size > 0 && (
              <>
                <div style={{ width: 1, height: 18, background: "var(--border)" }} />
                <span style={{ color: "var(--accent)", fontWeight: 600 }}>{selected.size} đã chọn</span>
              </>
            )}
          </div>
        )}

        {/* Bulk action bar */}
        {selected.size > 0 && (
          <div style={{ padding: "8px 12px", background: "rgba(79,126,248,.08)", border: "1px solid rgba(79,126,248,.25)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" as const }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)" }}>
              {selected.size} camp đã chọn
              {bulkProgress && <span style={{ marginLeft: 10, color: "var(--muted)", fontWeight: 400 }}>· {bulkProgress.done}/{bulkProgress.total} (✓ {bulkProgress.ok} · ✗ {bulkProgress.fail})</span>}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const }}>
              <input
                type="text"
                inputMode="numeric"
                value={bulkBudget}
                onChange={e => setBulkBudget(fmtThousands(e.target.value))}
                disabled={bulkBusy}
                placeholder="100.000"
                style={{ width: 110, height: 28, padding: "0 8px", borderRadius: 5, fontSize: 11, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontFamily: "inherit", outline: "none", textAlign: "right" as const }}
              />
              <button onClick={bulkApplyBudget} disabled={bulkBusy} style={{ padding: "0 12px", height: 28, borderRadius: 5, fontSize: 11, cursor: bulkBusy ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: bulkBusy ? 0.6 : 1 }}>
                💵 Đổi budget loạt
              </button>
              <button onClick={bulkOff} disabled={bulkBusy} style={{ padding: "0 12px", height: 28, borderRadius: 5, fontSize: 11, cursor: bulkBusy ? "wait" : "pointer", border: "none", background: "var(--danger)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: bulkBusy ? 0.6 : 1 }}>
                ⏸ Tắt loạt
              </button>
              <button onClick={() => setSelected(new Set())} disabled={bulkBusy} style={{ padding: "0 10px", height: 28, borderRadius: 5, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>
                Bỏ chọn
              </button>
            </div>
          </div>
        )}

        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, tableLayout: "auto" }}>
            <thead style={{ background: "var(--bg3)" }}>
              <tr>
                <th style={{ ...thStyle, width: 32 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    style={{ cursor: "pointer" }}
                  />
                </th>
                <th style={thStyle}>STT</th>
                <th style={{ ...thStyle, textAlign: "left" as const, minWidth: 110 }}>Tên Camp</th>
                <th style={{ ...thStyle, textAlign: "left" as const, minWidth: 120 }}>Fanpage</th>
                <th style={thStyle}>Trạng thái</th>
                <th style={thStyle}>NS/ngày</th>
                {dates.map((d, idx) => (
                  <th key={d} style={thStyle} title={d}>
                    ADS/HH D{idx}
                    <div style={{ fontSize: 9, fontWeight: 400, color: "var(--muted)" }}>{fmtDateShort(d)}</div>
                  </th>
                ))}
                <th
                  onClick={() => {
                    if (sortBy === "spend") setSortDir(d => d === "desc" ? "asc" : "desc")
                    else { setSortBy("spend"); setSortDir("desc") }
                  }}
                  style={{ ...thStyle, cursor: "pointer", background: sortBy === "spend" ? "rgba(232,77,45,.08)" : "rgba(79,126,248,.08)" }}
                  title="Click để sort theo Tổng ads. Click lại để đổi chiều."
                >
                  Tổng ads (D0→D{days - 1}) {sortBy === "spend" ? (sortDir === "desc" ? "↓" : "↑") : "↕"}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 && !loading && (
                <tr><td colSpan={7 + dates.length} style={{ padding: 32, textAlign: "center" as const, color: "var(--muted)" }}>
                  Chưa có camp BẬT nào có data trong {days} ngày gần đây.
                </td></tr>
              )}
              {sortedRows.map((r, i) => {
                const isToggling = togglingId === r.id
                const isChecked = selected.has(r.id)
                // Tổng spend D0→D(n-1)
                const totalSpend = r.daily.reduce((s, d) => s + (d.spend || 0), 0)
                // Màu ADS/HH theo rule chuẩn (giống quan-ly-campaign): <66% xanh, 66-110% vàng, >110% đỏ
                const ahColor = (ah: number | null) => ah == null ? "var(--muted)" : ah > 110 ? "var(--danger)" : ah >= 66 ? "var(--warn)" : "var(--success)"
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)", background: isChecked ? "rgba(79,126,248,.04)" : "transparent" }}>
                    <td style={tdStyle}>
                      <input type="checkbox" checked={isChecked} onChange={() => toggleOne(r.id)} style={{ cursor: "pointer" }} />
                    </td>
                    <td style={tdStyle}>{i + 1}</td>
                    <td style={{ ...tdStyle, textAlign: "left" as const, fontWeight: 500 }}>{r.name}</td>
                    <td style={{ ...tdStyle, textAlign: "left" as const, color: r.pageName ? "var(--muted)" : "var(--border2)", fontSize: 10 }} title={r.pageName || "Camp chưa có Post → không xác định được Fanpage"}>
                      {r.pageName || "—"}
                    </td>
                    <td style={tdStyle}>
                      <button
                        onClick={() => toggleStatus(r)}
                        disabled={isToggling}
                        title="Click để TẮT camp này (gọi FB API)"
                        style={{
                          fontSize: 10, padding: "2px 10px", borderRadius: 3, fontWeight: 600,
                          cursor: isToggling ? "wait" : "pointer",
                          border: "none",
                          color: r.status === "on" ? "var(--success)" : "var(--muted)",
                          background: r.status === "on" ? "rgba(46,204,143,.12)" : "var(--bg3)",
                          fontFamily: "inherit",
                          opacity: isToggling ? 0.6 : 1,
                        }}
                      >
                        {isToggling ? "..." : (r.status === "on" ? "ON" : (r.status || "OFF").toUpperCase())}
                      </button>
                    </td>
                    <td style={tdStyle}>{fmtVnd(r.budget)}</td>
                    {r.daily.map(d => {
                      // ads/hh = spend / commission × 100; null nếu commission=0 (chia 0)
                      const ah = d.commission > 0 ? Math.round((d.spend / d.commission) * 1000) / 10 : null
                      return (
                        <td key={d.date} style={{ ...tdStyle, color: ahColor(ah), fontWeight: 500 }} title={`HH: ${fmtVnd(d.commission)} · Spend: ${fmtVnd(d.spend)}`}>
                          {ah == null ? "—" : (ah > 999 ? ">999%" : ah + "%")}
                        </td>
                      )
                    })}
                    <td style={{ ...tdStyle, fontWeight: 700, color: "var(--danger)" }} title={`Tổng chi phí ads ${days} ngày`}>
                      {fmtVnd(totalSpend)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Cấu hình Auto-manage per-fanpage */}
      {showAutoConfig && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !autoConfigSaving) setShowAutoConfig(false) }}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",padding:12}}>
          <div className="app-modal" style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:760,maxWidth:"100%",maxHeight:"90vh",padding:18,display:"flex",flexDirection:"column" as const,gap:10}}>
            <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:15,fontWeight:600}}>⚙️ Cấu hình Auto-manage theo Fanpage</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:4,lineHeight:1.5}}>
                  Mỗi fanpage có 2 ngưỡng ads/hh. Cron 13h chiều kiểm tra camp:<br/>
                  • <strong>Tăng budget x1.3</strong> nếu ads/hh 3 ngày <strong>&lt; "Tăng %"</strong> + tổng ads &gt; 100k.<br/>
                  • <strong>Tắt camp</strong> nếu ads/hh 3 ngày <strong>&gt; "Tắt %"</strong> + tổng ads &gt; 100k.<br/>
                  • Bỏ trống = SKIP (không động camp của fanpage).<br/>
                  • <span style={{color:"#9b59b6"}}>Camp KHÔNG có fanpage</span> → dùng default <strong>Tăng &lt;65%</strong> / <strong>Tắt &gt;110%</strong>.
                </div>
              </div>
              {!autoConfigSaving && <button onClick={()=>setShowAutoConfig(false)} style={{background:"transparent",border:"none",color:"var(--muted)",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>}
            </div>

            {/* Bulk apply - apply cho cac fanpage da tich checkbox */}
            <div style={{display:"flex",gap:8,alignItems:"center",padding:"8px 10px",background:"rgba(79,126,248,.06)",border:"1px solid rgba(79,126,248,.2)",borderRadius:6,flexWrap:"wrap" as const}}>
              <span style={{fontSize:11,fontWeight:600,color:"var(--accent)"}}>📋 Áp hàng loạt:</span>
              <label style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:4}}>
                Tăng &lt;
                <input
                  type="number"
                  placeholder="60"
                  value={autoConfigBulk.up}
                  onChange={e => setAutoConfigBulk(c => ({ ...c, up: e.target.value }))}
                  style={{width:60,height:26,fontSize:11,padding:"0 6px",borderRadius:4,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text)",outline:"none",textAlign:"right" as const}}
                />%
              </label>
              <label style={{fontSize:11,color:"var(--muted)",display:"flex",alignItems:"center",gap:4}}>
                Tắt &gt;
                <input
                  type="number"
                  placeholder="110"
                  value={autoConfigBulk.off}
                  onChange={e => setAutoConfigBulk(c => ({ ...c, off: e.target.value }))}
                  style={{width:60,height:26,fontSize:11,padding:"0 6px",borderRadius:4,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text)",outline:"none",textAlign:"right" as const}}
                />%
              </label>
              <button onClick={applyAutoConfigBulk} disabled={autoConfigSelected.size === 0} title={autoConfigSelected.size === 0 ? "Tích chọn fanpage ở cột checkbox trước" : `Áp cho ${autoConfigSelected.size} fanpage đã chọn`} style={{padding:"4px 10px",fontSize:11,borderRadius:4,border:"none",background:autoConfigSelected.size===0?"var(--bg3)":"var(--accent)",color:autoConfigSelected.size===0?"var(--muted)":"#fff",cursor:autoConfigSelected.size===0?"not-allowed":"pointer",fontFamily:"inherit",fontWeight:500}}>
                Áp {autoConfigSelected.size > 0 ? `${autoConfigSelected.size} đã chọn` : "hàng loạt"}
              </button>
            </div>

            <input
              type="text"
              placeholder="Tìm fanpage theo tên..."
              value={autoConfigSearch}
              onChange={e => setAutoConfigSearch(e.target.value)}
              style={{height:32,fontSize:11,padding:"0 10px",borderRadius:6,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text)",outline:"none"}}
            />

            <div style={{flex:1,overflowY:"auto" as const,border:"1px solid var(--border)",borderRadius:6}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky" as const,top:0,background:"var(--bg3)",zIndex:1}}>
                  <tr>
                    <th style={{padding:"7px 10px",textAlign:"center" as const,fontSize:10,fontWeight:600,color:"var(--muted)",borderBottom:"1px solid var(--border)",width:36}}>
                      {(() => {
                        const visiblePages = autoConfigPages.filter(p => !autoConfigSearch.trim() || p.name.toLowerCase().includes(autoConfigSearch.trim().toLowerCase()))
                        const allChecked = visiblePages.length > 0 && visiblePages.every(p => autoConfigSelected.has(p.id))
                        return (
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={e => setAutoConfigSelected(prev => {
                              const next = new Set(prev)
                              if (e.target.checked) visiblePages.forEach(p => next.add(p.id))
                              else visiblePages.forEach(p => next.delete(p.id))
                              return next
                            })}
                            title="Chọn/bỏ tất cả fanpage đang hiển thị"
                            style={{cursor:"pointer"}}
                          />
                        )
                      })()}
                    </th>
                    <th style={{padding:"7px 10px",textAlign:"left" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>FANPAGE</th>
                    <th style={{padding:"7px 10px",textAlign:"center" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)",width:140}}>TĂNG BUDGET (ads/hh &lt; %)</th>
                    <th style={{padding:"7px 10px",textAlign:"center" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)",width:120}}>TẮT (ads/hh &gt; %)</th>
                  </tr>
                </thead>
                <tbody>
                  {autoConfigPages
                    .filter(p => !autoConfigSearch.trim() || p.name.toLowerCase().includes(autoConfigSearch.trim().toLowerCase()))
                    .map(p => {
                      const draft = autoConfigDrafts[p.id] || { up: "", off: "" }
                      const isChecked = autoConfigSelected.has(p.id)
                      return (
                        <tr key={p.id} style={{borderBottom:"1px solid var(--border)",background:isChecked?"rgba(79,126,248,.04)":"transparent"}}>
                          <td style={{padding:"8px 10px",textAlign:"center" as const}}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => setAutoConfigSelected(prev => {
                                const next = new Set(prev)
                                if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                                return next
                              })}
                              style={{cursor:"pointer"}}
                            />
                          </td>
                          <td style={{padding:"8px 10px"}}>
                            <div style={{fontWeight:500}}>{p.name}</div>
                            <div style={{fontSize:9,color:"var(--muted)",fontFamily:"monospace"}}>{p.pageId}</div>
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"center" as const}}>
                            <input
                              type="number"
                              placeholder="—"
                              value={draft.up}
                              onChange={e => setAutoConfigDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], off: prev[p.id]?.off || "", up: e.target.value } }))}
                              style={{width:74,height:26,fontSize:11,padding:"0 8px",borderRadius:4,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text)",outline:"none",textAlign:"right" as const}}
                            />
                            <span style={{marginLeft:4,color:"var(--muted)"}}>%</span>
                          </td>
                          <td style={{padding:"8px 10px",textAlign:"center" as const}}>
                            <input
                              type="number"
                              placeholder="—"
                              value={draft.off}
                              onChange={e => setAutoConfigDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], up: prev[p.id]?.up || "", off: e.target.value } }))}
                              style={{width:74,height:26,fontSize:11,padding:"0 8px",borderRadius:4,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text)",outline:"none",textAlign:"right" as const}}
                            />
                            <span style={{marginLeft:4,color:"var(--muted)"}}>%</span>
                          </td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>

            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span style={{fontSize:10,color:"var(--muted)"}}>
                Đã cấu hình: {autoConfigPages.filter(p => {
                  const d = autoConfigDrafts[p.id]
                  return d && (d.up.trim() !== "" || d.off.trim() !== "")
                }).length} / {autoConfigPages.length}
              </span>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setShowAutoConfig(false)} disabled={autoConfigSaving} style={{padding:"6px 14px",borderRadius:5,fontSize:11,cursor:autoConfigSaving?"not-allowed":"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Huỷ</button>
                <button onClick={saveAutoConfig} disabled={autoConfigSaving} style={{padding:"6px 18px",borderRadius:5,fontSize:11,cursor:autoConfigSaving?"not-allowed":"pointer",border:"none",background:"var(--accent)",color:"#fff",fontFamily:"inherit",fontWeight:600,opacity:autoConfigSaving?0.6:1}}>
                  {autoConfigSaving ? "Đang lưu..." : "💾 Lưu cấu hình"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

const thStyle: React.CSSProperties = {
  padding: "8px 6px",
  fontSize: 10,
  textTransform: "uppercase" as const,
  letterSpacing: ".4px",
  color: "var(--muted)",
  fontWeight: 600,
  textAlign: "center" as const,
  whiteSpace: "nowrap" as const,
  borderBottom: "1px solid var(--border)",
}
const tdStyle: React.CSSProperties = {
  padding: "7px 6px",
  textAlign: "center" as const,
  whiteSpace: "nowrap" as const,
}
