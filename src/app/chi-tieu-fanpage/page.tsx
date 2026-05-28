"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateInputVN from "@/components/DateInputVN"

interface PageItem {
  pageId: string
  pageName: string
  pageFbId: string | null
  campCount: number
  spend: number
  commission: number
  profit: number
}

interface PageResp {
  items: PageItem[]
  totals: { campCount: number; spend: number; commission: number; profit: number }
  totalFbSpend?: number
  matchedSpend?: number
  orphanSpend?: number
  orphanCampCount?: number
  orphanList?: Array<{ fbCampId: string; spend: number }>
}

interface SubItem {
  subId3: string
  orderCount: number
  commission: number
  orderValue: number
  avgPerOrder: number
}

function fmtVND(n: number): string {
  if (!n) return "0đ"
  return Math.round(n).toLocaleString("vi-VN") + "đ"
}

function todayISO(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return d.toISOString().slice(0, 10)
}

export default function ChiTieuFanpagePage() {
  // Default: 7 ngày gần nhất
  const [from, setFrom] = useState(todayISO(-6))
  const [to, setTo] = useState(todayISO(0))
  const [loading, setLoading] = useState(false)
  const [pageData, setPageData] = useState<PageResp | null>(null)
  const [subData, setSubData] = useState<{ items: SubItem[]; totals: any } | null>(null)
  const [msg, setMsg] = useState("")

  async function loadData() {
    setLoading(true)
    setMsg("")
    try {
      const params = new URLSearchParams()
      if (from) params.set("from", from)
      if (to) params.set("to", to)
      const [r1, r2] = await Promise.all([
        fetch(`/api/dashboard/spend-by-page?${params}`, { credentials: "include" }),
        fetch(`/api/dashboard/commission-by-subid3?${params}`, { credentials: "include" }),
      ])
      const d1 = await r1.json()
      const d2 = await r2.json()
      if (!r1.ok || !r2.ok) throw new Error(d1.error || d2.error || "Lỗi")
      setPageData(d1)
      setSubData(d2)
    } catch (e: any) {
      setMsg("❌ " + (e?.message || "Lỗi"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const SH2: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, fontFamily: "inherit", padding: "0 9px", outline: "none", height: 28 }

  return (
    <AppLayout>
      <div style={{ padding: "16px 20px" }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, marginBottom: 6 }}>💰 Chi tiêu theo Fanpage & Hoa hồng theo Sub_id3</h1>
        <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 14 }}>
          Aggregate spend / hoa hồng theo từng fanpage và creator (sub_id3). Filter theo khoảng ngày.
        </div>

        {/* Date range filter */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const, padding: 10, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Từ:</span>
          <DateInputVN value={from} onChange={setFrom} style={{...SH2, width: 130}} placeholder="Từ ngày" />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>Đến:</span>
          <DateInputVN value={to} onChange={setTo} style={{...SH2, width: 130}} placeholder="Đến ngày" />
          <button onClick={loadData} disabled={loading} style={{ padding: "6px 14px", borderRadius: 5, fontSize: 11, cursor: loading ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontWeight: 500, height: 28 }}>
            {loading ? "⏳ Đang tải..." : "🔍 Lọc"}
          </button>
          <div style={{ display: "flex", gap: 4, marginLeft: 8 }}>
            <button onClick={() => { setFrom(todayISO(-6)); setTo(todayISO(0)); setTimeout(loadData, 50) }} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>7 ngày</button>
            <button onClick={() => { setFrom(todayISO(-29)); setTo(todayISO(0)); setTimeout(loadData, 50) }} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>30 ngày</button>
            <button onClick={() => {
              const d = new Date(); const first = new Date(d.getFullYear(), d.getMonth(), 1)
              setFrom(first.toISOString().slice(0, 10)); setTo(todayISO(0)); setTimeout(loadData, 50)
            }} style={{ padding: "4px 10px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}>Tháng này</button>
          </div>
        </div>

        {msg && <div style={{ padding: 10, marginBottom: 12, background: "rgba(232,77,45,.08)", border: "1px solid rgba(232,77,45,.3)", borderRadius: 6, fontSize: 12, color: "var(--danger)" }}>{msg}</div>}

        {/* SECTION 1: Chi tiêu theo Fanpage */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 18 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: 8 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>📊 Chi tiêu theo Fanpage</h2>
            {pageData && (
              <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" as const }}>
                <div>
                  Tổng: <b style={{ color: "var(--danger)" }}>{fmtVND(pageData.totals.spend)}</b> chi · <b style={{ color: "var(--success)" }}>{fmtVND(pageData.totals.commission)}</b> hoa hồng · Lãi: <b style={{ color: pageData.totals.profit >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtVND(pageData.totals.profit)}</b> · {pageData.totals.campCount} camp
                </div>
                {pageData.totalFbSpend != null && (
                  <div style={{ fontSize: 10, marginTop: 2 }}>
                    FB Ads Manager: <b>{fmtVND(pageData.totalFbSpend)}</b>
                    {pageData.orphanSpend != null && pageData.orphanSpend > 100 && (
                      <span style={{ color: "var(--warn)", marginLeft: 6 }}>
                        ⚠️ {fmtVND(pageData.orphanSpend)} ngoài tool ({pageData.orphanCampCount} camp)
                      </span>
                    )}
                  </div>
                )}
                {pageData.orphanList && pageData.orphanList.length > 0 && (
                  <details style={{ marginTop: 4, fontSize: 10, textAlign: "left" as const }}>
                    <summary style={{ cursor: "pointer", color: "var(--warn)" }}>
                      🔍 Xem chi tiết {pageData.orphanCampCount} camp orphan (camp FB ID + spend)
                    </summary>
                    <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 6, padding: 8, background: "var(--bg3)", borderRadius: 4 }}>
                      {pageData.orphanList.map((o) => (
                        <div key={o.fbCampId} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "1px solid var(--border)" }}>
                          <a href={`https://www.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${o.fbCampId}`} target="_blank" rel="noopener" style={{ fontFamily: "monospace", color: "var(--accent)", textDecoration: "none" }}>
                            {o.fbCampId}
                          </a>
                          <span style={{ color: "var(--danger)", fontWeight: 500 }}>{fmtVND(o.spend)}</span>
                        </div>
                      ))}
                      {pageData.orphanCampCount && pageData.orphanCampCount > 50 && (
                        <div style={{ padding: 6, color: "var(--muted)", fontSize: 9 }}>... và {pageData.orphanCampCount - 50} camp khác (chỉ hiện top 50)</div>
                      )}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 800 }}>
              <thead>
                <tr style={{ background: "var(--bg3)" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>FANPAGE</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>SỐ CAMP</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>CHI ADS</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>HOA HỒNG</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>LÃI/LỖ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" as const, color: "var(--muted)" }}>⏳ Đang tải (FB Insights real-time, có thể mất 5-15s)...</td></tr>
                ) : !pageData || pageData.items.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" as const, color: "var(--muted)" }}>Chưa có spend/hoa hồng trong khoảng ngày này</td></tr>
                ) : pageData.items.map((p) => (
                  <tr key={p.pageId} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500 }}>{p.pageName}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const }}>{p.campCount}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, color: "var(--danger)", fontWeight: 500 }}>{fmtVND(p.spend)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, color: "var(--success)" }}>{fmtVND(p.commission)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, fontWeight: 600, color: p.profit >= 0 ? "var(--success)" : "var(--danger)" }}>{fmtVND(p.profit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* SECTION 2: Hoa hồng theo Sub_id3 */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" as const, gap: 8 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>👤 Hoa hồng theo Sub_id3 (creator)</h2>
            {subData && (
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Tổng: <b>{subData.totals.orderCount}</b> đơn · <b style={{ color: "var(--success)" }}>{fmtVND(subData.totals.commission)}</b> hoa hồng · Doanh thu <b>{fmtVND(subData.totals.orderValue)}</b>
              </div>
            )}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse", minWidth: 600 }}>
              <thead>
                <tr style={{ background: "var(--bg3)" }}>
                  <th style={{ padding: "10px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>SUB_ID3</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>SỐ ĐƠN</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>HOA HỒNG</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>DOANH THU</th>
                  <th style={{ padding: "10px 12px", textAlign: "right" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, borderBottom: "1px solid var(--border)" }}>TB/ĐƠN</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" as const, color: "var(--muted)" }}>⏳ Đang tải...</td></tr>
                ) : !subData || subData.items.length === 0 ? (
                  <tr><td colSpan={5} style={{ padding: 32, textAlign: "center" as const, color: "var(--muted)" }}>Chưa có đơn nào có sub_id3 trong khoảng ngày này</td></tr>
                ) : subData.items.map((s) => (
                  <tr key={s.subId3} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 500, fontFamily: "monospace", fontSize: 11 }}>{s.subId3}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const }}>{s.orderCount.toLocaleString("vi-VN")}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, color: "var(--success)", fontWeight: 600 }}>{fmtVND(s.commission)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, color: "var(--muted)" }}>{fmtVND(s.orderValue)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" as const, color: "var(--muted)", fontSize: 11 }}>{fmtVND(s.avgPerOrder)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
