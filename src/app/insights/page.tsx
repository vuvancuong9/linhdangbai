"use client"
// Trang /insights — bảng xếp hạng SP / Fanpage / Khung giờ tháng.
// 3 sections chính. Date range picker mặc định = tháng này.

import { useEffect, useMemo, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateRangePickerVN from "@/components/DateRangePickerVN"
// PERF (R2.C1): XLSX lazy import — chỉ load 300KB khi user click Export.

type SpRow = {
  productItemId: string | null
  productShopId: string | null
  productName: string
  shopName: string | null
  categoryL1: string | null
  categoryL2: string | null
  campCount: number
  orderCount: number
  commission: number
  spend: number
  profit: number | null  // null khi spend không chính xác (range != all)
  pageNames: string[]
}
type MatrixRow = { pageName: string; totalCommission: number; cells: Array<{ category: string; commission: number; orders: number; campCount: number }> }
type Insights = {
  range: { since: string; until: string }
  spendAccurate: boolean  // false → ẩn cột spend/profit hoặc cảnh báo
  summary: { totalOrders: number; totalCommission: number; totalSpend: number | null; totalProfit: number | null; spProductCount: number; pageCount: number }
  topByProfit: SpRow[]
  worstByProfit: SpRow[]
  topByCommission: SpRow[]
  topByOrders: SpRow[]
  matrix: MatrixRow[]
  pageList: string[]
  catList: string[]
  hourly: Array<{ hour: number; commission: number; orderCount: number }>
}

const fmt = (n: number) => "₫" + (n || 0).toLocaleString("vi-VN")
const fmtK = (n: number) => {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "tỷ"
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + "tr"
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(0) + "k"
  return String(n)
}

// Default: tháng này (from = 1, until = today VN)
function defaultRange() {
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), 1)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  return { since: iso(first), until: iso(today) }
}

export default function InsightsPage() {
  const dr = defaultRange()
  const [since, setSince] = useState(dr.since)
  const [until, setUntil] = useState(dr.until)
  const [data, setData] = useState<Insights | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [tab, setTab] = useState<"topProfit" | "worstProfit" | "topCommission" | "topOrders">("topProfit")

  async function load() {
    setLoading(true); setError("")
    try {
      const r = await fetch(`/api/insights?since=${since}&until=${until}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi server")
      setData(d)
    } catch (e: any) {
      setError(e?.message || "Lỗi không xác định")
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [since, until])  // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data) return []
    if (tab === "topProfit") return data.topByProfit
    if (tab === "worstProfit") return data.worstByProfit
    if (tab === "topCommission") return data.topByCommission
    return data.topByOrders
  }, [data, tab])

  // Heatmap colors cho matrix — light to dark blue theo commission
  const matrixColorScale = useMemo(() => {
    if (!data) return [0, 1]
    let max = 0
    for (const row of data.matrix) for (const cell of row.cells) max = Math.max(max, cell.commission)
    return [0, max || 1]
  }, [data])

  const hourlyMax = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.hourly.map(h => h.commission))
  }, [data])

  // ===== EXPORT EXCEL — 4 sheets =====
  async function exportExcel() {
    if (!data) return
    const XLSX = await import("xlsx")
    const wb = XLSX.utils.book_new()

    // Helper map SpRow → row dict cho sheet
    const spToRow = (r: SpRow, idx: number) => ({
      "STT": idx + 1,
      "Sản phẩm": r.productName,
      "Shop": r.shopName || "",
      "Item ID": r.productItemId || "",
      "Shop ID": r.productShopId || "",
      "Link Shopee": r.productItemId ? `https://shopee.vn/product/${r.productShopId}/${r.productItemId}` : "",
      "Ngành L1": r.categoryL1 || "",
      "Ngành L2": r.categoryL2 || "",
      "Fanpage": r.pageNames.join(", "),
      "Số đơn": r.orderCount,
      "Hoa hồng": Math.round(r.commission),
      "Chi FB (Camp.spend)": r.spend,
      "Lợi nhuận": r.profit,
      "Số camp": r.campCount,
    })

    // Sheet 1: TOP LAI
    const wsTopProfit = XLSX.utils.json_to_sheet(data.topByProfit.map(spToRow))
    XLSX.utils.book_append_sheet(wb, wsTopProfit, "Top lãi")
    // Sheet 2: TOP LO
    const wsWorstProfit = XLSX.utils.json_to_sheet(data.worstByProfit.map(spToRow))
    XLSX.utils.book_append_sheet(wb, wsWorstProfit, "Top lỗ")
    // Sheet 3: TOP HH
    const wsTopComm = XLSX.utils.json_to_sheet(data.topByCommission.map(spToRow))
    XLSX.utils.book_append_sheet(wb, wsTopComm, "Top HH")
    // Sheet 4: TOP DON
    const wsTopOrders = XLSX.utils.json_to_sheet(data.topByOrders.map(spToRow))
    XLSX.utils.book_append_sheet(wb, wsTopOrders, "Top đơn")

    // Sheet 5: HEATMAP Fanpage × Category — flatten thành long format
    const heatmapRows: any[] = []
    for (const row of data.matrix) {
      for (const cell of row.cells) {
        if (cell.commission > 0 || cell.orders > 0) {
          heatmapRows.push({
            "Fanpage": row.pageName,
            "Ngành hàng": cell.category,
            "Hoa hồng": Math.round(cell.commission),
            "Số đơn": cell.orders,
            "Số camp": cell.campCount,
          })
        }
      }
    }
    const wsHeatmap = XLSX.utils.json_to_sheet(heatmapRows)
    XLSX.utils.book_append_sheet(wb, wsHeatmap, "Fanpage × Ngành")

    // Sheet 6: KHUNG GIO
    const hourlyRows = data.hourly.map(h => ({
      "Giờ VN": `${h.hour}h`,
      "Hoa hồng": h.commission,
      "Số đơn": h.orderCount,
    }))
    const wsHourly = XLSX.utils.json_to_sheet(hourlyRows)
    XLSX.utils.book_append_sheet(wb, wsHourly, "Khung giờ")

    // Sheet 7: SUMMARY
    const wsSummary = XLSX.utils.aoa_to_sheet([
      ["Khoảng thời gian", `${data.range.since} → ${data.range.until}`],
      [""],
      ["Tổng hoa hồng", data.summary.totalCommission],
      ["Tổng chi FB", data.summary.totalSpend],
      ["Lợi nhuận ước tính", data.summary.totalProfit],
      ["Tổng đơn", data.summary.totalOrders],
      ["Số SP có HH", data.summary.spProductCount],
      ["Số fanpage có HH", data.summary.pageCount],
    ])
    XLSX.utils.book_append_sheet(wb, wsSummary, "Tổng quan")

    // File name: insights_YYYYMMDD-YYYYMMDD.xlsx
    const cleanSince = data.range.since.replace(/-/g, "")
    const cleanUntil = data.range.until.replace(/-/g, "")
    XLSX.writeFile(wb, `insights_${cleanSince}-${cleanUntil}.xlsx`)
  }

  return (
    <AppLayout>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>📊 Insights — Top SP / Fanpage / Khung giờ</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            Phân tích hoa hồng theo SP, ngành hàng × fanpage, khung giờ đăng. Mặc định: tháng này.
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <DateRangePickerVN
            from={since} to={until}
            onChange={(f, t) => { setSince(f); setUntil(t) }}
            width={290} align="right"
          />
          <button onClick={exportExcel} disabled={!data || loading}
            title="Xuất file Excel: Top lãi/lỗ/HH/đơn + Fanpage×Ngành + Khung giờ + Tổng quan (7 sheets)"
            style={{ height: 30, padding: "0 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: !data || loading ? "not-allowed" : "pointer", border: "1px solid var(--success)", background: data && !loading ? "rgba(46,204,143,.08)" : "transparent", color: "var(--success)", opacity: !data || loading ? .4 : 1 }}>
            📥 Xuất Excel
          </button>
          <button onClick={load} disabled={loading}
            style={{ height: 30, padding: "0 14px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: loading ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", opacity: loading ? .6 : 1 }}>
            {loading ? "⏳ Đang tải..." : "🔄 Tải lại"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(232,77,45,.08)", border: "1px solid rgba(232,77,45,.3)", padding: 10, borderRadius: 6, color: "var(--danger)", fontSize: 12 }}>
          ❌ {error}
        </div>
      )}

      {/* Cảnh báo data sai khi range không full */}
      {data && !data.spendAccurate && (
        <div style={{ background: "rgba(245,158,11,.08)", border: "1px solid rgba(245,158,11,.3)", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "var(--warn)" }}>
          ⚠️ <b>Chi FB + Lợi nhuận đã ẨN</b> cho khoảng thời gian này. Lý do: Campaign.spend trong DB là tổng all-time, không filter theo tháng → hiển thị sẽ SAI. Chỉ "Hoa hồng" + "Số đơn" chính xác cho range đã chọn. Để xem profit chính xác → bỏ chọn ngày (xem all-time) hoặc đợi phase 2 (fetch FB Insights API).
        </div>
      )}

      {/* Summary cards */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
          <StatBox label="Tổng HH" value={fmt(data.summary.totalCommission)} sub={`${data.summary.totalOrders} đơn`} color="#ee4d2d" />
          {data.spendAccurate && data.summary.totalSpend !== null && (
            <>
              <StatBox label="Tổng chi FB" value={fmt(data.summary.totalSpend)} sub="Camp.spend tổng" color="var(--danger)" />
              <StatBox label="Lợi nhuận ước tính" value={fmt(data.summary.totalProfit || 0)} sub="HH net − Ads × phụ phí" color={(data.summary.totalProfit || 0) >= 0 ? "var(--success)" : "var(--danger)"} />
            </>
          )}
          <StatBox label="Số SP" value={String(data.summary.spProductCount)} sub="" color="var(--accent)" />
          <StatBox label="Số fanpage" value={String(data.summary.pageCount)} sub="có HH" color="#8b5cf6" />
        </div>
      )}

      {/* SECTION 1: Top SP */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" as const }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>🏆 Top 20 Sản phẩm</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 4, background: "var(--bg3)", borderRadius: 8, padding: 3 }}>
            {([
              { k: "topProfit", l: "💰 Top lãi" },
              { k: "worstProfit", l: "📉 Top lỗ" },
              { k: "topCommission", l: "🛒 Top HH" },
              { k: "topOrders", l: "📦 Top đơn" },
            ] as const).map(t => (
              <button key={t.k} onClick={() => setTab(t.k)}
                style={{ padding: "5px 12px", fontSize: 12, fontWeight: 500, border: "none", background: tab === t.k ? "var(--bg2)" : "transparent", color: tab === t.k ? "var(--text)" : "var(--muted)", borderRadius: 5, cursor: "pointer", fontFamily: "inherit" }}>
                {t.l}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)" }}>⏳ Đang phân tích data...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Không có data trong khoảng này. Kiểm tra: đã upload commission CSV chưa? Camp có productItemId chưa?
          </div>
        ) : (
          <div style={{ overflow: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg3)" }}>
                  <th style={th()}>#</th>
                  <th style={{ ...th(), minWidth: 240 }}>Sản phẩm</th>
                  <th style={th()}>Ngành hàng</th>
                  <th style={th()}>Fanpage</th>
                  <th style={{ ...th(), textAlign: "right" }}>Đơn</th>
                  <th style={{ ...th(), textAlign: "right" }}>Hoa hồng</th>
                  {data?.spendAccurate && <th style={{ ...th(), textAlign: "right" }}>Chi FB</th>}
                  {data?.spendAccurate && <th style={{ ...th(), textAlign: "right" }}>Lợi nhuận</th>}
                  <th style={{ ...th(), textAlign: "right" }}>Camp</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={td()}>{i + 1}</td>
                    <td style={td()}>
                      <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{r.productName}</div>
                      {r.shopName && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>🏪 {r.shopName}</div>}
                      {r.productItemId && <div style={{ fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                        <a href={`https://shopee.vn/product/${r.productShopId}/${r.productItemId}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>shopee.vn →</a>
                      </div>}
                    </td>
                    <td style={td()}>
                      {r.categoryL1 ? (
                        <>
                          <div style={{ fontSize: 11 }}>{r.categoryL1}</div>
                          {r.categoryL2 && <div style={{ fontSize: 10, color: "var(--muted)" }}>{r.categoryL2}</div>}
                        </>
                      ) : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={td()}>
                      {r.pageNames.length > 0 ? r.pageNames.join(", ") : <span style={{ color: "var(--muted)" }}>—</span>}
                    </td>
                    <td style={{ ...td(), textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.orderCount}</td>
                    <td style={{ ...td(), textAlign: "right", color: "#ee4d2d", fontWeight: 600 }}>{fmt(Math.round(r.commission))}</td>
                    {data?.spendAccurate && (
                      <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>{fmt(r.spend)}</td>
                    )}
                    {data?.spendAccurate && r.profit !== null && (
                      <td style={{ ...td(), textAlign: "right", fontWeight: 700, color: r.profit > 0 ? "var(--success)" : r.profit < 0 ? "var(--danger)" : "var(--muted)" }}>
                        {(r.profit > 0 ? "+" : "") + fmt(r.profit)}
                      </td>
                    )}
                    <td style={{ ...td(), textAlign: "right", color: "var(--muted)" }}>{r.campCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ padding: "8px 16px", fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
          * Chi FB là Campaign.spend lưu trong DB (cập nhật lần sync gần nhất, có thể không khớp 100% với khoảng tháng đã chọn).
        </div>
      </div>

      {/* SECTION 2: Page × Category Heatmap */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700 }}>
          🎯 Fanpage × Ngành hàng (HH trong tháng)
        </div>
        {data && data.matrix.length > 0 ? (
          <div style={{ overflow: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11, width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...th(), background: "var(--bg3)", minWidth: 160, position: "sticky" as const, left: 0, zIndex: 2 }}>Fanpage</th>
                  {data.catList.map(c => (
                    <th key={c} style={{ ...th(), background: "var(--bg3)", textAlign: "center", minWidth: 90 }}>{c}</th>
                  ))}
                  <th style={{ ...th(), background: "var(--bg3)", textAlign: "right", minWidth: 90 }}>Tổng</th>
                </tr>
              </thead>
              <tbody>
                {data.matrix.map((row, i) => (
                  <tr key={i} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ ...td(), fontWeight: 600, position: "sticky" as const, left: 0, background: "var(--bg2)", zIndex: 1 }}>{row.pageName}</td>
                    {row.cells.map((cell, j) => {
                      const ratio = matrixColorScale[1] > 0 ? cell.commission / matrixColorScale[1] : 0
                      const bg = cell.commission > 0 ? `rgba(238,77,45,${.05 + ratio * .35})` : "transparent"
                      return (
                        <td key={j} style={{ ...td(), textAlign: "center", background: bg, fontVariantNumeric: "tabular-nums" }}>
                          {cell.commission > 0 ? (
                            <>
                              <div style={{ fontWeight: 700 }}>{fmtK(cell.commission)}</div>
                              <div style={{ fontSize: 9, color: "var(--muted)" }}>{cell.orders} đơn · {cell.campCount} camp</div>
                            </>
                          ) : <span style={{ color: "var(--muted)" }}>—</span>}
                        </td>
                      )
                    })}
                    <td style={{ ...td(), textAlign: "right", fontWeight: 700, color: "#ee4d2d" }}>{fmtK(row.totalCommission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
            Chưa có data. Cần: camp có productCategoryL1 (sync product check Shopee) + post link đến fanpage.
          </div>
        )}
      </div>

      {/* SECTION 3: Khung giờ đăng */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>⏰ Khung giờ đăng → Hoa hồng (giờ VN)</div>
        {data && data.hourly.some(h => h.commission > 0) ? (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 180 }}>
            {data.hourly.map(h => {
              const heightPct = (h.commission / hourlyMax) * 100
              const isProductive = h.commission >= hourlyMax * 0.5
              return (
                <div key={h.hour} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: "var(--muted)", height: 14, fontWeight: 600 }}>
                    {h.commission > 0 ? fmtK(h.commission) : ""}
                  </div>
                  <div style={{
                    width: "100%", height: `${heightPct}%`, minHeight: h.commission > 0 ? 2 : 0,
                    background: isProductive ? "linear-gradient(180deg, var(--success), #10b981)" : "linear-gradient(180deg, var(--accent), #2563eb)",
                    borderRadius: "3px 3px 0 0",
                  }} title={`${h.hour}h: ${fmt(h.commission)} (${h.orderCount} đơn)`} />
                  <div style={{ fontSize: 10, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{h.hour}h</div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
            Chưa có data. Cần: Post có postedAt + camp.campId match OrderCommission.subId2.
          </div>
        )}
        {data && data.hourly.some(h => h.commission > 0) && (
          <div style={{ marginTop: 14, padding: "10px 12px", background: "var(--bg3)", borderRadius: 6, fontSize: 11, color: "var(--muted)" }}>
            💡 Giờ đậm xanh (≥50% peak) là khung đăng convert tốt nhất. Tập trung schedule post vào những giờ này.
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function StatBox({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color, marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function th(): React.CSSProperties {
  return { padding: "10px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: .5, whiteSpace: "nowrap" }
}
function td(): React.CSSProperties {
  return { padding: "10px 12px", verticalAlign: "top", fontSize: 12 }
}
