"use client"
import { useEffect, useMemo, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateInputVN from "@/components/DateInputVN"
import DateRangePickerVN from "@/components/DateRangePickerVN"
import { useToast } from "@/components/Toast"
import { DATA_LOCK_DATE } from "@/lib/data-lock"
import { useConfirm } from "@/components/Confirm"

const fmt = (n: number) => "₫" + Math.round(n || 0).toLocaleString("vi-VN")

const inp: React.CSSProperties = {
  height: 30,
  padding: "0 9px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg2)",
  color: "var(--text)",
  fontSize: 12,
  fontFamily: "inherit",
}

const btn = (color: string): React.CSSProperties => ({
  height: 30,
  padding: "0 12px",
  borderRadius: 6,
  border: "none",
  background: color,
  color: "#fff",
  fontSize: 12,
  fontWeight: 500,
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
})

const card: React.CSSProperties = {
  background: "var(--bg2)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: 14,
}

type Cat = { id: string; name: string; color: string | null; expenseCount?: number }
type Item = {
  id: string
  date: string
  content: string
  supplier: string | null
  amount: number
  note: string | null
  categoryId: string | null
  category: { id: string; name: string; color: string | null } | null
}
type Stats = {
  totalAmount: number
  count: number
  byCategory: { categoryId: string | null; name: string; color: string | null; amount: number }[]
  byMonth: { month: string; total: number }[]
}

export default function ChiPhiVanPhongPage() {
  const toast = useToast()
  const { ask } = useConfirm()
  // Mặc định: tháng hiện tại
  const [from, setFrom] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
  })
  const [to, setTo] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10)
  })
  const [q, setQ] = useState("")
  const [filterCatId, setFilterCatId] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const [items, setItems] = useState<Item[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  const [cats, setCats] = useState<Cat[]>([])

  // Modals
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [showCatMgr, setShowCatMgr] = useState(false)

  async function loadCats() {
    try {
      const r = await fetch("/api/office-expense/categories", { credentials: "include" })
      const d = await r.json()
      if (r.ok) setCats(d.items || [])
    } catch {}
  }

  async function load() {
    setLoading(true)
    try {
      const url = new URL("/api/office-expense", window.location.origin)
      url.searchParams.set("from", from)
      url.searchParams.set("to", to)
      if (q) url.searchParams.set("q", q)
      if (filterCatId) url.searchParams.set("categoryId", filterCatId)
      url.searchParams.set("page", String(page))
      url.searchParams.set("pageSize", String(pageSize))
      const r = await fetch(url, { credentials: "include" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setItems(d.items || [])
      setStats(d.stats || null)
      setTotalCount(d.totalCount || 0)
      setTotalPages(d.totalPages || 1)
    } catch (e: any) {
      toast.show(e?.message || "Lỗi tải data", "error")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadCats()
  }, [])
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, page, pageSize, filterCatId])

  // Search debounced
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1)
      load()
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  function exportExcel() {
    const url = new URL("/api/office-expense/export", window.location.origin)
    url.searchParams.set("from", from)
    url.searchParams.set("to", to)
    if (q) url.searchParams.set("q", q)
    if (filterCatId) url.searchParams.set("categoryId", filterCatId)
    window.location.href = url.toString()
  }

  async function deleteItem(id: string) {
    if (!(await ask("Xoá khoản chi này?", { title: "Xác nhận xoá", danger: true }))) return
    try {
      const r = await fetch(`/api/office-expense/${id}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${r.status}`)
      }
      toast.show("Đã xoá", "success")
      load()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    }
  }

  // Donut chart vẽ bằng SVG
  const donut = useMemo(() => {
    if (!stats || stats.byCategory.length === 0 || stats.totalAmount === 0) return null
    const total = stats.totalAmount
    const radius = 60
    const stroke = 22
    const circumference = 2 * Math.PI * radius
    let acc = 0
    const segments = stats.byCategory.map((c, i) => {
      const pct = c.amount / total
      const dash = pct * circumference
      const offset = circumference - acc
      acc += dash
      return {
        ...c,
        pct,
        dash,
        offset,
        color: c.color || "#888",
      }
    })
    return { segments, radius, stroke, circumference, total }
  }, [stats])

  return (
    <AppLayout>
      {/* Header */}
      <div className="row-actions" style={{ justifyContent: "space-between" }}>
        <h1 className="page-title" style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Chi phí văn phòng</h1>
        <div className="row-actions">
          <DateRangePickerVN
            from={from}
            to={to}
            max={(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) })()}
            min={DATA_LOCK_DATE}
            onChange={(f, t) => { setFrom(f); setTo(t) }}
            align="right"
            width={290}
          />
          <button onClick={() => setShowCatMgr(true)} style={{ ...btn("transparent"), color: "var(--text)", border: "1px solid var(--border)" }}>
            🏷 Danh mục
          </button>
          <button
            onClick={() => {
              setEditing(null)
              setShowForm(true)
            }}
            style={btn("var(--accent)")}
          >
            + Thêm chi phí
          </button>
        </div>
      </div>

      {/* Top stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10 }}>
        <StatCard label="Tổng chi phí trong kỳ" value={stats ? fmt(stats.totalAmount) : "—"} sub={stats ? `${stats.count} khoản chi` : ""} color="var(--accent)" />
        <StatCard label="Số khoản chi" value={stats ? `${stats.count}` : "—"} sub="Trong kỳ" color="var(--muted)" />
      </div>

      {/* Charts */}
      <div className="grid-charts" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {/* Donut */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Chi phí theo danh mục</div>
          {donut ? (
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <svg width={170} height={170} viewBox="0 0 170 170" style={{ flexShrink: 0 }}>
                <g transform="translate(85,85) rotate(-90)">
                  {donut.segments.map((s, i) => (
                    <circle
                      key={i}
                      r={donut.radius}
                      cx={0}
                      cy={0}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={donut.stroke}
                      strokeDasharray={`${s.dash} ${donut.circumference - s.dash}`}
                      strokeDashoffset={s.offset}
                    />
                  ))}
                </g>
                <text x={85} y={82} textAnchor="middle" style={{ fontSize: 16, fontWeight: 700, fill: "var(--text)" }}>
                  {fmt(donut.total)}
                </text>
                <text x={85} y={97} textAnchor="middle" style={{ fontSize: 10, fill: "var(--muted)" }}>
                  Tổng chi phí
                </text>
              </svg>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                {donut.segments.map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                    <span style={{ flex: 1, color: "var(--text)" }}>{s.name}</span>
                    <span style={{ color: "var(--muted)" }}>
                      {fmt(s.amount)} ({(s.pct * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Chưa có dữ liệu</div>
          )}
        </div>

        {/* Bar by month */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Chi phí theo tháng (6 tháng gần nhất)</div>
          {stats && stats.byMonth.length > 0 ? (
            <BarChart data={stats.byMonth} />
          ) : (
            <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Chưa có dữ liệu</div>
          )}
        </div>
      </div>

      {/* Filters + Table */}
      <div style={{ ...card, padding: 0 }}>
        <div className="filter-bar" style={{ padding: "12px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
          <input
            placeholder="🔍 Tìm khoản chi..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ ...inp, flex: 1, minWidth: 200 }}
          />
          <select value={filterCatId} onChange={(e) => { setFilterCatId(e.target.value); setPage(1) }} style={{ ...inp, minWidth: 180 }}>
            <option value="">Danh mục: Tất cả</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button onClick={exportExcel} style={{ ...btn("transparent"), color: "var(--text)", border: "1px solid var(--border)" }}>
            📤 Xuất Excel
          </button>
        </div>

        <div className="tbl-wrap" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg)", color: "var(--muted)", textAlign: "left" }}>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>STT</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>Ngày chi</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>Nội dung</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>Danh mục</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px" }}>Nhà cung cấp</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", textAlign: "right" }}>Số tiền</th>
                <th style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: ".4px", textAlign: "center" }}>Sửa/Xoá</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>Đang tải...</td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    Chưa có khoản chi nào trong khoảng này. Bấm "+ Thêm chi phí" để bắt đầu.
                  </td>
                </tr>
              ) : (
                items.map((it, idx) => (
                  <tr key={it.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{(page - 1) * pageSize + idx + 1}</td>
                    <td style={{ padding: "10px 14px" }}>{formatDate(it.date)}</td>
                    <td style={{ padding: "10px 14px" }}>{it.content}</td>
                    <td style={{ padding: "10px 14px" }}>
                      {it.category ? (
                        <span
                          style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            background: hexToBg(it.category.color || "#888"),
                            color: it.category.color || "var(--text)",
                            border: `1px solid ${it.category.color || "var(--border)"}`,
                          }}
                        >
                          {it.category.name}
                        </span>
                      ) : (
                        <span style={{ color: "var(--muted)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "10px 14px", color: "var(--muted)" }}>{it.supplier || "—"}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 600 }}>{fmt(it.amount)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}>
                      <button
                        onClick={() => {
                          setEditing(it)
                          setShowForm(true)
                        }}
                        title="Sửa"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteItem(it.id)}
                        title="Xoá"
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
            <div>
              Hiển thị {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, totalCount)} / {totalCount} khoản chi
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1} style={{ ...inp, padding: "0 8px", cursor: page <= 1 ? "not-allowed" : "pointer", opacity: page <= 1 ? 0.4 : 1 }}>
                ‹
              </button>
              <span style={{ padding: "0 8px" }}>
                {page} / {totalPages}
              </span>
              <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page >= totalPages} style={{ ...inp, padding: "0 8px", cursor: page >= totalPages ? "not-allowed" : "pointer", opacity: page >= totalPages ? 0.4 : 1 }}>
                ›
              </button>
              <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} style={{ ...inp, padding: "0 8px" }}>
                <option value={10}>10 / trang</option>
                <option value={20}>20 / trang</option>
                <option value={50}>50 / trang</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Form add/edit */}
      {showForm && (
        <ExpenseForm
          editing={editing}
          cats={cats}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false)
            load()
            loadCats()
          }}
        />
      )}

      {/* Modal: Category manager */}
      {showCatMgr && (
        <CategoryManager
          cats={cats}
          onClose={() => setShowCatMgr(false)}
          onChanged={() => {
            loadCats()
            load()
          }}
        />
      )}
    </AppLayout>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={card}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function BarChart({ data }: { data: { month: string; total: number }[] }) {
  // Pad ra 6 tháng
  const today = new Date()
  const months: string[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`)
  }
  const map = new Map(data.map((d) => [d.month, d.total]))
  const series = months.map((m) => ({ month: m, total: map.get(m) || 0 }))
  const max = Math.max(...series.map((s) => s.total), 1)
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 130, padding: "10px 0" }}>
      {series.map((s, i) => {
        const h = (s.total / max) * 100
        const isLast = i === series.length - 1
        return (
          <div key={s.month} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <div style={{ fontSize: 9, color: "var(--muted)", whiteSpace: "nowrap" }}>{s.total > 0 ? compactMoney(s.total) : ""}</div>
            <div
              style={{
                width: "100%",
                height: `${h}%`,
                minHeight: 2,
                background: isLast ? "var(--accent)" : "rgba(79,126,248,.35)",
                borderRadius: "3px 3px 0 0",
                transition: "height .3s",
              }}
              title={`${s.month}: ${fmt(s.total)}`}
            />
            <div style={{ fontSize: 9, color: "var(--muted)" }}>
              {s.month.slice(5)}/{s.month.slice(2, 4)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function compactMoney(n: number) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B"
  if (n >= 1e6) return Math.round(n / 1e6) + "M"
  if (n >= 1e3) return Math.round(n / 1e3) + "K"
  return String(Math.round(n))
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`
}

function hexToBg(hex: string) {
  const m = hex.replace("#", "").match(/^[0-9a-fA-F]{6}$/)
  if (!m) return "transparent"
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},.12)`
}

// ============= Form modal =============
function ExpenseForm({ editing, cats, onClose, onSaved }: { editing: Item | null; cats: Cat[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState<string>(editing ? editing.date.slice(0, 10) : today)
  const [content, setContent] = useState(editing?.content || "")
  const [categoryId, setCategoryId] = useState(editing?.categoryId || "")
  const [supplier, setSupplier] = useState(editing?.supplier || "")
  // Lưu raw number, hiển thị format có dấu chấm.
  const [amount, setAmount] = useState<number>(editing ? editing.amount : 0)
  const [note, setNote] = useState(editing?.note || "")
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!content.trim()) return toast.show("Thiếu nội dung", "error")
    const n = amount
    if (!Number.isFinite(n) || n < 0) return toast.show("Số tiền không hợp lệ", "error")
    setSaving(true)
    try {
      const url = editing ? `/api/office-expense/${editing.id}` : "/api/office-expense"
      const method = editing ? "PUT" : "POST"
      const r = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          content: content.trim(),
          categoryId: categoryId || null,
          supplier: supplier.trim() || null,
          amount: n,
          note: note.trim() || null,
        }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show(editing ? "Đã cập nhật" : "Đã thêm khoản chi", "success")
      onSaved()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={editing ? "Sửa khoản chi" : "Thêm khoản chi"} width={500}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Ngày chi *">
          <DateInputVN value={date} onChange={setDate} style={{ ...inp, width: "100%" }} />
        </Field>
        <Field label="Nội dung *">
          <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="VD: Tiền thuê văn phòng tháng 5/2026" style={{ ...inp, width: "100%" }} />
        </Field>
        <Field label="Danh mục">
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} style={{ ...inp, width: "100%" }}>
            <option value="">— Không phân loại —</option>
            {cats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nhà cung cấp">
          <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="VD: Công ty TNHH XYZ" style={{ ...inp, width: "100%" }} />
        </Field>
        <Field label="Số tiền (VND) *">
          <input
            value={amount === 0 && !editing ? "" : amount.toLocaleString("vi-VN")}
            onChange={(e) => {
              const v = e.target.value.replace(/[.,\s]/g, "")
              const n = v === "" ? 0 : Number(v)
              if (Number.isFinite(n)) setAmount(n)
            }}
            placeholder="VD: 18.700.000"
            inputMode="numeric"
            style={{ ...inp, width: "100%" }}
          />
        </Field>
        <Field label="Ghi chú">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} style={{ ...inp, width: "100%", height: "auto", padding: 9, resize: "vertical" }} />
        </Field>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
          <button onClick={onClose} style={{ ...btn("transparent"), color: "var(--text)", border: "1px solid var(--border)" }}>Hủy</button>
          <button onClick={save} disabled={saving} style={{ ...btn("var(--accent)"), opacity: saving ? 0.6 : 1 }}>
            {saving ? "Đang lưu..." : editing ? "Cập nhật" : "Lưu"}
          </button>
        </div>
      </div>
    </ModalShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{label}</div>
      {children}
    </div>
  )
}

// ============= Category manager modal =============
function CategoryManager({ cats, onClose, onChanged }: { cats: Cat[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast()
  const { ask } = useConfirm()
  const [newName, setNewName] = useState("")
  const [newColor, setNewColor] = useState("#4F7EF8")
  const [busy, setBusy] = useState(false)
  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const [editingColor, setEditingColor] = useState("")

  async function add() {
    const name = newName.trim()
    if (!name) return toast.show("Nhập tên danh mục", "error")
    setBusy(true)
    try {
      const r = await fetch("/api/office-expense/categories", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: newColor }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show("Đã thêm danh mục", "success")
      setNewName("")
      onChanged()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    } finally {
      setBusy(false)
    }
  }

  function startEdit(c: Cat) {
    setEditingId(c.id)
    setEditingName(c.name)
    setEditingColor(c.color || "#4F7EF8")
  }
  function cancelEdit() {
    setEditingId(null)
    setEditingName("")
    setEditingColor("")
  }
  async function saveEdit(c: Cat) {
    const name = editingName.trim()
    if (!name) return toast.show("Tên không được rỗng", "error")
    if (name === c.name && editingColor === (c.color || "")) {
      cancelEdit()
      return
    }
    try {
      const r = await fetch(`/api/office-expense/categories/${c.id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color: editingColor }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show("Đã cập nhật", "success")
      cancelEdit()
      onChanged()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    }
  }

  async function remove(c: Cat) {
    const note = c.expenseCount && c.expenseCount > 0 ? `\n\n⚠ ${c.expenseCount} khoản chi đang dùng danh mục này — sẽ chuyển sang "Không phân loại" (không mất tiền).` : ""
    if (!(await ask(`Xoá danh mục "${c.name}"?${note}`, { title: "Xoá danh mục", danger: true }))) return
    try {
      const r = await fetch(`/api/office-expense/categories/${c.id}`, { method: "DELETE", credentials: "include" })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d.error || `HTTP ${r.status}`)
      }
      toast.show("Đã xoá", "success")
      onChanged()
    } catch (e: any) {
      toast.show(e?.message || "Lỗi", "error")
    }
  }

  return (
    <ModalShell onClose={onClose} title="Quản lý danh mục" width={460}>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder="Tên danh mục mới..." style={{ ...inp, flex: 1 }} />
        <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} style={{ ...inp, width: 38, padding: 2 }} />
        <button onClick={add} disabled={busy} style={btn("var(--accent)")}>+ Thêm</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {cats.length === 0 ? (
          <div style={{ padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Chưa có danh mục nào</div>
        ) : (
          cats.map((c) => {
            const isEditing = editingId === c.id
            if (isEditing) {
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", border: "1px solid var(--accent)", borderRadius: 6, background: "rgba(79,126,248,.06)" }}>
                  <input
                    type="color"
                    value={editingColor}
                    onChange={(e) => setEditingColor(e.target.value)}
                    style={{ width: 28, height: 28, padding: 1, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", cursor: "pointer" }}
                  />
                  <input
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(c)
                      if (e.key === "Escape") cancelEdit()
                    }}
                    autoFocus
                    style={{ flex: 1, height: 28, padding: "0 8px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)", fontSize: 12, fontFamily: "inherit" }}
                  />
                  <button onClick={() => saveEdit(c)} title="Lưu (Enter)" style={{ height: 28, padding: "0 10px", borderRadius: 4, border: "none", background: "var(--accent)", color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit", fontWeight: 500 }}>Lưu</button>
                  <button onClick={cancelEdit} title="Hủy (Esc)" style={{ height: 28, padding: "0 10px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Hủy</button>
                </div>
              )
            }
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)" }}>
                <span style={{ width: 12, height: 12, borderRadius: 3, background: c.color || "#888" }} />
                <span style={{ flex: 1, fontSize: 12 }}>{c.name}</span>
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{c.expenseCount || 0} khoản</span>
                <button onClick={() => startEdit(c)} title="Đổi tên" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", padding: 4 }}>✏️</button>
                <button onClick={() => remove(c)} title="Xoá" style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--danger)", padding: 4 }}>🗑</button>
              </div>
            )
          })
        )}
      </div>
    </ModalShell>
  )
}

function ModalShell({ children, onClose, title, width = 480 }: { children: React.ReactNode; onClose: () => void; title: string; width?: number }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, width, maxWidth: "92vw", maxHeight: "90vh", overflowY: "auto", padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 18, padding: 4, lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}
