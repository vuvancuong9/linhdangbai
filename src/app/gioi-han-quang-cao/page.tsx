"use client"
import { useEffect, useMemo, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"

// Trang Giới hạn QC Page: hiện list page kèm số ads đang chạy + ngưỡng FB,
// % usage, status (ok/warning/over). Sync cron 6h sang hoặc manual qua nút Sync ngay.

type Page = {
  id: string
  name: string
  pageId: string
  accountId: string | null
  account: { name: string; actId: string } | null
  pageAdsTotal: number | null
  pageAdsCurrentAccount: number | null
  pageAdLimit: number | null
  pageAdLimitCheckedAt: string | null
  pageAdLimitError: string | null
  usagePct: number | null
  otherAccountAds: number | null
  status: "ok" | "warning" | "over" | "no-data" | "error"
}
type Resp = {
  pages: Page[]
  lastSyncAt: string | null
  counts: {
    total: number
    ok: number
    warning: number
    over: number
    noData: number
    error: number
  }
}

type Tab = "all" | "over" | "warning" | "ok" | "no-data" | "error"

function fmtDateTime(s: string | null): string {
  if (!s) return "—"
  try {
    const d = new Date(s)
    return d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", year: "numeric" })
  } catch {
    return s
  }
}

const statusColors: Record<Page["status"], { bg: string; bd: string; col: string; label: string }> = {
  ok: { bg: "rgba(46,204,143,.12)", bd: "rgba(46,204,143,.4)", col: "var(--success)", label: "OK" },
  warning: { bg: "rgba(245,166,35,.15)", bd: "rgba(245,166,35,.5)", col: "var(--warn)", label: "Cảnh báo" },
  over: { bg: "rgba(232,77,45,.15)", bd: "rgba(232,77,45,.5)", col: "var(--danger)", label: "Vượt limit" },
  "no-data": { bg: "rgba(120,120,120,.1)", bd: "rgba(120,120,120,.3)", col: "var(--muted)", label: "Chưa sync" },
  error: { bg: "rgba(232,77,45,.1)", bd: "rgba(232,77,45,.3)", col: "var(--danger)", label: "Lỗi" },
}

export default function GioiHanQuangCaoPage() {
  const toast = useToast()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<Tab>("all")
  const [search, setSearch] = useState("")

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/pages/ad-limit-status", { credentials: "include" })
      if (!r.ok) throw new Error("HTTP " + r.status)
      const d = await r.json()
      setData(d)
    } catch (e: any) {
      toast.show("❌ Load lỗi: " + (e?.message || "unknown"), "error" as any)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line

  // Filter + sort: tab + search. Sort: usage desc, no-data ở cuối.
  const filteredPages = useMemo(() => {
    if (!data) return []
    let arr = data.pages
    if (tab === "over") arr = arr.filter(p => p.status === "over")
    else if (tab === "warning") arr = arr.filter(p => p.status === "warning")
    else if (tab === "ok") arr = arr.filter(p => p.status === "ok")
    else if (tab === "no-data") arr = arr.filter(p => p.status === "no-data")
    else if (tab === "error") arr = arr.filter(p => p.status === "error")
    const q = search.trim().toLowerCase()
    if (q) {
      arr = arr.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.pageId.includes(q) ||
        (p.account?.name || "").toLowerCase().includes(q)
      )
    }
    // Sort: usagePct desc (over đứng đầu). no-data ở cuối.
    return [...arr].sort((a, b) => {
      const ap = a.usagePct ?? -1
      const bp = b.usagePct ?? -1
      return bp - ap
    })
  }, [data, tab, search])

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>⚠️ Giới hạn quảng cáo Page</h2>
            <p style={{ margin: "4px 0 0", color: "var(--muted)", fontSize: 12 }}>
              FB limit 250 ads ACTIVE/page (gồm cả ads từ TKQC khác chạy trên page). Tự động sync mỗi 30 phút.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              Sync gần nhất: <strong style={{ color: "var(--text)" }}>{fmtDateTime(data?.lastSyncAt || null)}</strong>
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {([
            { k: "all" as const, label: "Tất cả", count: data?.counts.total ?? 0, col: "var(--text)" },
            { k: "over" as const, label: "🔴 Vượt limit", count: data?.counts.over ?? 0, col: "var(--danger)" },
            { k: "warning" as const, label: "🟡 Cảnh báo ≥80%", count: data?.counts.warning ?? 0, col: "var(--warn)" },
            { k: "ok" as const, label: "🟢 OK <80%", count: data?.counts.ok ?? 0, col: "var(--success)" },
            { k: "no-data" as const, label: "Chưa sync", count: data?.counts.noData ?? 0, col: "var(--muted)" },
            { k: "error" as const, label: "❌ Lỗi", count: data?.counts.error ?? 0, col: "var(--danger)" },
          ]).map(t => (
            <button
              key={t.k}
              onClick={() => setTab(t.k)}
              style={{
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${tab === t.k ? "var(--accent)" : "var(--border2)"}`,
                background: tab === t.k ? "var(--pill-bg)" : "var(--bg2)",
                color: t.col,
                fontWeight: tab === t.k ? 600 : 400,
              }}
            >
              {t.label} <span style={{ opacity: 0.7 }}>({t.count})</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="🔍 Tìm theo tên page / pageId / TKQC..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border2)", background: "var(--bg2)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", maxWidth: 400 }}
        />

        {/* Table */}
        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Đang tải...</div>
        ) : !data ? null : filteredPages.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)" }}>Không có page nào.</div>
        ) : (
          <div style={{ overflowX: "auto", border: "1px solid var(--border2)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ background: "var(--bg2)" }}>
                <tr>
                  <th style={th}>STT</th>
                  <th style={{ ...th, textAlign: "left" }}>TÊN PAGE</th>
                  <th style={{ ...th, textAlign: "left" }}>TKQC GÁN</th>
                  <th style={th}>QC TKQC NÀY</th>
                  <th style={th}>QC TKQC KHÁC</th>
                  <th style={th}>TỔNG</th>
                  <th style={th}>GIỚI HẠN</th>
                  <th style={th}>% USAGE</th>
                  <th style={th}>STATUS</th>
                  <th style={{ ...th, textAlign: "left" }}>CHECKED</th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.map((p, idx) => {
                  const c = statusColors[p.status]
                  const pct = p.usagePct ?? 0
                  return (
                    <tr key={p.id} style={{ borderTop: "1px solid var(--border2)" }}>
                      <td style={td}>{idx + 1}</td>
                      <td style={{ ...td, textAlign: "left", maxWidth: 260 }}>
                        <div style={{ fontWeight: 500 }}>{p.name}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{p.pageId}</div>
                      </td>
                      <td style={{ ...td, textAlign: "left", fontSize: 11 }}>
                        {p.account ? p.account.name : <span style={{ color: "var(--muted)" }}>chưa gán</span>}
                      </td>
                      <td style={{ ...td, color: "var(--text)" }}>{p.pageAdsCurrentAccount ?? "—"}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{p.otherAccountAds ?? "—"}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{p.pageAdsTotal ?? "—"}</td>
                      <td style={{ ...td, color: "var(--muted)" }}>{p.pageAdLimit ?? "—"}</td>
                      <td style={td}>
                        {p.usagePct != null ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "center" }}>
                            <div style={{ flex: 1, minWidth: 60, maxWidth: 100, height: 6, background: "var(--bg3)", borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: c.col }} />
                            </div>
                            <span style={{ fontWeight: 600, color: c.col, minWidth: 36, textAlign: "right" }}>{pct}%</span>
                          </div>
                        ) : "—"}
                      </td>
                      <td style={td}>
                        <span style={{ padding: "3px 8px", borderRadius: 4, background: c.bg, border: `1px solid ${c.bd}`, color: c.col, fontSize: 10, fontWeight: 500, whiteSpace: "nowrap" }}>
                          {c.label}
                          {p.status === "over" && p.pageAdsTotal && p.pageAdLimit && (
                            <span> +{p.pageAdsTotal - p.pageAdLimit}</span>
                          )}
                        </span>
                        {p.pageAdLimitError && (
                          <div style={{ fontSize: 9, color: "var(--danger)", marginTop: 2, maxWidth: 180, wordBreak: "break-word" }}>{p.pageAdLimitError}</div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: "left", fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {fmtDateTime(p.pageAdLimitCheckedAt)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppLayout>
  )
}

const th: React.CSSProperties = {
  padding: "10px 8px",
  fontSize: 11,
  fontWeight: 600,
  color: "var(--muted)",
  textAlign: "center",
  whiteSpace: "nowrap",
}
const td: React.CSSProperties = {
  padding: "8px",
  textAlign: "center",
  fontSize: 12,
  whiteSpace: "nowrap",
}
