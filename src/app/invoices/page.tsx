"use client"
import { useEffect, useMemo, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"
import DateInputVN from "@/components/DateInputVN"

interface Invoice {
  id: string
  fbInvoiceId: string
  invoiceDate: string
  totalAmount: string
  paymentStatus: string | null
  fundingSource: string | null
  currency: string
  adAccount: { id: string; name: string; actId: string; bankName: string | null; cardOwnerName: string | null }
}

interface AdAccount {
  id: string
  name: string
  actId: string
}

const fmtVND = (n: string | number | null | bigint | undefined) => {
  if (n === null || n === undefined || n === "") return "—"
  const num = typeof n === "string" ? parseFloat(n) : Number(n)
  if (!Number.isFinite(num)) return "—"
  return num.toLocaleString("vi-VN") + " đ"
}

const fmtDate = (s: string | null) => {
  if (!s) return "—"
  const d = new Date(s)
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "long", year: "numeric" })
}

// Extract card brand + last 4 digits from "Visa ···· 8623" or "Mastercard ···· 5076" or "Tín dụng quảng cáo"
function parseFundingSource(s: string | null): { brand: string; last4: string; isCredit: boolean } {
  if (!s) return { brand: "", last4: "", isCredit: false }
  if (/tín\s*dụng\s*quảng\s*cáo/i.test(s)) return { brand: "Tín dụng quảng cáo", last4: "", isCredit: true }
  const m = s.match(/(visa|mastercard|jcb|amex|american\s*express)[^\d]*?(\d{4})/i)
  if (m) return { brand: m[1].toUpperCase().replace(/\s+/g, " "), last4: m[2], isCredit: false }
  return { brand: s, last4: "", isCredit: false }
}

function brandEmoji(brand: string): string {
  const b = brand.toLowerCase()
  if (b.includes("visa")) return "💳"
  if (b.includes("mastercard") || b.includes("master")) return "💳"
  if (b.includes("jcb")) return "💳"
  if (b.includes("amex") || b.includes("express")) return "💳"
  if (b.includes("tín dụng")) return "🎁"
  return "💳"
}

export default function InvoicesPage() {
  const toast = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [accounts, setAccounts] = useState<AdAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)

  // Filter
  const [invActId, setInvActId] = useState("")
  const [invFrom, setInvFrom] = useState("")
  const [invTo, setInvTo] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  async function loadAccounts() {
    try {
      const r = await fetch("/api/accounts", { credentials: "include" })
      if (!r.ok) return
      const d = await r.json()
      if (Array.isArray(d)) {
        const filtered = d.filter((a: any) => a && a.actId)
        // Sort theo tên
        filtered.sort((a: any, b: any) => (a.name || "").localeCompare(b.name || ""))
        setAccounts(filtered)
      }
    } catch {}
  }

  async function fetchInvoicesFiltered() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (invActId) params.set("actId", invActId)
      if (invFrom) params.set("from", invFrom)
      if (invTo) params.set("to", invTo)
      const r = await fetch(`/api/fb/billing/invoices?${params.toString()}`, { credentials: "include" })
      const d = await r.json()
      const safe = (d.invoices || []).filter((i: any) => i && i.adAccount)
      setInvoices(safe)
    } finally { setLoading(false) }
  }

  useEffect(() => {
    loadAccounts()
    fetchInvoicesFiltered()
  }, []) // eslint-disable-line

  async function handleImportInvoiceCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
    setImporting(true)
    let totalUpserted = 0
    const summaries: string[] = []
    const errors: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      try {
        const csv = await file.text()
        const r = await fetch("/api/accounts/import-invoice-csv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ csv }),
        })
        const d = await r.json()
        if (!r.ok) {
          errors.push(`${file.name}: ${d.error || "HTTP " + r.status}`)
          continue
        }
        totalUpserted += d.upserted || 0
        summaries.push(`${d.accountName} (${d.upserted}/${d.total})`)
      } catch (err: any) {
        errors.push(`${file.name}: ${err?.message || "Lỗi đọc file"}`)
      }
    }
    e.target.value = ""
    setImporting(false)
    const msg = `✅ Import ${totalUpserted} invoices · ${summaries.join(", ")}` + (errors.length > 0 ? ` · ❌ ${errors.length} lỗi` : "")
    toast.show(msg, errors.length > 0 ? "warn" as any : "success" as any)
    if (errors.length > 0) console.warn("[import-invoice-csv] errors:", errors)
    await fetchInvoicesFiltered()
  }

  function exportInvoicesCsv() {
    if (filteredInvoices.length === 0) { toast.show("Không có invoice nào", "warn" as any); return }
    const headers = ["Ngày", "TKQC", "ActID", "ID giao dịch", "Phương thức TT", "Số tiền (VND)"]
    const rows = filteredInvoices.map(i => [
      fmtDate(i.invoiceDate),
      i.adAccount.name,
      i.adAccount.actId,
      i.fbInvoiceId,
      i.fundingSource || "",
      i.totalAmount,
    ])
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Filter out FAILED transactions + apply search
  const filteredInvoices = useMemo(() => {
    return invoices.filter(inv => {
      // Bo qua giao dich that bai (defensive - hien tai CSV khong export FAILED nhung
      // de phong sau co source khac).
      if (inv.paymentStatus && ["FAILED", "CANCELLED", "FAIL"].includes(inv.paymentStatus.toUpperCase())) return false
      // Search filter
      if (searchTerm) {
        const q = searchTerm.toLowerCase()
        if (!inv.fbInvoiceId.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [invoices, searchTerm])

  // Selected account info
  const selectedAccount = useMemo(() => {
    if (!invActId) return null
    return accounts.find(a => a.actId === invActId || a.actId.replace(/^act_/, "") === invActId.replace(/^act_/, ""))
  }, [invActId, accounts])

  // Stats
  const totalAmountAll = filteredInvoices.reduce((s, i) => s + parseFloat(i.totalAmount || "0"), 0)

  return (
    <AppLayout>
      <div style={{ display: "flex", flexDirection: "column" as const, gap: 14 }}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" as const, gap: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>💳 Hoạt động thanh toán</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
              Import file CSV từ FB Business Manager → Lập hoá đơn → bấm <b>Export</b>. Mỗi TKQC 1 file, có thể upload nhiều cùng lúc.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const }}>
            <select value={invActId} onChange={e => { setInvActId(e.target.value); }}
              style={{ height: 32, fontSize: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", padding: "0 10px", minWidth: 240, fontWeight: 500 }}>
              <option value="">— Tất cả TKQC —</option>
              {accounts.map(a => <option key={a.id} value={a.actId}>{a.name}</option>)}
            </select>
            <button onClick={exportInvoicesCsv} disabled={filteredInvoices.length === 0}
              style={{ height: 32, padding: "0 12px", borderRadius: 6, fontSize: 12, cursor: filteredInvoices.length === 0 ? "not-allowed" : "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", opacity: filteredInvoices.length === 0 ? 0.5 : 1 }}>
              📥 Export CSV
            </button>
            <label style={{ height: 32, padding: "0 14px", borderRadius: 6, fontSize: 12, cursor: importing ? "wait" : "pointer", border: "none", background: "var(--success)", color: "#fff", fontFamily: "inherit", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5, opacity: importing ? 0.6 : 1 }}>
              {importing ? "⏳ Đang import..." : "📂 Import CSV FB"}
              <input type="file" accept=".csv" multiple disabled={importing} onChange={handleImportInvoiceCsv} style={{ display: "none" }} />
            </label>
          </div>
        </div>

        {/* Account info card */}
        {selectedAccount && (
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 10 }}>
            <div>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 2 }}>Tài khoản quảng cáo</div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedAccount.name} <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 400 }}>({selectedAccount.actId.replace(/^act_/, "")})</span></div>
            </div>
            <div style={{ textAlign: "right" as const }}>
              <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 2 }}>Tổng đã thanh toán</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--success)" }}>{fmtVND(totalAmountAll)}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{filteredInvoices.length} giao dịch</div>
            </div>
          </div>
        )}

        {/* Filter bar */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 240, background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 5, padding: "0 10px", height: 32 }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>🔍</span>
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Tìm kiếm theo ID giao dịch..."
              style={{ flex: 1, height: 30, fontSize: 12, background: "transparent", border: "none", color: "var(--text)", outline: "none", fontFamily: "monospace" }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm("")} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}>✕</button>
            )}
          </div>
          <div style={{ width: 1, height: 24, background: "var(--border)" }} />
          <DateInputVN value={invFrom} onChange={setInvFrom} placeholder="Từ ngày" style={{ height: 32, fontSize: 12, width: 140 }} />
          <DateInputVN value={invTo} onChange={setInvTo} placeholder="Đến ngày" style={{ height: 32, fontSize: 12, width: 140 }} />
          <button onClick={fetchInvoicesFiltered} disabled={loading}
            style={{ height: 32, padding: "0 14px", borderRadius: 5, fontSize: 12, cursor: loading ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>
            {loading ? "⏳" : "Lọc"}
          </button>
        </div>

        {/* Stats khi khong chon TKQC */}
        {!selectedAccount && filteredInvoices.length > 0 && (
          <div style={{ background: "rgba(46,204,143,.06)", border: "1px solid rgba(46,204,143,.25)", borderRadius: 8, padding: "10px 14px", fontSize: 12, display: "flex", gap: 20, flexWrap: "wrap" as const }}>
            <div>📊 <strong>{filteredInvoices.length}</strong> giao dịch</div>
            <div>💰 Tổng: <strong style={{ color: "var(--success)" }}>{fmtVND(totalAmountAll)}</strong></div>
            <div style={{ color: "var(--muted)" }}>VAT 10% (tham khảo): {fmtVND(Math.round(totalAmountAll * 0.1))}</div>
          </div>
        )}

        {/* Table */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" as const }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, minWidth: 900 }}>
              <thead style={{ background: "var(--bg3)" }}>
                <tr>
                  <th style={th}>ID giao dịch</th>
                  <th style={th}>TKQC</th>
                  <th style={th}>Ngày</th>
                  <th style={{ ...th, textAlign: "right" as const }}>Số tiền</th>
                  <th style={th}>Phương thức thanh toán</th>
                  <th style={th}>Trạng thái thanh toán</th>
                  <th style={th}>ID hóa đơn VAT</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: 50, textAlign: "center" as const, color: "var(--muted)" }}>
                    {invoices.length > 0 && searchTerm
                      ? `Không có giao dịch nào khớp "${searchTerm}"`
                      : "Chưa có invoice. Bấm \"📂 Import CSV FB\" để upload file Invoice Summary từ FB Business Manager."}
                  </td></tr>
                ) : filteredInvoices.map(inv => {
                  const fs = parseFundingSource(inv.fundingSource)
                  return (
                    <tr key={inv.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ ...td, fontFamily: "monospace", fontSize: 11 }}>
                        <div style={{ color: "var(--text)", fontWeight: 500, wordBreak: "break-all" as const }}>{inv.fbInvoiceId}</div>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 500, fontSize: 12, whiteSpace: "nowrap" as const }}>{inv.adAccount.name}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{inv.adAccount.actId.replace(/^act_/, "")}</div>
                      </td>
                      <td style={td}>
                        <span style={{ whiteSpace: "nowrap" as const }}>{fmtDate(inv.invoiceDate)}</span>
                      </td>
                      <td style={{ ...td, textAlign: "right" as const, fontWeight: 600, fontFamily: "monospace" }}>
                        {fmtVND(inv.totalAmount)}
                      </td>
                      <td style={td}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 16 }}>{brandEmoji(fs.brand)}</span>
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 12 }}>
                              {fs.brand || inv.fundingSource || "—"}
                              {fs.last4 && <span style={{ color: "var(--muted)", marginLeft: 6, fontFamily: "monospace" }}>···· {fs.last4}</span>}
                            </div>
                            {inv.adAccount.bankName && (
                              <div style={{ fontSize: 9, color: "var(--muted)", marginTop: 1 }}>
                                {inv.adAccount.bankName}
                                {inv.adAccount.cardOwnerName && ` · ${inv.adAccount.cardOwnerName}`}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={td}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 12, background: "rgba(46,204,143,.12)", color: "var(--success)", fontSize: 10, fontWeight: 600 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
                          Đã thanh toán
                        </span>
                      </td>
                      <td style={{ ...td, color: "var(--muted)", fontFamily: "monospace", fontSize: 10 }}>—</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

const th: React.CSSProperties = {
  textAlign: "left" as const,
  padding: "10px 14px",
  fontSize: 10,
  fontWeight: 600,
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: ".4px",
  borderBottom: "1px solid var(--border)",
  whiteSpace: "nowrap" as const,
}
const td: React.CSSProperties = {
  padding: "12px 14px",
  fontSize: 12,
  verticalAlign: "top" as const,
}
