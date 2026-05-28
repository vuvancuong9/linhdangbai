"use client"
// Trang /trinh-quan-ly — clone FB Ads Manager (read-only).
// Workflow: chọn TKQC → list Campaigns → click camp → list Ad sets → click adset → list Ads.
// Tốc độ: camps load ~2-3s (1 FB call) cho 3000 camp. Drill xuống ~1-2s/cấp.
// Phân trang 100/page để DOM mượt.

import { useEffect, useMemo, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateRangePickerVN, { type DateRangePreset, addDays, startOfMonth, endOfMonth, startOfWeekMon, endOfWeekMon } from "@/components/DateRangePickerVN"
import { useToast } from "@/components/Toast"

// Copy text vào clipboard với fallback cho mobile/HTTP context.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
    // Fallback: textarea + execCommand
    const ta = document.createElement("textarea")
    ta.value = text
    ta.style.position = "fixed"
    ta.style.opacity = "0"
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

// Preset list giống FB Ads Manager.
// FB API hỗ trợ custom date range (since/until) → mọi preset đều dùng since/until thực tế.
const FB_PRESETS: DateRangePreset[] = [
  { id: "today", label: "Hôm nay", calc: (t) => [t, t] },
  { id: "yesterday", label: "Hôm qua", calc: (t) => { const y = addDays(t, -1); return [y, y] } },
  { id: "todayAndYesterday", label: "Hôm nay và hôm qua", calc: (t) => [addDays(t, -1), t] },
  { id: "7d", label: "7 ngày qua", calc: (t) => [addDays(t, -6), t] },
  { id: "14d", label: "14 ngày qua", calc: (t) => [addDays(t, -13), t] },
  { id: "28d", label: "28 ngày qua", calc: (t) => [addDays(t, -27), t] },
  { id: "30d", label: "30 ngày qua", calc: (t) => [addDays(t, -29), t] },
  { id: "thisWeek", label: "Tuần này", calc: (t) => [startOfWeekMon(t), endOfWeekMon(t)] },
  { id: "lastWeek", label: "Tuần trước", calc: (t) => { const lw = addDays(t, -7); return [startOfWeekMon(lw), endOfWeekMon(lw)] } },
  { id: "thisMonth", label: "Tháng này", calc: (t) => [startOfMonth(t), endOfMonth(t)] },
  { id: "lastMonth", label: "Tháng trước", calc: (t) => { const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1); return [startOfMonth(lm), endOfMonth(lm)] } },
  { id: "all", label: "Tối đa", calc: (t) => [new Date(2020, 0, 1), t] },
  { id: "custom", label: "Tùy chỉnh", calc: (t) => [t, t] },
]

// Helper: ngày VN hôm nay (Asia/Ho_Chi_Minh)
function todayVNISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

type Tab = "campaigns" | "adsets" | "ads"

type CampaignRow = {
  id: string; name: string; status: string; delivery: string
  objective?: string | null
  budget: number | null; budgetType: "daily" | "lifetime" | null
  bidStrategy: string | null; createdTime: string
  spend: number; impressions: number; reach: number; clicks: number
  results: number; costPerResult: number | null; resultLabel: string
}
type AdsetRow = CampaignRow & { optimizationGoal?: string | null; billingEvent?: string | null }
type AdRow = Omit<CampaignRow, "budget" | "budgetType" | "bidStrategy" | "objective"> & {
  thumbnailUrl: string | null
  pageId: string | null
  pageName: string | null
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—"
  if (v === 0) return "₫0"
  return "₫" + v.toLocaleString("vi-VN")
}
function fmtNum(v: number | null | undefined): string {
  if (v == null || v === 0) return "—"
  return v.toLocaleString("vi-VN")
}
function fmtDate(iso: string): string {
  if (!iso) return "—"
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtBudget(v: number | null, type: string | null): string {
  if (v == null) return "Using campaign budget"
  return fmtMoney(v) + (type === "daily" ? " / ngày" : " / total")
}
function deliveryColor(d: string): string {
  if (d === "Active") return "#2ecc8f"
  if (d === "Paused" || d.includes("off")) return "#888"
  if (d === "With Issues" || d === "Disapproved") return "#e84d4d"
  return "#f5a623"
}

const PAGE_SIZE = 100

const miniBtn: React.CSSProperties = {
  background: "var(--bg3)",
  color: "var(--muted)",
  border: "1px solid var(--border2)",
  borderRadius: 5,
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer",
  fontFamily: "inherit",
}

export default function TrinhQuanLyPage() {
  const toast = useToast()
  // Helper: copy tên + toast feedback. Dùng cho click name camp/adset/ad.
  async function copyName(name: string) {
    const ok = await copyToClipboard(name)
    if (ok) toast.show(`📋 Đã copy: ${name.length > 60 ? name.slice(0, 60) + "…" : name}`, "success" as any)
    else toast.show("❌ Copy không được", "error" as any)
  }
  // ===== Top filters =====
  const [accounts, setAccounts] = useState<any[]>([])
  const [accountId, setAccountId] = useState<string>("")
  // Date range: mặc định = Hôm nay
  const [dateFrom, setDateFrom] = useState<string>(todayVNISO())
  const [dateTo, setDateTo] = useState<string>(todayVNISO())

  // ===== Tab + selections =====
  const [tab, setTab] = useState<Tab>("campaigns")
  // Tick checkbox tại 3 cấp — selection drive drill-down:
  //   - Tick N camp + click "Ad sets" → fetch adsets của N camp
  //   - Tick M adset + click "Ads" → fetch ads của M adset
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set())
  const [selectedAdsetIds, setSelectedAdsetIds] = useState<Set<string>>(new Set())
  const [selectedAdIds, setSelectedAdIds] = useState<Set<string>>(new Set())

  // ===== Data + loading =====
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [adsets, setAdsets] = useState<AdsetRow[]>([])
  const [ads, setAds] = useState<AdRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // ===== Sort + filter + pagination =====
  const [sortKey, setSortKey] = useState<string>("createdTime")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)

  // ===== Bộ lọc nâng cao =====
  // Date created: filter theo r.createdTime (FB trả ISO string, vd 2026-05-26T08:30:00+0000).
  // Cost/result: filter theo r.costPerResult (VND, có thể null nếu chưa có data).
  const [showAdvFilter, setShowAdvFilter] = useState(false)
  const [filterCreatedFrom, setFilterCreatedFrom] = useState("")
  const [filterCreatedTo, setFilterCreatedTo] = useState("")
  const [filterCostMin, setFilterCostMin] = useState("")
  const [filterCostMax, setFilterCostMax] = useState("")
  // Chế độ xử lý row chưa có costPerResult (null = chưa chi tiêu / chưa có click):
  //   "include" = giữ, "exclude" = ẩn khi user set min hoặc max
  const [filterCostIncludeNull, setFilterCostIncludeNull] = useState(true)

  const activeAdvFilterCount = (
    (filterCreatedFrom ? 1 : 0) +
    (filterCreatedTo ? 1 : 0) +
    (filterCostMin ? 1 : 0) +
    (filterCostMax ? 1 : 0)
  )
  function resetAdvFilter() {
    setFilterCreatedFrom("")
    setFilterCreatedTo("")
    setFilterCostMin("")
    setFilterCostMax("")
    setFilterCostIncludeNull(true)
    setPage(1)
  }

  // ===== Range select inputs (reset khi đổi tab) =====
  const [rangeFrom, setRangeFrom] = useState<string>("")
  const [rangeTo, setRangeTo] = useState<string>("")
  // Anchor cho Shift+click range select — row được click cuối cùng (chưa shift).
  const [anchorId, setAnchorId] = useState<string | null>(null)
  // Reset selection 3 cấp khi đổi TKQC.
  useEffect(() => { setSelectedCampaignIds(new Set()); setSelectedAdsetIds(new Set()); setSelectedAdIds(new Set()) }, [accountId])
  // Lock các tab xuống khi adset selection rỗng.
  useEffect(() => { if (selectedCampaignIds.size === 0) { setSelectedAdsetIds(new Set()); setSelectedAdIds(new Set()) } }, [selectedCampaignIds])
  useEffect(() => { if (selectedAdsetIds.size === 0) { setSelectedAdIds(new Set()) } }, [selectedAdsetIds])
  // Reset anchor khi đổi tab/TKQC (selection set khác).
  useEffect(() => { setAnchorId(null) }, [tab, accountId])

  // Current tab's selection — dùng cho range tool + DataTable.
  const currentSelectedIds = tab === "campaigns" ? selectedCampaignIds : tab === "adsets" ? selectedAdsetIds : selectedAdIds
  const setCurrentSelectedIds = tab === "campaigns" ? setSelectedCampaignIds : tab === "adsets" ? setSelectedAdsetIds : setSelectedAdIds

  // ===== Load accounts on mount =====
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/accounts")
        const d = await r.json()
        if (Array.isArray(d)) {
          setAccounts(d)
          if (d.length > 0 && !accountId) setAccountId(d[0].id)
        }
      } catch (e: any) { setError(e?.message || "Loi tai TKQC") }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Date query string param dùng cho mọi API call.
  const dateQS = useMemo(() => `since=${dateFrom}&until=${dateTo}`, [dateFrom, dateTo])
  // Memo string of selected ids để useEffect detect đúng (Set không equal-check được).
  const selectedCampaignIdsKey = useMemo(() => Array.from(selectedCampaignIds).sort().join(","), [selectedCampaignIds])
  const selectedAdsetIdsKey = useMemo(() => Array.from(selectedAdsetIds).sort().join(","), [selectedAdsetIds])

  // ===== Load campaigns when accountId / dateRange / tab=campaigns =====
  useEffect(() => {
    if (!accountId || tab !== "campaigns") return
    setLoading(true); setError(""); setPage(1)
    fetch(`/api/trinh-quan-ly/campaigns?accountId=${accountId}&${dateQS}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setCampaigns(d.campaigns || [])
      })
      .catch(e => setError(e?.message || "Loi tai camp"))
      .finally(() => setLoading(false))
  }, [accountId, dateQS, tab])

  // ===== Load adsets when selectedCampaignIds + tab=adsets =====
  useEffect(() => {
    if (tab !== "adsets") return
    if (!accountId || selectedCampaignIds.size === 0) { setAdsets([]); return }
    setLoading(true); setError(""); setPage(1)
    fetch(`/api/trinh-quan-ly/adsets?accountId=${accountId}&campaignIds=${selectedCampaignIdsKey}&${dateQS}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setAdsets(d.adsets || [])
      })
      .catch(e => setError(e?.message || "Loi tai ad set"))
      .finally(() => setLoading(false))
  }, [tab, accountId, selectedCampaignIdsKey, dateQS])

  // ===== Load ads when selectedAdsetIds + tab=ads =====
  useEffect(() => {
    if (tab !== "ads") return
    if (!accountId || selectedAdsetIds.size === 0) { setAds([]); return }
    setLoading(true); setError(""); setPage(1)
    fetch(`/api/trinh-quan-ly/ads?accountId=${accountId}&adsetIds=${selectedAdsetIdsKey}&${dateQS}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error)
        setAds(d.ads || [])
      })
      .catch(e => setError(e?.message || "Loi tai ads"))
      .finally(() => setLoading(false))
  }, [tab, accountId, selectedAdsetIdsKey, dateQS])

  // ===== Filter + sort + paginate =====
  const rawRows: any[] = tab === "campaigns" ? campaigns : tab === "adsets" ? adsets : ads
  const filteredRows = useMemo(() => {
    let rows = rawRows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((r: any) => (r.name || "").toLowerCase().includes(q))
    }
    // === Bộ lọc nâng cao ===
    // Date created: so sánh r.createdTime (ISO) vs ngày YYYY-MM-DD user nhập.
    // From = ngày bắt đầu 00:00 UTC. To = ngày kết thúc 23:59:59 UTC.
    if (filterCreatedFrom) {
      const fromMs = new Date(filterCreatedFrom + "T00:00:00.000Z").getTime()
      rows = rows.filter((r: any) => {
        if (!r.createdTime) return false
        return new Date(r.createdTime).getTime() >= fromMs
      })
    }
    if (filterCreatedTo) {
      const toMs = new Date(filterCreatedTo + "T23:59:59.999Z").getTime()
      rows = rows.filter((r: any) => {
        if (!r.createdTime) return false
        return new Date(r.createdTime).getTime() <= toMs
      })
    }
    // Cost/result: filter numeric. Null/0 = chưa có data — phụ thuộc filterCostIncludeNull.
    const minN = filterCostMin.trim() ? Number(filterCostMin) : null
    const maxN = filterCostMax.trim() ? Number(filterCostMax) : null
    if (minN != null || maxN != null) {
      rows = rows.filter((r: any) => {
        const v = r.costPerResult
        if (v == null) return filterCostIncludeNull
        if (minN != null && v < minN) return false
        if (maxN != null && v > maxN) return false
        return true
      })
    }
    rows = [...rows].sort((a: any, b: any) => {
      const va = a[sortKey], vb = b[sortKey]
      let cmp = 0
      if (typeof va === "number" && typeof vb === "number") cmp = va - vb
      else if (typeof va === "string" && typeof vb === "string") cmp = va.localeCompare(vb)
      else if (va == null) cmp = vb == null ? 0 : -1
      else if (vb == null) cmp = 1
      return sortDir === "asc" ? cmp : -cmp
    })
    return rows
  }, [rawRows, search, sortKey, sortDir, filterCreatedFrom, filterCreatedTo, filterCostMin, filterCostMax, filterCostIncludeNull])
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const pagedRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  // ===== Sum row (footer) =====
  const totals = useMemo(() => {
    return filteredRows.reduce((acc: any, r: any) => {
      acc.spend += r.spend || 0
      acc.results += r.results || 0
      acc.clicks += r.clicks || 0
      return acc
    }, { spend: 0, results: 0, clicks: 0 })
  }, [filteredRows])

  function changeSort(key: string) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortKey(key); setSortDir("desc") }
  }

  // ===== Selection helpers — STT là index trong filteredRows (1-based) =====
  // "Tích chọn" REPLACE selection (clear cũ + chỉ chọn range mới) — tránh cộng dồn
  // khi user sort lại rồi chọn range mới.
  function applyRange(checked: boolean) {
    const from = Math.max(1, parseInt(rangeFrom || "1") || 1)
    const to = Math.min(filteredRows.length, parseInt(rangeTo || String(filteredRows.length)) || filteredRows.length)
    if (from > to) return
    if (checked) {
      // Replace: clear cũ, chỉ giữ rows trong range
      const next = new Set<string>()
      for (let i = from - 1; i <= to - 1; i++) {
        const id = filteredRows[i]?.id
        if (id) next.add(id)
      }
      setCurrentSelectedIds(next)
    } else {
      // Bỏ chọn: remove range khỏi current selection
      const next = new Set(currentSelectedIds)
      for (let i = from - 1; i <= to - 1; i++) {
        const id = filteredRows[i]?.id
        if (id) next.delete(id)
      }
      setCurrentSelectedIds(next)
    }
  }
  function toggleAllFiltered() {
    if (currentSelectedIds.size >= filteredRows.length) setCurrentSelectedIds(new Set())
    else setCurrentSelectedIds(new Set(filteredRows.map(r => r.id)))
  }
  // Toggle 1 row (additive — dùng cho checkbox + Ctrl+click).
  function toggleRow(rowId: string) {
    const next = new Set(currentSelectedIds)
    if (next.has(rowId)) next.delete(rowId); else next.add(rowId)
    setCurrentSelectedIds(next)
    setAnchorId(rowId)
  }

  // Click row body — pattern Excel/Explorer:
  //   - Plain click → REPLACE selection chỉ với row này (clear cũ).
  //   - Shift+click → REPLACE với range từ anchor đến row này.
  //   - Ctrl/Cmd+click → toggle additive (không clear).
  function handleRowClick(rowId: string, e: React.MouseEvent) {
    if (e.shiftKey) {
      // Range từ anchor — nếu không có anchor, dùng row đầu tiên.
      const anchor = anchorId || filteredRows[0]?.id
      if (!anchor) return
      const aIdx = filteredRows.findIndex(r => r.id === anchor)
      const bIdx = filteredRows.findIndex(r => r.id === rowId)
      if (aIdx >= 0 && bIdx >= 0) {
        const from = Math.min(aIdx, bIdx)
        const to = Math.max(aIdx, bIdx)
        const next = new Set<string>()
        for (let i = from; i <= to; i++) next.add(filteredRows[i].id)
        setCurrentSelectedIds(next)
        return // anchor không đổi
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggleRow(rowId)
      return
    }
    // Plain click: REPLACE — refresh chọn lại từ đầu.
    setCurrentSelectedIds(new Set([rowId]))
    setAnchorId(rowId)
  }
  function reload() {
    if (tab === "campaigns" && accountId) {
      setLoading(true)
      fetch(`/api/trinh-quan-ly/campaigns?accountId=${accountId}&${dateQS}`)
        .then(r => r.json()).then(d => { if (!d.error) setCampaigns(d.campaigns || []); else setError(d.error) })
        .finally(() => setLoading(false))
    } else if (tab === "adsets" && selectedCampaignIds.size > 0) {
      setLoading(true)
      fetch(`/api/trinh-quan-ly/adsets?accountId=${accountId}&campaignIds=${selectedCampaignIdsKey}&${dateQS}`)
        .then(r => r.json()).then(d => { if (!d.error) setAdsets(d.adsets || []); else setError(d.error) })
        .finally(() => setLoading(false))
    } else if (tab === "ads" && selectedAdsetIds.size > 0) {
      setLoading(true)
      fetch(`/api/trinh-quan-ly/ads?accountId=${accountId}&adsetIds=${selectedAdsetIdsKey}&${dateQS}`)
        .then(r => r.json()).then(d => { if (!d.error) setAds(d.ads || []); else setError(d.error) })
        .finally(() => setLoading(false))
    }
  }

  const currentAcc = accounts.find(a => a.id === accountId)

  return (
    <AppLayout>
      {/* Header: TKQC selector + date preset + reload */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--bg2)", padding: 12, borderRadius: 8, border: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>TKQC:</span>
          <select value={accountId} onChange={e => { setAccountId(e.target.value); setTab("campaigns") }}
            style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "6px 10px", fontSize: 12, minWidth: 200 }}>
            {accounts.length === 0 && <option value="">— Chưa có TKQC —</option>}
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>{a.name} ({a.actId})</option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>Khoảng thời gian:</span>
          <DateRangePickerVN
            from={dateFrom}
            to={dateTo}
            onChange={(f, t) => { setDateFrom(f); setDateTo(t) }}
            presets={FB_PRESETS}
            max={todayVNISO()}
            width={300}
          />
        </div>

        <input type="search" placeholder="🔍 Tìm theo tên..." value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
          style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "6px 10px", fontSize: 12, flex: 1, minWidth: 200, maxWidth: 320 }} />

        <button onClick={() => setShowAdvFilter(v => !v)}
          style={{
            background: activeAdvFilterCount > 0 ? "rgba(79,126,248,.15)" : "var(--bg3)",
            color: activeAdvFilterCount > 0 ? "var(--accent)" : "var(--text)",
            border: `1px solid ${activeAdvFilterCount > 0 ? "var(--accent)" : "var(--border2)"}`,
            borderRadius: 6, padding: "6px 12px", fontSize: 12, fontWeight: 500, cursor: "pointer",
          }}
          title="Lọc theo ngày tạo + cost/result">
          🎯 Bộ lọc {activeAdvFilterCount > 0 ? `(${activeAdvFilterCount})` : ""} {showAdvFilter ? "▴" : "▾"}
        </button>

        <button onClick={reload} disabled={loading} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "6px 14px", fontSize: 12, fontWeight: 500, cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1 }}>
          {loading ? "⏳ Đang tải..." : "🔄 Tải lại"}
        </button>

        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {currentAcc ? `Tổng: ${filteredRows.length} ${tab === "campaigns" ? "camp" : tab === "adsets" ? "ad set" : "ad"}` : ""}
        </div>
      </div>

      {/* Bộ lọc nâng cao — collapsible */}
      {showAdvFilter && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, background: "var(--bg2)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
          {/* Date created */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>📅 Ngày tạo:</span>
            <input type="date" value={filterCreatedFrom} onChange={e => { setFilterCreatedFrom(e.target.value); setPage(1) }} max={todayVNISO()}
              style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "inherit" }} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input type="date" value={filterCreatedTo} onChange={e => { setFilterCreatedTo(e.target.value); setPage(1) }} max={todayVNISO()}
              style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, fontFamily: "inherit" }} />
            {/* Quick presets */}
            <button onClick={() => { const t = todayVNISO(); setFilterCreatedFrom(t); setFilterCreatedTo(t); setPage(1) }}
              style={miniBtn}>Hôm nay</button>
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 1); const y = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; setFilterCreatedFrom(y); setFilterCreatedTo(y); setPage(1) }}
              style={miniBtn}>Hôm qua</button>
            <button onClick={() => { const d = new Date(); d.setDate(d.getDate() - 6); const f = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; setFilterCreatedFrom(f); setFilterCreatedTo(todayVNISO()); setPage(1) }}
              style={miniBtn}>7 ngày</button>
          </div>

          <div style={{ width: 1, height: 22, background: "var(--border)" }} />

          {/* Cost/result */}
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--muted)", fontWeight: 600 }}>💰 Cost/result:</span>
            <input type="number" min={0} step={100} value={filterCostMin} onChange={e => { setFilterCostMin(e.target.value); setPage(1) }} placeholder="Min"
              style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, width: 90, fontFamily: "inherit" }} />
            <span style={{ color: "var(--muted)" }}>→</span>
            <input type="number" min={0} step={100} value={filterCostMax} onChange={e => { setFilterCostMax(e.target.value); setPage(1) }} placeholder="Max"
              style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, width: 90, fontFamily: "inherit" }} />
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "var(--muted)", fontSize: 11 }}>
              <input type="checkbox" checked={filterCostIncludeNull} onChange={e => { setFilterCostIncludeNull(e.target.checked); setPage(1) }} />
              Cả row chưa có data
            </label>
          </div>

          {/* Reset button */}
          {activeAdvFilterCount > 0 && (
            <button onClick={resetAdvFilter}
              style={{ marginLeft: "auto", background: "transparent", color: "var(--muted)", border: "1px solid var(--border2)", borderRadius: 6, padding: "4px 12px", fontSize: 11, cursor: "pointer" }}>
              ✗ Xoá bộ lọc
            </button>
          )}
        </div>
      )}

      {/* Tabs — label hiện số đã tick (nếu >0) hoặc total */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, background: "var(--bg2)", borderRadius: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
        <button onClick={() => setTab("campaigns")} style={tabStyle(tab === "campaigns")}>
          <span style={{ fontSize: 14 }}>📊</span> Campaigns ({selectedCampaignIds.size > 0 ? selectedCampaignIds.size : campaigns.length})
        </button>
        <button
          onClick={() => { if (selectedCampaignIds.size > 0) setTab("adsets") }}
          disabled={selectedCampaignIds.size === 0}
          style={{ ...tabStyle(tab === "adsets"), opacity: selectedCampaignIds.size > 0 ? 1 : 0.4, cursor: selectedCampaignIds.size > 0 ? "pointer" : "not-allowed" }}
          title={selectedCampaignIds.size === 0 ? "Tick ≥1 camp trước" : `${selectedCampaignIds.size} camp đã chọn`}>
          <span style={{ fontSize: 14 }}>📁</span> Ad sets ({selectedAdsetIds.size > 0 ? selectedAdsetIds.size : adsets.length})
        </button>
        <button
          onClick={() => { if (selectedAdsetIds.size > 0) setTab("ads") }}
          disabled={selectedAdsetIds.size === 0}
          style={{ ...tabStyle(tab === "ads"), opacity: selectedAdsetIds.size > 0 ? 1 : 0.4, cursor: selectedAdsetIds.size > 0 ? "pointer" : "not-allowed" }}
          title={selectedAdsetIds.size === 0 ? "Tick ≥1 ad set trước" : `${selectedAdsetIds.size} ad set đã chọn`}>
          <span style={{ fontSize: 14 }}>📄</span> Ads ({selectedAdIds.size > 0 ? selectedAdIds.size : ads.length})
        </button>

        {/* Breadcrumb: TKQC > N camp > M adset */}
        <div style={{ marginLeft: "auto", padding: "0 14px", fontSize: 11, color: "var(--muted)" }}>
          {currentAcc && <span>{currentAcc.name}</span>}
          {selectedCampaignIds.size > 0 && (
            <span> {" › "} <a onClick={() => setTab("campaigns")} style={{ cursor: "pointer", color: "var(--accent)" }}>
              {selectedCampaignIds.size === 1 ? campaigns.find(c => selectedCampaignIds.has(c.id))?.name : `${selectedCampaignIds.size} camp`}
            </a></span>
          )}
          {selectedAdsetIds.size > 0 && (
            <span> {" › "} <a onClick={() => setTab("adsets")} style={{ cursor: "pointer", color: "var(--accent)" }}>
              {selectedAdsetIds.size === 1 ? adsets.find(s => selectedAdsetIds.has(s.id))?.name : `${selectedAdsetIds.size} ad set`}
            </a></span>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "rgba(232,77,45,.1)", border: "1px solid rgba(232,77,45,.3)", color: "var(--danger)", padding: 10, borderRadius: 6, fontSize: 12 }}>
          ❌ {error}
        </div>
      )}

      {/* Selection toolbar — range select theo STT, dùng current tab's selection */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", background: "var(--bg2)", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12 }}>
        <span style={{ color: "var(--muted)", fontWeight: 600 }}>Đã chọn:</span>
        <b style={{ color: currentSelectedIds.size > 0 ? "var(--accent)" : "var(--muted)" }}>{currentSelectedIds.size}</b>
        <span style={{ color: "var(--muted)" }}>/ {filteredRows.length}</span>

        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />

        <span style={{ color: "var(--muted)" }}>Chọn từ STT</span>
        <input type="number" min={1} max={filteredRows.length} value={rangeFrom} onChange={e => setRangeFrom(e.target.value)} placeholder="1"
          style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, width: 70 }} />
        <span style={{ color: "var(--muted)" }}>→</span>
        <input type="number" min={1} max={filteredRows.length} value={rangeTo} onChange={e => setRangeTo(e.target.value)} placeholder={String(filteredRows.length)}
          style={{ background: "var(--bg3)", border: "1px solid var(--border2)", color: "var(--text)", borderRadius: 6, padding: "4px 8px", fontSize: 12, width: 70 }} />
        <button onClick={() => applyRange(true)}
          style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
          ✓ Tích chọn
        </button>
        <button onClick={() => applyRange(false)}
          style={{ background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>
          ✗ Bỏ chọn
        </button>

        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 4px" }} />

        <button onClick={toggleAllFiltered}
          style={{ background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer", fontWeight: 500 }}>
          {currentSelectedIds.size >= filteredRows.length && filteredRows.length > 0 ? "Bỏ chọn tất cả" : `Chọn tất cả (${filteredRows.length})`}
        </button>
        {currentSelectedIds.size > 0 && (
          <button onClick={() => setCurrentSelectedIds(new Set())}
            style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border2)", borderRadius: 6, padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>
            Xoá chọn
          </button>
        )}

        {/* Hint khi tick xong */}
        {tab === "campaigns" && selectedCampaignIds.size > 0 && (
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
            💡 Click tab <b>Ad sets</b> để xem ad sets của {selectedCampaignIds.size} camp đã chọn
          </span>
        )}
        {tab === "adsets" && selectedAdsetIds.size > 0 && (
          <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
            💡 Click tab <b>Ads</b> để xem ads của {selectedAdsetIds.size} ad set đã chọn
          </span>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto", flex: 1, minHeight: 400 }}>
        {tab === "campaigns" && (
          <DataTable
            kind="campaigns"
            rows={pagedRows}
            startIndex={(page - 1) * PAGE_SIZE}
            selectedIds={selectedCampaignIds}
            onRowClick={handleRowClick}
            onToggleRow={toggleRow}
            onReplaceSelection={(s) => setSelectedCampaignIds(s)}
            sortKey={sortKey} sortDir={sortDir} onSort={changeSort}
            onClickName={(r: any) => copyName(r.name)}
            loading={loading && rawRows.length === 0}
          />
        )}
        {tab === "adsets" && (
          <DataTable
            kind="adsets"
            rows={pagedRows}
            startIndex={(page - 1) * PAGE_SIZE}
            selectedIds={selectedAdsetIds}
            onRowClick={handleRowClick}
            onToggleRow={toggleRow}
            onReplaceSelection={(s) => setSelectedAdsetIds(s)}
            sortKey={sortKey} sortDir={sortDir} onSort={changeSort}
            onClickName={(r: any) => copyName(r.name)}
            loading={loading && rawRows.length === 0}
          />
        )}
        {tab === "ads" && (
          <DataTable
            kind="ads"
            rows={pagedRows}
            startIndex={(page - 1) * PAGE_SIZE}
            selectedIds={selectedAdIds}
            onRowClick={handleRowClick}
            onToggleRow={toggleRow}
            onReplaceSelection={(s) => setSelectedAdIds(s)}
            sortKey={sortKey} sortDir={sortDir} onSort={changeSort}
            onClickName={(r: any) => copyName(r.name)}
            loading={loading && rawRows.length === 0}
          />
        )}
      </div>

      {/* Footer: totals + pagination */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg2)", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--border)", fontSize: 12, flexWrap: "wrap" }}>
        <span style={{ color: "var(--muted)" }}>Tổng spend (đã filter):</span>
        <b>{fmtMoney(totals.spend)}</b>
        <span style={{ color: "var(--muted)", marginLeft: 12 }}>Tổng results:</span>
        <b>{fmtNum(totals.results)}</b>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--muted)" }}>Trang {page}/{totalPages}</span>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pgBtn(page === 1)}>‹ Trước</button>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages} style={pgBtn(page >= totalPages)}>Sau ›</button>
        </div>
      </div>
    </AppLayout>
  )
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--bg3)" : "transparent",
    border: "none",
    borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
    color: active ? "var(--text)" : "var(--muted)",
    padding: "10px 16px",
    fontSize: 13,
    fontWeight: active ? 600 : 500,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  }
}
function pgBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "var(--bg3)",
    border: "1px solid var(--border2)",
    color: "var(--text)",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  }
}

// ============== Data Table component ==============
function DataTable({ kind, rows, startIndex, selectedIds, onRowClick, onToggleRow, onReplaceSelection, sortKey, sortDir, onSort, onClickName, loading }: {
  kind: "campaigns" | "adsets" | "ads"
  rows: any[]
  startIndex: number                                          // STT base (0-based)
  selectedIds: Set<string>
  onRowClick: (id: string, e: React.MouseEvent) => void       // click row body → replace/shift/ctrl
  onToggleRow: (id: string) => void                           // click checkbox → toggle additive
  onReplaceSelection: (s: Set<string>) => void                // header checkbox dùng
  sortKey: string
  sortDir: "asc" | "desc"
  onSort: (k: string) => void
  onClickName: (r: any) => void                               // click name link → drill down
  loading: boolean
}) {
  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>⏳ Đang tải data từ FB...</div>
  if (rows.length === 0) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Không có data.</div>

  // Header checkbox: tick = chọn hết trong page hiện tại; bỏ tick = bỏ chọn page hiện tại.
  // Fix bug closure async: build Set 1 lần rồi setReplace, không loop onToggleRow.
  const pageAllSelected = rows.length > 0 && rows.every(r => selectedIds.has(r.id))
  const togglePageAll = () => {
    const next = new Set(selectedIds)
    if (pageAllSelected) rows.forEach(r => next.delete(r.id))
    else rows.forEach(r => next.add(r.id))
    onReplaceSelection(next)
  }

  const cols: Array<{ key: string; label: string; w?: number; render?: (r: any) => React.ReactNode; align?: "left" | "right" | "center" }> = []
  if (kind === "ads") {
    cols.push({
      key: "name", label: "Ad", w: 280,
      render: (r: AdRow) => (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {r.thumbnailUrl ? (
            <img src={r.thumbnailUrl} alt="" style={{ width: 32, height: 32, borderRadius: 4, objectFit: "cover", flexShrink: 0, border: "1px solid var(--border)" }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 4, background: "var(--bg3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>📷</div>
          )}
          {/* Click name = copy. stopPropagation tránh trigger row click. */}
          <a onClick={(e) => { e.stopPropagation(); onClickName(r) }}
             title="Click để copy tên"
             style={{ color: "var(--accent)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</a>
        </div>
      ),
    })
  } else {
    cols.push({
      key: "name", label: kind === "campaigns" ? "Campaign" : "Ad set", w: 260,
      render: (r: any) => (
        // stopPropagation: click name = copy, KHÔNG tick row.
        <a onClick={(e) => { e.stopPropagation(); onClickName(r) }}
           title="Click để copy tên"
           style={{ color: "var(--accent)", cursor: "pointer", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "inline-block", maxWidth: "100%" }}>{r.name}</a>
      ),
    })
  }
  cols.push({
    key: "delivery", label: "Delivery", w: 110,
    render: (r: any) => <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: deliveryColor(r.delivery) }} />
      {r.delivery}
    </span>,
  })
  cols.push({ key: "results", label: "Results", w: 110, align: "right", render: (r: any) => <div style={{ textAlign: "right" }}>{fmtNum(r.results)}<div style={{ fontSize: 9, color: "var(--muted)" }}>{r.resultLabel}</div></div> })
  cols.push({ key: "costPerResult", label: "Cost / result", w: 110, align: "right", render: (r: any) => <div style={{ textAlign: "right" }}>{fmtMoney(r.costPerResult)}<div style={{ fontSize: 9, color: "var(--muted)" }}>Per {r.resultLabel}</div></div> })
  if (kind !== "ads") {
    cols.push({ key: "budget", label: "Budget", w: 130, align: "right", render: (r: any) => <span>{fmtBudget(r.budget, r.budgetType)}</span> })
  }
  cols.push({ key: "spend", label: "Amount spent", w: 110, align: "right", render: (r: any) => <b>{fmtMoney(r.spend)}</b> })
  cols.push({ key: "bidStrategy", label: "Bid strategy", w: 140, render: (r: any) => <span style={{ fontSize: 11 }}>{r.bidStrategy || (kind === "ads" ? "—" : "Cost per result goal")}</span> })
  cols.push({ key: "createdTime", label: "Date created", w: 110, render: (r: any) => fmtDate(r.createdTime) })
  if (kind === "ads") {
    cols.push({ key: "pageName", label: "Page name", w: 150, render: (r: AdRow) => r.pageName || <span style={{ color: "var(--muted)" }}>—</span> })
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 1100 }}>
      <thead style={{ background: "var(--bg3)", position: "sticky", top: 0, zIndex: 2 }}>
        <tr>
          {/* Checkbox header — click chọn/bỏ tất cả trong page */}
          <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", width: 36, textAlign: "center" }}
            onClick={(e) => { e.stopPropagation(); togglePageAll() }}>
            <input type="checkbox" checked={pageAllSelected} onChange={() => {}}
              title="Chọn/bỏ chọn tất cả trong trang"
              style={{ width: 20, height: 20, cursor: "pointer", accentColor: "var(--accent)", pointerEvents: "none" }} />
          </th>
          {/* STT header */}
          <th style={{ padding: "10px 8px", borderBottom: "1px solid var(--border)", width: 50, textAlign: "center", color: "var(--muted)", fontWeight: 600 }}>STT</th>
          {cols.map(c => (
            <th key={c.key}
              onClick={() => onSort(c.key)}
              style={{ padding: "10px 12px", textAlign: c.align || "left", borderBottom: "1px solid var(--border)", cursor: "pointer", fontWeight: 600, color: "var(--muted)", userSelect: "none", width: c.w, whiteSpace: "nowrap" }}>
              {c.label}
              {sortKey === c.key && <span style={{ marginLeft: 4 }}>{sortDir === "asc" ? "↑" : "↓"}</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r: any, idx) => {
          const stt = startIndex + idx + 1
          const checked = selectedIds.has(r.id)
          return (
            // Click bất kỳ chỗ nào trên row = toggle. Shift+click = range từ anchor.
            // Native browser tự highlight text khi Shift+click → preventDefault tránh.
            <tr key={r.id}
              onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
              onClick={(e) => onRowClick(r.id, e)}
              style={{
                background: checked ? "rgba(79,126,248,.12)" : (idx % 2 === 0 ? "transparent" : "var(--bg3)"),
                cursor: "pointer",
                userSelect: "none",
              }}>
              {/* Checkbox cell — toggle additive, stopPropagation để không bubble lên tr (tránh replace). */}
              <td onClick={(e) => e.stopPropagation()}
                style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
                <input type="checkbox" checked={checked}
                  onChange={() => onToggleRow(r.id)}
                  style={{ width: 20, height: 20, cursor: "pointer", accentColor: "var(--accent)" }} />
              </td>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid var(--border)", textAlign: "center", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{stt}</td>
              {cols.map(c => (
                <td key={c.key} style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", textAlign: c.align || "left", whiteSpace: c.key === "name" ? "nowrap" : "normal", overflow: "hidden", textOverflow: "ellipsis", maxWidth: c.w }}>
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
