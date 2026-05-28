"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateRangePickerVN from "@/components/DateRangePickerVN"
import { useToast } from "@/components/Toast"
import { DATA_LOCK_DATE } from "@/lib/data-lock"
import { DASHBOARD_CACHE_TTL_MS } from "@/lib/constants"
// SECURITY (P4.2): KHÔNG import COMMISSION_NET_FACTOR / ADS_COST_FACTOR ở client
// (trước đây lộ qua F12 → công thức profit). Server tính sẵn realProfit + groupProfit
// trong response /api/dashboard.
import { useIsMobile } from "@/hooks/useIsMobile"

const fmt = (n: number) => "₫" + (n || 0).toLocaleString("vi-VN")
const fmtShort = (n: number) => {
  const v = Math.abs(n)
  if (v >= 1e9) return (n / 1e9).toFixed(2) + "tỷ"
  if (v >= 1e6) return (n / 1e6).toFixed(2) + "tr"
  if (v >= 1e3) return (n / 1e3).toFixed(1) + "k"
  return String(n)
}

const HKD_INDUSTRIES = [
  { value: "distribution", label: "Phân phối hàng hoá (GTGT 1%, TNCN 0.5%)" },
  { value: "service", label: "Cung cấp sản phẩm/nội dung số (GTGT 5%, TNCN 5%)" },
  { value: "transport_food", label: "Vận tải, ăn uống (GTGT 3%, TNCN 1.5%)" },
  { value: "other", label: "Hoạt động khác (GTGT 2%, TNCN 1%)" },
]
const TNDN_TYPES = [
  { value: "small", label: "DN nhỏ (DT ≤ 3 tỷ) — 15%" },
  { value: "medium", label: "DN vừa (DT 3-50 tỷ) — 17%" },
  { value: "large", label: "DN thông thường (>50 tỷ) — 20%" },
]
const fmtNum = (n: number) => (n || 0).toLocaleString("vi-VN")

export default function DashboardPage() {
  const toast = useToast()
  const isMobile = useIsMobile()
  // Default: TỔNG THỜI GIAN — từ DATA_LOCK_DATE (01/02/2026) đến hôm qua.
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()
  const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  const [from, setFrom] = useState(() => DATA_LOCK_DATE)
  const [to, setTo] = useState(() => {
    const today = new Date()
    if (today.getDate() === 1) {
      // Hôm nay là ngày 1 → ngày cuối của tháng trước (vì hôm qua đã sang tháng trước)
      return isoLocal(new Date(today.getFullYear(), today.getMonth(), 0))
    }
    // Mặc định: hôm qua
    return yesterdayStr
  })
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [taxModal, setTaxModal] = useState<{ open: boolean; groupId: string; name: string; commission: number; spend: number }>({ open: false, groupId: "", name: "", commission: 0, spend: 0 })
  const [bonusModal, setBonusModal] = useState<{ open: boolean; shopeeAccountId: string; shopeeName: string }>({ open: false, shopeeAccountId: "", shopeeName: "" })
  const [taxTab, setTaxTab] = useState<"personal" | "household" | "company">("personal")
  const [tncnInp, setTncnInp] = useState({ grossYear: 0, insurance: 0, dependents: 0, otherDeduction: 0 })
  const [hkdInp, setHkdInp] = useState({ industry: "service", revenue: 0, expense: 0, exempt: 1_000_000_000, method: "direct" as "direct" | "income" })
  const [tndnInp, setTndnInp] = useState({ companyType: "medium", revenue: 0, expense: 0, exemptIncome: 0 })
  const [taxOutputs, setTaxOutputs] = useState<any>(null)
  const [taxSaving, setTaxSaving] = useState(false)

  async function load(opts?: { background?: boolean }) {
    const cacheKey = `dashboard_${from}_${to}`
    // Hiển thị cache instant nếu có (TTL 5 phút)
    if (!opts?.background) {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { data: cachedData, ts } = JSON.parse(cached)
          if (Date.now() - ts < DASHBOARD_CACHE_TTL_MS) {
            setData(cachedData)
            // Background refresh, không show spinner
            load({ background: true })
            return
          }
        }
      } catch {}
      setLoading(true)
    }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 90000) // 90s timeout
      const r = await fetch(`/api/dashboard?from=${from}&to=${to}`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (r.ok) {
        const d = await r.json()
        setData(d)
        try { localStorage.setItem(cacheKey, JSON.stringify({ data: d, ts: Date.now() })) } catch {}
      } else {
        console.error("[dashboard] HTTP", r.status, await r.text().catch(() => ""))
      }
    } catch (e: any) {
      console.error("[dashboard] fetch error:", e?.message || e)
    }
    if (!opts?.background) setLoading(false)
  }
  useEffect(() => { load() }, [])
  useEffect(() => { if (from && to) load() }, [from, to])

  async function openTaxModal(g: any) {
    const commission = g.groupCommission || 0
    const spend = g.groupSpend || 0
    setTaxModal({ open: true, groupId: g.id, name: g.name, commission, spend })
    // Load record gần nhất
    try {
      const r = await fetch(`/api/tax?groupId=${g.id}`)
      if (r.ok) {
        const d = await r.json()
        const t = d.group?.taxType || g.taxType
        if (t === "personal" || t === "household" || t === "company") setTaxTab(t)
        // Auto-fill từ data nhóm hiện tại (date range đang chọn)
        setTncnInp({ grossYear: commission, insurance: 0, dependents: 0, otherDeduction: 0 })
        setHkdInp({ industry: "service", revenue: commission, expense: spend, exempt: commission < 3_000_000_000 ? 1_000_000_000 : 0, method: "direct" })
        setTndnInp({ companyType: spend > 50_000_000_000 ? "large" : spend > 3_000_000_000 ? "medium" : "small", revenue: commission, expense: spend, exemptIncome: 0 })
        // Nếu có record cũ, override inputs từ record
        if (d.record) {
          if (d.record.taxType === "personal") setTncnInp(d.record.inputs)
          else if (d.record.taxType === "household") setHkdInp(d.record.inputs)
          else if (d.record.taxType === "company") setTndnInp(d.record.inputs)
        }
        setTaxOutputs(d.record?.outputs || null)
      }
    } catch {}
  }

  async function calcAndPreviewTax() {
    const inputs = taxTab === "personal" ? tncnInp : taxTab === "household" ? hkdInp : tndnInp
    // Tính fly client-side qua API preview (không save) — tao gọi save endpoint bằng dryRun?
    // Đơn giản: tính client-side. Logic match server.
    if (taxTab === "personal") {
      const p = tncnInp
      const totalDeduction = 186_000_000 + (p.dependents || 0) * 74_400_000 + (p.insurance || 0) + (p.otherDeduction || 0)
      const taxable = Math.max(0, (p.grossYear || 0) - totalDeduction)
      const brackets = [
        { upTo: 120_000_000, rate: 0.05 }, { upTo: 360_000_000, rate: 0.10 },
        { upTo: 720_000_000, rate: 0.20 }, { upTo: 1_200_000_000, rate: 0.30 },
        { upTo: Infinity, rate: 0.35 }
      ]
      let remaining = taxable, prevCap = 0, totalTax = 0
      const breakdown: any[] = []
      for (const b of brackets) {
        if (remaining <= 0) break
        const slice = Math.min(remaining, b.upTo - prevCap)
        const tx = slice * b.rate
        breakdown.push({ range: b.upTo === Infinity ? `>${prevCap/1e6}tr × ${b.rate*100}%` : `${prevCap/1e6}-${b.upTo/1e6}tr × ${b.rate*100}%`, tax: Math.round(tx) })
        totalTax += tx; remaining -= slice; prevCap = b.upTo
      }
      setTaxOutputs({ totalDeduction, taxableIncome: Math.round(taxable), taxAmount: Math.round(totalTax), netIncome: Math.round((p.grossYear||0) - totalTax), brackets: breakdown })
    } else if (taxTab === "household") {
      const ind = HKD_INDUSTRIES.find(x => x.value === hkdInp.industry) || HKD_INDUSTRIES[1]
      const rates: any = { distribution: [0.01, 0.005], service: [0.05, 0.05], transport_food: [0.03, 0.015], other: [0.02, 0.01] }
      const [vatR, tncnIndR] = rates[hkdInp.industry] || rates.service
      const rev = hkdInp.revenue || 0
      // Nhóm 1 (<1 tỷ): miễn hoàn toàn
      if (rev < 1_000_000_000) {
        setTaxOutputs({ vatBase: 0, tncnBase: 0, vatRate: vatR*100, tncnRate: tncnIndR*100, vatTax: 0, tncnTax: 0, totalTax: 0, netIncome: rev, industryLabel: ind.label, methodLabel: "Miễn thuế hoàn toàn (DT < 1 tỷ)" })
        return
      }
      // GTGT trên tổng DT (không trừ miễn)
      const vatTax = Math.round(rev * vatR)
      let tncnBase: number, tncnRate: number, methodLabel: string
      if (hkdInp.method === "income") {
        // PP thu nhập: TNT × 15%
        tncnBase = Math.max(0, rev - (hkdInp.expense || 0))
        tncnRate = 15
        methodLabel = "PP thu nhập: TNT × 15%"
      } else {
        // PP trực tiếp: (DT - miễn) × tỷ lệ ngành
        tncnBase = Math.max(0, rev - (hkdInp.exempt || 0))
        tncnRate = tncnIndR * 100
        methodLabel = `PP trực tiếp: (DT − ${((hkdInp.exempt||0)/1e6).toFixed(0)}tr) × ${(tncnIndR*100).toFixed(1)}%`
      }
      const tncnTax = Math.round(tncnBase * (tncnRate / 100))
      const totalTax = vatTax + tncnTax
      setTaxOutputs({ vatBase: rev, tncnBase: Math.round(tncnBase), vatRate: vatR*100, tncnRate, vatTax, tncnTax, totalTax, netIncome: Math.round(rev - totalTax), industryLabel: ind.label, methodLabel })
    } else {
      const rates: any = { small: 0.15, medium: 0.17, large: 0.20 }
      const r = rates[tndnInp.companyType] || 0.20
      const taxable = Math.max(0, (tndnInp.revenue||0) - (tndnInp.expense||0) - (tndnInp.exemptIncome||0))
      const tx = Math.round(taxable * r)
      setTaxOutputs({ taxableIncome: Math.round(taxable), taxRate: r*100, taxAmount: tx, netIncome: Math.round((tndnInp.revenue||0) - (tndnInp.expense||0) - tx) })
    }
  }
  // Auto-tính khi đổi input
  useEffect(() => { if (taxModal.open) calcAndPreviewTax() }, [taxTab, tncnInp, hkdInp, tndnInp, taxModal.open])

  async function saveTax() {
    setTaxSaving(true)
    try {
      const inputs = taxTab === "personal" ? tncnInp : taxTab === "household" ? hkdInp : tndnInp
      const r = await fetch("/api/tax", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ groupId: taxModal.groupId, taxType: taxTab, fromDate: from, toDate: to, inputs }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lỗi")
      setTaxModal({ open: false, groupId: "", name: "", commission: 0, spend: 0 })
      load()
    } catch (e:any) { toast.show("Lỗi: " + e.message, "error" as any) }
    finally { setTaxSaving(false) }
  }

  const t = data?.totals

  // ===== MOBILE LAYOUT — Native iOS/Android style =====
  if (isMobile) {
    const officeExp = t?.totalOfficeExpense || 0
    // P4.2: server đã tính sẵn realProfit + isFullRange + groupProfit.
    const isFullRange = t?.isFullRange ?? false
    const realProfit = t?.realProfit ?? 0
    const commForAdsHH = t?.totalCommissionRaw ?? t?.totalCommission ?? 0
    const adsHHPct = t && commForAdsHH > 0 ? Math.round((t.totalSpend / commForAdsHH) * 1000) / 10 : null

    // Top fanpages — pick groups sort theo groupProfit (server pre-computed).
    const topGroups = data?.groups ? [...data.groups].sort((a: any, b: any) => {
      return (b.groupProfit ?? 0) - (a.groupProfit ?? 0)
    }).slice(0, 8) : []

    return (
      <AppLayout>
        {/* Header — tiêu đề lớn + 2 icon */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -.4 }}>Dashboard</div>
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500, marginTop: 1 }}>Tổng quan</div>
          </div>
          <button onClick={() => { try { localStorage.removeItem(`dashboard_${from}_${to}`) } catch {}; load() }}
            style={{ width: 38, height: 38, borderRadius: "50%", background: "var(--bg3)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text)", cursor: "pointer", fontSize: 16 }}>🔄</button>
        </div>

        {/* Date picker — full width */}
        <div style={{ marginBottom: 4 }}>
          <DateRangePickerVN from={from} to={to} max={yesterdayStr} min={DATA_LOCK_DATE}
            onChange={(f, tt) => { setFrom(f); setTo(tt) }} width={undefined as any} />
        </div>

        {/* HERO card — Lợi nhuận thực tế */}
        <div style={{ background: realProfit >= 0 ? "linear-gradient(135deg,#4f7ef8 0%,#2563eb 100%)" : "linear-gradient(135deg,#ef4444 0%,#b91c1c 100%)", borderRadius: 18, padding: "18px 16px 20px", color: "white", boxShadow: realProfit >= 0 ? "0 10px 25px rgba(79,126,248,.25)" : "0 10px 25px rgba(239,68,68,.25)" }}>
          <div style={{ fontSize: 12, opacity: .9, fontWeight: 500 }}>{realProfit >= 0 ? "LỢI NHUẬN THỰC TẾ" : "LỖ THỰC TẾ"}</div>
          <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: -.8, marginTop: 4, lineHeight: 1.1 }}>{loading ? "..." : (t ? (realProfit >= 0 ? "+" : "") + fmt(realProfit) : "—")}</div>
          {adsHHPct != null && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 4, marginTop: 8, fontSize: 12, padding: "3px 9px", background: "rgba(255,255,255,.2)", borderRadius: 12, fontWeight: 600 }}>
              📊 ADS/HH: {adsHHPct.toFixed(1)}% {adsHHPct < 65 ? "(Lãi tốt)" : adsHHPct <= 110 ? "(Cảnh báo)" : "(Lỗ nặng)"}
            </div>
          )}
        </div>

        {/* 4 metric cards 2x2 */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <MetricCardMobile icon="💰" iconBg="rgba(22,163,74,.1)" iconColor="#16a34a" label="Hoa hồng Shopee" value={t ? fmtShort(t.totalCommission) : "—"} sub={t ? `${t.shopeeCount} acc` : ""} />
          <MetricCardMobile icon="📉" iconBg="rgba(239,68,68,.1)" iconColor="#ef4444" label="Chi FB Ads" value={t ? fmtShort(t.totalSpend) : "—"} sub={t ? `${t.adAccountActive}/${t.adAccountCount} TK` : ""} />
          <MetricCardMobile icon="🏢" iconBg="rgba(139,92,246,.1)" iconColor="#8b5cf6" label="Chi văn phòng" value={t ? fmtShort(officeExp) : "—"} sub={t ? `${t.officeExpenseCount || 0} khoản` : ""} />
          {isFullRange ? (
            <MetricCardMobile icon="🏛️" iconBg="rgba(245,158,11,.1)" iconColor="#f59e0b" label="Thuế (cả năm)" value={t ? fmtShort(t.totalTax || 0) : "—"} sub={t ? `${t.groupsWithTax}/${t.groupsWithTax + t.groupsWithoutTax}` : ""} />
          ) : (
            <MetricCardMobile icon="🛒" iconBg="rgba(79,126,248,.1)" iconColor="#4f7ef8" label="Hoa hồng gốc" value={t ? fmtShort(t.totalCommissionRaw || t.totalCommission || 0) : "—"} sub="Trước bonus" />
          )}
        </div>

        {/* Top Fanpage section */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 18, marginBottom: 10, padding: "0 4px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .8 }}>Top Nhóm theo lợi nhuận</div>
        </div>
        <div style={{ background: "var(--bg2)", borderRadius: 16, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Đang tải...</div>
          ) : topGroups.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
              Chưa có nhóm. Vào <a href="/nhom-tai-khoan" style={{ color: "var(--accent)" }}>Nhóm tài khoản</a>
            </div>
          ) : topGroups.map((g: any, i: number) => {
            const groupProfit = g.groupProfit ?? 0  // server pre-computed (P4.2)
            const colors = ["#ec4899", "#f59e0b", "#8b5cf6", "#06b6d4", "#16a34a", "#ef4444", "#3b82f6", "#a855f7"]
            const bg = colors[i % colors.length]
            const initial = (g.name || "?").slice(0, 1).toUpperCase()
            return (
              <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderBottom: i < topGroups.length - 1 ? "1px solid var(--border)" : "none" }}>
                <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>{initial}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.name}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                    HH {fmtShort(g.groupCommission || 0)} • Chi {fmtShort(g.groupSpend || 0)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: groupProfit >= 0 ? "var(--success)" : "var(--danger)" }}>
                    {groupProfit >= 0 ? "+" : ""}{fmtShort(groupProfit)}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Tax + bonus modals — render giống desktop */}
        {taxModal.open && (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
            <div style={{ background: "var(--bg2)", borderRadius: "16px 16px 0 0", width: "100%", maxHeight: "92vh", overflowY: "auto", padding: 16, position: "relative" }}>
              <button onClick={() => setTaxModal({ ...taxModal, open: false })} style={{ position: "absolute", top: 12, right: 12, background: "transparent", border: "none", color: "var(--muted)", fontSize: 24, cursor: "pointer" }}>×</button>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Trang Tính Thuế — {taxModal.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Modal tax full version chỉ trên desktop. Anh vào desktop để tính chi tiết.</div>
              <button onClick={() => setTaxModal({ ...taxModal, open: false })}
                style={{ marginTop: 16, width: "100%", padding: 14, borderRadius: 10, background: "var(--accent)", color: "white", border: "none", fontSize: 15, fontWeight: 600 }}>Đóng</button>
            </div>
          </div>
        )}
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <div className="page-title" style={{ fontSize: 16, fontWeight: 600 }}>Dashboard tổng</div>
        <div className="row-actions">
          <DateRangePickerVN
            from={from}
            to={to}
            max={yesterdayStr}
            min={DATA_LOCK_DATE}
            onChange={(f, t) => { setFrom(f); setTo(t) }}
            align="right"
            width={290}
          />
          <button onClick={() => { try { localStorage.removeItem(`dashboard_${from}_${to}`) } catch {}; load() }} style={{ padding: "0 13px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", height: 28 }}>🔄 Tải lại</button>
        </div>
      </div>

      {/* Stats tổng */}
      {(() => {
        const officeExp = t?.totalOfficeExpense || 0
        // isFullRange = "Tổng thời gian" — span >= 60 ngày KỂ TỪ DATA_LOCK_DATE.
        // Tháng 2 (28 ngày) cũng có from === DATA_LOCK_DATE nhưng KHÔNG phải full range.
        // Thuế lưu trong DB là 1 record cố định / nhóm (tính theo NĂM), không scale theo date range.
        // → Chỉ show khi user xem từ đầu (DATA_LOCK_DATE) tới ít nhất 60 ngày sau.
        const isFullRange = (() => {
          if (from !== DATA_LOCK_DATE) return false
          const fromD = new Date(from + "T00:00:00Z")
          const toD = new Date(to + "T00:00:00Z")
          const diffDays = (toD.getTime() - fromD.getTime()) / (24 * 3600 * 1000)
          return diffDays >= 60
        })()
        // P4.2: server pre-compute realProfit. Client chỉ render.
        const realProfit = t?.realProfit ?? 0
        // ADS/HH = chi FB / hoa hồng GỐC (không tính bonus)
        const commForAdsHH = t?.totalCommissionRaw ?? t?.totalCommission ?? 0
        const adsHHPct = t && commForAdsHH > 0 ? Math.round((t.totalSpend / commForAdsHH) * 1000) / 10 : null
        const adsHHColor = adsHHPct == null ? "var(--muted)" : adsHHPct < 65 ? "var(--success)" : adsHHPct <= 110 ? "var(--warn)" : "var(--danger)"
        const profitSub = isFullRange ? "Đã tính thuế + VP" : "Chưa tính thuế (cần xem tổng năm)"
        return (
          <div className={isFullRange ? "grid-stats-6" : "grid-stats-5"}>
            <StatCard label="Tổng chi FB Ads" value={t ? fmt(t.totalSpend) : "—"} sub={t ? `${t.adAccountCount} TK / ${t.adAccountActive} đang chạy` : ""} color="var(--danger)" />
            <StatCard label="Tổng hoa hồng Shopee" value={t ? fmt(t.totalCommission) : "—"} sub={t ? `${t.shopeeCount} Shopee account` : ""} color="#ee4d2d" />
            <StatCard label="Lợi nhuận thực tế" value={t ? fmt(realProfit) : "—"} sub={profitSub} color={realProfit >= 0 ? "var(--success)" : "var(--danger)"} />
            <StatCard label="ADS/HH" value={adsHHPct == null ? "—" : adsHHPct.toFixed(1) + "%"} sub={adsHHPct == null ? "" : adsHHPct < 65 ? "Lãi tốt" : adsHHPct <= 110 ? "Cảnh báo" : "Lỗ nặng"} color={adsHHColor} />
            {isFullRange && (
              <StatCard label="Tổng thuế (cả năm)" value={t ? fmt(t.totalTax || 0) : "—"} sub={t ? `${t.groupsWithTax}/${t.groupsWithTax + t.groupsWithoutTax} nhóm đã cấu hình` : ""} color="var(--warn)" />
            )}
            <StatCard label="Chi phí văn phòng" value={t ? fmt(officeExp) : "—"} sub={t ? `${t.officeExpenseCount || 0} khoản chi` : ""} color="#8B5CF6" />
          </div>
        )
      })()}

      {/* Group cards */}
      {loading ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Đang tải...</div>
      ) : data ? (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
          {data.groups.length === 0 && data.ungrouped.adAccounts.length === 0 && data.ungrouped.shopees.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
              Chưa có data. Vào <a href="/nhom-tai-khoan" style={{ color: "var(--accent)" }}>Nhóm tài khoản</a> để tạo nhóm.
            </div>
          ) : null}

          {(() => {
            // Same logic như isFullRange ở trên (full range = from = DATA_LOCK_DATE && span >= 60 ngày)
            const showTax = (() => {
              if (from !== DATA_LOCK_DATE) return false
              const fromD = new Date(from + "T00:00:00Z")
              const toD = new Date(to + "T00:00:00Z")
              const diffDays = (toD.getTime() - fromD.getTime()) / (24 * 3600 * 1000)
              return diffDays >= 60
            })()
            return data.groups.map((g: any, idx: number) => (
              <GroupCard
                key={g.id}
                index={idx + 1}
                group={g}
                showTax={showTax}
                onConfigTax={() => openTaxModal(g)}
                onShopeeBonus={(s: any) => setBonusModal({ open: true, shopeeAccountId: s.id, shopeeName: s.name })}
              />
            ))
          })()}
        </div>
      ) : null}

      {taxModal.open && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", padding: 20 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 760, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column" as const, position: "relative" as const }}>
            <button onClick={() => setTaxModal({ ...taxModal, open: false })} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1, zIndex: 1 }}>×</button>
            <div style={{ padding: "16px 22px 12px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Trang Tính Thuế — {taxModal.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Tính theo Luật 2026. Auto-fill từ data {from} → {to}.</div>
            </div>

            <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
              {[
                { v: "personal", l: "👤 Thuế TNCN" },
                { v: "household", l: "🏠 Hộ kinh doanh" },
                { v: "company", l: "🏢 Thuế TNDN" },
              ].map(t => (
                <button key={t.v} onClick={() => setTaxTab(t.v as any)} style={{ flex: 1, padding: "10px 14px", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "none", background: taxTab === t.v ? "var(--bg3)" : "transparent", color: taxTab === t.v ? "var(--accent)" : "var(--muted)", borderBottom: taxTab === t.v ? "2px solid var(--accent)" : "2px solid transparent" }}>{t.l}</button>
              ))}
            </div>

            <div style={{ padding: 22, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              {/* Inputs */}
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>📋 Thông tin</div>

                {taxTab === "personal" && (
                  <>
                    <NumField label="Tổng thu nhập năm (Gross)" value={tncnInp.grossYear} onChange={v => setTncnInp({ ...tncnInp, grossYear: v })} suffix="đ" />
                    <NumField label="Bảo hiểm cả năm (BHXH+BHYT+BHTN)" value={tncnInp.insurance} onChange={v => setTncnInp({ ...tncnInp, insurance: v })} suffix="đ" />
                    <NumField label="Số người phụ thuộc" value={tncnInp.dependents} onChange={v => setTncnInp({ ...tncnInp, dependents: v })} suffix="người" />
                    <NumField label="Khoản giảm trừ khác" value={tncnInp.otherDeduction} onChange={v => setTncnInp({ ...tncnInp, otherDeduction: v })} suffix="đ" />
                    <div style={{ padding: "8px 10px", borderRadius: 5, background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", fontSize: 10.5, color: "var(--warn)" }}>
                      ⚠ Mức giảm trừ Luật 2026: Bản thân 15.5tr/tháng · Phụ thuộc 6.2tr/người/tháng
                    </div>
                  </>
                )}

                {taxTab === "household" && (
                  <>
                    <div>
                      <FieldLabel>Ngành nghề kinh doanh</FieldLabel>
                      <select value={hkdInp.industry} onChange={e => setHkdInp({ ...hkdInp, industry: e.target.value })} style={inpStyle}>
                        {HKD_INDUSTRIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <NumField label="Doanh thu năm" value={hkdInp.revenue} onChange={v => {
                      // Auto-fill DT miễn: mặc định 1 tỷ cho Nhóm 1 + 2, không miễn cho Nhóm 3+
                      const exempt = v < 3_000_000_000 ? 1_000_000_000 : 0
                      setHkdInp({ ...hkdInp, revenue: v, exempt })
                    }} suffix="đ" />
                    <div>
                      <FieldLabel>Phương pháp tính thuế TNCN</FieldLabel>
                      <select value={hkdInp.method} onChange={e => setHkdInp({ ...hkdInp, method: e.target.value as any })} style={inpStyle}>
                        <option value="direct">PP trực tiếp: (DT − số miễn) × tỷ lệ %</option>
                        <option value="income">PP thu nhập: TNT × 15%</option>
                      </select>
                    </div>
                    {hkdInp.method === "income" && (
                      <NumField label="Chi phí được trừ" value={hkdInp.expense} onChange={v => setHkdInp({ ...hkdInp, expense: v })} suffix="đ" />
                    )}
                    {hkdInp.method === "direct" && (
                      <NumField label="Số doanh thu miễn thuế TNCN" value={hkdInp.exempt} onChange={v => setHkdInp({ ...hkdInp, exempt: v })} suffix="đ" />
                    )}
                    {hkdInp.revenue > 0 && (
                      <div style={{ padding: "8px 10px", borderRadius: 5, background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", fontSize: 10.5, color: "var(--warn)" }}>
                        ⚠ {hkdInp.revenue < 1_000_000_000 ? "Nhóm 1: <1 tỷ — miễn thuế hoàn toàn" : hkdInp.revenue < 3_000_000_000 ? "Nhóm 2: 1 − 3 tỷ" : hkdInp.revenue < 50_000_000_000 ? "Nhóm 3: 3 − 50 tỷ" : "Nhóm 4: >50 tỷ"}
                        <br/>GTGT tính trên tổng DT, TNCN tính theo phương pháp đã chọn.
                      </div>
                    )}
                  </>
                )}

                {taxTab === "company" && (
                  <>
                    <div>
                      <FieldLabel>Loại doanh nghiệp</FieldLabel>
                      <select value={tndnInp.companyType} onChange={e => setTndnInp({ ...tndnInp, companyType: e.target.value })} style={inpStyle}>
                        {TNDN_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    <NumField label="Tổng doanh thu" value={tndnInp.revenue} onChange={v => setTndnInp({ ...tndnInp, revenue: v })} suffix="đ" />
                    <NumField label="Tổng chi phí được trừ" value={tndnInp.expense} onChange={v => setTndnInp({ ...tndnInp, expense: v })} suffix="đ" />
                    <NumField label="Thu nhập miễn thuế / Lỗ kết chuyển" value={tndnInp.exemptIncome} onChange={v => setTndnInp({ ...tndnInp, exemptIncome: v })} suffix="đ" />
                    <div style={{ padding: "8px 10px", borderRadius: 5, background: "rgba(245,166,35,.08)", border: "1px solid rgba(245,166,35,.25)", fontSize: 10.5, color: "var(--warn)" }}>
                      💡 Thuế suất: DN nhỏ ≤3 tỷ = 15% · DN vừa 3-50 tỷ = 17% · DN khác = 20%
                    </div>
                  </>
                )}
              </div>

              {/* Outputs */}
              <div style={{ display: "flex", flexDirection: "column" as const, gap: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>🔥 Kết quả tính</div>

                {taxTab === "personal" && taxOutputs && (
                  <>
                    <ResultCard label="Thu nhập chịu thuế" value={fmt(taxOutputs.taxableIncome || 0)} bg="rgba(79,126,248,.10)" color="var(--accent)" />
                    <ResultCard label="Thuế TNCN phải nộp" value={fmt(taxOutputs.taxAmount || 0)} bg="rgba(232,77,45,.10)" color="var(--danger)" big />
                    <ResultCard label="Thu nhập thực nhận (Net)" value={fmt(taxOutputs.netIncome || 0)} bg="rgba(46,204,143,.10)" color="var(--success)" />
                    {taxOutputs.brackets?.length > 0 && (
                      <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6, padding: "8px 12px" }}>
                        {taxOutputs.brackets.map((b: any, i: number) => (
                          <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11, borderBottom: i < taxOutputs.brackets.length - 1 ? "1px solid var(--border)" : "none" }}>
                            <span style={{ color: "var(--muted)" }}>{b.range}</span>
                            <span style={{ fontWeight: 500 }}>{fmt(b.tax)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {taxTab === "household" && taxOutputs && (
                  <>
                    <ResultCard label={`Thuế GTGT phải nộp (${taxOutputs.vatRate}%)`} value={fmt(taxOutputs.vatTax || 0)} bg="rgba(79,126,248,.10)" color="var(--accent)" sub={`Tính trên tổng DT: ${fmt(taxOutputs.vatBase || 0)}`} />
                    <ResultCard label={`Thuế TNCN phải nộp (${taxOutputs.tncnRate}%)`} value={fmt(taxOutputs.tncnTax || 0)} bg="rgba(245,166,35,.10)" color="var(--warn)" sub={taxOutputs.methodLabel} />
                    <ResultCard label="Tổng thuế phải nộp" value={fmt(taxOutputs.totalTax || 0)} bg="rgba(155,89,182,.10)" color="#9b59b6" big />
                    <ResultCard label="Thu nhập thực nhận (Net)" value={fmt(taxOutputs.netIncome || 0)} bg="rgba(46,204,143,.10)" color="var(--success)" />
                  </>
                )}

                {taxTab === "company" && taxOutputs && (
                  <>
                    <ResultCard label="Thu nhập chịu thuế" value={fmt(taxOutputs.taxableIncome || 0)} bg="rgba(79,126,248,.10)" color="var(--accent)" />
                    <ResultCard label="Thuế suất áp dụng" value={`${taxOutputs.taxRate}%`} bg="rgba(46,204,143,.10)" color="var(--success)" />
                    <ResultCard label="Thuế TNDN phải nộp" value={fmt(taxOutputs.taxAmount || 0)} bg="rgba(232,77,45,.10)" color="var(--danger)" big />
                    <ResultCard label="Thu nhập thực nhận (sau thuế)" value={fmt(taxOutputs.netIncome || 0)} bg="rgba(46,204,143,.10)" color="var(--success)" />
                  </>
                )}
              </div>
            </div>

            <div style={{ padding: "12px 22px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10.5, color: "var(--muted)" }}>
                Auto-fill: hoa hồng nhóm = {fmt(taxModal.commission)} · chi FB nhóm = {fmt(taxModal.spend)}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setTaxModal({ ...taxModal, open: false })} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>Huỷ</button>
                <button onClick={saveTax} disabled={taxSaving} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: taxSaving ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: taxSaving ? 0.6 : 1 }}>{taxSaving ? "Đang lưu..." : "💾 Lưu kết quả"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bonus Modal — quản lý tiền thưởng Shopee theo tháng */}
      {bonusModal.open && (
        <BonusModal
          shopeeAccountId={bonusModal.shopeeAccountId}
          shopeeName={bonusModal.shopeeName}
          from={from}
          to={to}
          onClose={() => setBonusModal({ open: false, shopeeAccountId: "", shopeeName: "" })}
          onChanged={() => { try { localStorage.removeItem(`dashboard_${from}_${to}`) } catch {}; load() }}
        />
      )}
    </AppLayout>
  )
}

const inp = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, padding: "0 8px", height: 28, outline: "none" } as React.CSSProperties
const inpStyle = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, padding: "0 10px", height: 34, width: "100%", outline: "none", boxSizing: "border-box" } as React.CSSProperties

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>{children}</label>
}

function NumField({ label, value, onChange, suffix }: { label: string; value: number; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div style={{ position: "relative" as const }}>
        <input type="text" inputMode="numeric" value={value ? Number(value).toLocaleString("vi-VN") : ""} onChange={e => onChange(Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ ...inpStyle, paddingRight: suffix ? 40 : 10 }} placeholder="0" />
        {suffix && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--muted)", pointerEvents: "none" as const }}>{suffix}</span>}
      </div>
    </div>
  )
}

function ResultCard({ label, value, bg, color, big, sub }: { label: string; value: string; bg: string; color: string; big?: boolean; sub?: string }) {
  return (
    <div style={{ padding: "10px 14px", background: bg, border: `1px solid ${color}33`, borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: big ? 22 : 16, fontWeight: 700, color, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// Mobile metric card — icon vuông màu + label nhỏ + giá trị to + sub.
function MetricCardMobile({ icon, iconBg, iconColor, label, value, sub }: { icon: string; iconBg: string; iconColor: string; label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "var(--bg2)", borderRadius: 14, padding: "14px 14px 13px", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
      <div style={{ width: 32, height: 32, borderRadius: 10, background: iconBg, color: iconColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, marginBottom: 8 }}>{icon}</div>
      <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, marginTop: 2, letterSpacing: -.4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function GroupCard({ index, group, showTax = true, onConfigTax, onShopeeBonus }: { index: number; group: any; showTax?: boolean; onConfigTax?: () => void; onShopeeBonus?: (s: any) => void }) {
  const ad = group.adAccounts || []
  const sh = group.shopees || []
  const groupSpend = group.groupSpend || 0
  const groupCommission = group.groupCommission || 0
  // ADS/HH = chi / hoa hồng GỐC (không tính bonus). Fallback về groupCommission nếu API cũ.
  const groupCommissionRaw = group.groupCommissionRaw ?? groupCommission
  const adsHHPct = groupCommissionRaw > 0 ? Math.round((groupSpend / groupCommissionRaw) * 1000) / 10 : null
  const adsHHColor = adsHHPct == null ? "var(--muted)" : adsHHPct < 65 ? "var(--success)" : adsHHPct <= 110 ? "var(--warn)" : "var(--danger)"
  const tax = group.tax

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: group.color + "12", borderBottom: "1px solid var(--border)", flexWrap: "wrap" as const, gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: group.color, color: "#fff", fontWeight: 700 }}>N{index}</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{group.name}</span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(79,126,248,.12)", color: "var(--pill-text)" }}>FB ×{ad.length}</span>
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(238,77,45,.12)", color: "#ee4d2d" }}>Shopee ×{sh.length}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11, flexWrap: "wrap" as const }}>
          <div>
            <span style={{ color: "var(--muted)" }}>Chi FB: </span>
            <span style={{ fontWeight: 600, color: "var(--danger)" }}>{fmt(groupSpend)}</span>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>Hoa hồng: </span>
            <span style={{ fontWeight: 600, color: "#ee4d2d" }}>{fmt(groupCommission)}</span>
          </div>
          <div>
            <span style={{ color: "var(--muted)" }}>ADS/HH: </span>
            <span style={{ fontWeight: 600, color: adsHHColor }}>{adsHHPct == null ? "—" : adsHHPct.toFixed(1) + "%"}</span>
          </div>
          {showTax && (
            <div onClick={onConfigTax} title={tax ? `Tap để sửa: ${tax.label}` : "Tap để chọn loại thuế"} style={{ cursor: "pointer", padding: "3px 9px", borderRadius: 5, border: tax ? "1px solid rgba(245,166,35,.3)" : "1px dashed var(--border2)", background: tax ? "rgba(245,166,35,.08)" : "transparent" }}>
              <span style={{ color: "var(--muted)" }}>Thuế: </span>
              {tax ? (
                <span style={{ fontWeight: 600, color: "var(--warn)" }}>{fmt(tax.tax)} <span style={{ fontSize: 9, color: "var(--muted)" }}>({tax.taxRate}%)</span></span>
              ) : (
                <span style={{ color: "var(--muted)", fontStyle: "italic" }}>⚙ Cấu hình</span>
              )}
            </div>
          )}
        </div>
      </div>
      <div style={{ padding: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 6 }}>● FACEBOOK ADS</div>
          {ad.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 0" }}>—</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              {ad.map((a: any, i: number) => (
                <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4 }}>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(79,126,248,.18)", color: "var(--pill-text)", fontWeight: 600, minWidth: 22, textAlign: "center" }}>A{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                    <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>act_{a.actId}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: a.spend > 0 ? "var(--danger)" : "var(--muted)", whiteSpace: "nowrap" as const }}>{a.spend > 0 ? fmt(a.spend) : "—"}</span>
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 3, background: a.status === "ON" ? "rgba(46,204,143,.18)" : "rgba(232,77,45,.18)", color: a.status === "ON" ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>{a.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 6 }}>● SHOPEE AFFILIATE</div>
          {sh.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--muted)", padding: "6px 0" }}>—</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 4 }}>
              {sh.map((s: any, i: number) => (
                <div
                  key={s.id}
                  onClick={() => onShopeeBonus && onShopeeBonus(s)}
                  title="Click để thêm/sửa tiền thưởng Shopee"
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 4, cursor: "pointer", transition: "background .15s" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(238,77,45,.06)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                >
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 2, background: "rgba(238,77,45,.18)", color: "#ee4d2d", fontWeight: 600, minWidth: 22, textAlign: "center" }}>S{i+1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                    <div style={{ fontSize: 9, color: "var(--muted)", fontFamily: "monospace" }}>App {s.appId}</div>
                  </div>
                  {s.bonus > 0 && (
                    <span title={`Tiền thưởng: ${fmt(s.bonus)}`} style={{ fontSize: 10, fontWeight: 600, color: "#10b981", padding: "2px 6px", borderRadius: 4, background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.3)", whiteSpace: "nowrap" }}>
                      +{fmt(s.bonus)}
                    </span>
                  )}
                  <span style={{ fontSize: 11, fontWeight: 600, color: s.commission > 0 ? "#ee4d2d" : "var(--muted)", whiteSpace: "nowrap" as const }}>{s.commission > 0 ? fmt(s.commission) : "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// =================== BONUS MODAL ===================
type BonusItem = { id?: string; programName: string; amount: number; month: string; _new?: boolean; _dirty?: boolean }

function BonusModal({ shopeeAccountId, shopeeName, from, to, onClose, onChanged }: {
  shopeeAccountId: string
  shopeeName: string
  from: string
  to: string
  onClose: () => void
  onChanged: () => void
}) {
  const toast = useToast()
  const [rows, setRows] = useState<BonusItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  // Default month = month của ngày `to` trong filter Dashboard
  const defaultMonth = to.slice(0, 7)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch(`/api/shopee-bonus?shopeeAccountId=${shopeeAccountId}&from=${from}&to=${to}`, { credentials: "include" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setRows((d.items || []).map((it: any) => ({ ...it })))
    } catch (e: any) {
      toast.show(e?.message || "Lỗi tải bonus", "error")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [shopeeAccountId])

  // Functional setState để tránh stale closure khi user thêm/sửa nhiều dòng nhanh.
  function addRow() {
    setRows((prev) => [...prev, { programName: "", amount: 0, month: defaultMonth, _new: true, _dirty: true }])
  }
  function updateRow(idx: number, patch: Partial<BonusItem>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch, _dirty: true } : r)))
  }
  async function deleteRow(idx: number) {
    const row = rows[idx]
    if (row._new || !row.id) {
      setRows((prev) => prev.filter((_, i) => i !== idx))
      return
    }
    try {
      const r = await fetch(`/api/shopee-bonus/${row.id}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${r.status}`)
      }
      setRows((prev) => prev.filter((_, i) => i !== idx))
      onChanged()
      toast.show("Đã xoá", "success")
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    }
  }
  async function saveAll() {
    const dirty = rows.filter((r) => r._dirty)
    if (dirty.length === 0) { onClose(); return }
    // Validate
    for (const r of dirty) {
      if (!r.programName.trim()) { toast.show("Có dòng thiếu tên chương trình", "error"); return }
      if (!Number.isFinite(r.amount) || r.amount < 0) { toast.show(`"${r.programName}" số tiền không hợp lệ`, "error"); return }
      if (!/^\d{4}-\d{2}$/.test(r.month)) { toast.show(`"${r.programName}" thiếu tháng`, "error"); return }
    }
    setSaving(true)
    let okCount = 0
    const errors: string[] = []
    try {
      for (const r of dirty) {
        const payload = { shopeeAccountId, programName: r.programName.trim(), amount: r.amount, month: r.month }
        console.log(`[Bonus save] ${r._new ? "POST" : "PUT id=" + r.id}`, payload)
        try {
          if (r._new) {
            const res = await fetch("/api/shopee-bonus", {
              method: "POST",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`) }
            okCount++
          } else if (r.id) {
            const res = await fetch(`/api/shopee-bonus/${r.id}`, {
              method: "PUT",
              credentials: "include",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ programName: r.programName.trim(), amount: r.amount, month: r.month }),
            })
            if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || `HTTP ${res.status}`) }
            okCount++
          }
        } catch (e: any) {
          errors.push(`"${r.programName}": ${e?.message || "Lỗi"}`)
        }
      }
      if (errors.length > 0) {
        toast.show(`Lưu ${okCount}/${dirty.length}. Lỗi: ${errors.join("; ")}`, "error")
      } else {
        toast.show(`Đã lưu ${okCount} dòng`, "success")
        onClose()
      }
      onChanged()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi lưu", "error")
    } finally {
      setSaving(false)
    }
  }

  const total = rows.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, width: 640, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "#ee4d2d" }}>🎁 Tiền thưởng Shopee</h3>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{shopeeName}</div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 22, padding: 4, lineHeight: 1 }}>×</button>
        </div>

        {/* Header row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 110px 140px 32px", gap: 8, padding: "0 4px", marginBottom: 6, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>
          <div>Tên chương trình</div>
          <div>Tháng</div>
          <div style={{ textAlign: "right" }}>Số tiền (VND)</div>
          <div></div>
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Đang tải...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 12, border: "1px dashed var(--border)", borderRadius: 6 }}>
            Chưa có khoản thưởng nào. Bấm "+ Thêm dòng" để thêm.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
              <div key={r.id || `new-${i}`} style={{ display: "grid", gridTemplateColumns: "1fr 110px 140px 32px", gap: 8, alignItems: "center" }}>
                <input
                  value={r.programName}
                  onChange={(e) => updateRow(i, { programName: e.target.value })}
                  placeholder="VD: Voucher Reels"
                  style={{ height: 32, padding: "0 9px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
                />
                <input
                  type="month"
                  value={r.month}
                  onChange={(e) => updateRow(i, { month: e.target.value })}
                  style={{ height: 32, padding: "0 9px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
                />
                <input
                  value={r.amount === 0 && r._new ? "" : r.amount.toLocaleString("vi-VN")}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[.,\s]/g, "")
                    const n = v === "" ? 0 : Number(v)
                    if (Number.isFinite(n)) updateRow(i, { amount: n })
                  }}
                  placeholder="0"
                  inputMode="numeric"
                  style={{ height: 32, padding: "0 9px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", textAlign: "right" }}
                />
                <button
                  onClick={() => deleteRow(i)}
                  title="Xoá"
                  style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4, fontSize: 14 }}
                >🗑</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <button onClick={addRow} style={{ height: 30, padding: "0 12px", borderRadius: 5, border: "1px dashed var(--border)", background: "transparent", color: "var(--accent)", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
            + Thêm dòng
          </button>
        </div>

        {/* Tổng */}
        <div style={{ marginTop: 14, padding: "10px 12px", background: "rgba(238,77,45,.08)", border: "1px solid rgba(238,77,45,.25)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Tổng tiền thưởng (sẽ cộng vào hoa hồng)</span>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#ee4d2d" }}>{fmt(Math.round(total))}</span>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <button onClick={onClose} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit" }}>Đóng</button>
          <button onClick={saveAll} disabled={saving} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: saving ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Đang lưu..." : "💾 Lưu"}
          </button>
        </div>
      </div>
    </div>
  )
}
