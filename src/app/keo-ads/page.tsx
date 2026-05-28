"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useConfirm } from "@/components/Confirm"

const COLORS = ['#4f7ef8','#2ecc8f','#f5a623','#e84d4d','#9b59b6','#1abc9c','#e67e22','#3498db']
const ac = (n: string) => { let h = 0; for (const c of n) h = (h + c.charCodeAt(0)) % COLORS.length; return COLORS[h] }
const ini = (n: string) => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

export default function KeoAdsPage() {
  const { ask } = useConfirm()
  const [accounts, setAccounts] = useState<any[]>([])
  const [pages, setPages] = useState<any[]>([])
  const [selAcc, setSelAcc] = useState<Set<string>>(new Set())
  const [selPg, setSelPg] = useState<Set<string>>(new Set())
  const [lastAccIdx, setLastAccIdx] = useState<number | null>(null)
  const [lastPgIdx, setLastPgIdx] = useState<number | null>(null)
  const [accSearch, setAccSearch] = useState("")
  const [pgSearch, setPgSearch] = useState("")
  useEffect(() => { setLastAccIdx(null) }, [accSearch])
  useEffect(() => { setLastPgIdx(null) }, [pgSearch])
  const [tokenInfo, setTokenInfo] = useState<any>(null)
  const [showTokenModal, setShowTokenModal] = useState(false)
  const [tokenForm, setTokenForm] = useState({ appId: "", appSecret: "", shortToken: "" })
  const [tokenLoading, setTokenLoading] = useState(false)
  const [tokenMsg, setTokenMsg] = useState<{type:"success"|"error", text:string}|null>(null)
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncMsg, setSyncMsg] = useState<{type:"success"|"error", text:string}|null>(null)
  const [showAccModal, setShowAccModal] = useState(false)
  const [accForm, setAccForm] = useState({ name: "", actId: "", status: "on", budget: "" })
  const [showPgModal, setShowPgModal] = useState(false)
  const [pgForm, setPgForm] = useState({ name: "", pageId: "", category: "" })

  useEffect(() => {
    fetchAll()
    // Cleanup keys localStorage cũ (không còn dùng từ khi sync qua DB).
    // KHÔNG migrate từ localStorage nữa — risk overwrite DB nếu localStorage stale.
    try {
      localStorage.removeItem("selected_accounts")
      localStorage.removeItem("selected_pages")
      localStorage.removeItem("selection_migrated_v2")
    } catch {}
  }, [])

  async function fetchAll() {
    const [a, p, t] = await Promise.all([
      fetch("/api/accounts").then(r => r.ok ? r.json() : []),
      fetch("/api/pages").then(r => r.ok ? r.json() : []),
      fetch("/api/fb/token").then(r => r.ok ? r.json() : null)
    ])
    console.log("[fetchAll] /api/accounts:", Array.isArray(a) ? `${a.length} records` : a, a?.slice?.(0, 3))
    console.log("[fetchAll] /api/pages:", Array.isArray(p) ? `${p.length} records` : p)
    setAccounts(a); setPages(p); setTokenInfo(t)
    // Restore selection từ DB (field isSelected) — sync cross-browser
    if (Array.isArray(a)) setSelAcc(new Set(a.filter((x: any) => x.isSelected !== false).map((x: any) => x.id)))
    if (Array.isArray(p)) setSelPg(new Set(p.filter((x: any) => x.isSelected !== false).map((x: any) => x.id)))
  }

  async function syncAssets(only: "all" | "accounts" | "pages" = "all") {
    setSyncLoading(true); setSyncMsg(null)
    try {
      const res = await fetch(`/api/fb/sync-assets?only=${only}`, { method: "POST" })
      const data = await res.json()
      console.log("[sync-assets] full response:", data)
      if (res.ok) {
        const hasWarning = !!(data.accountsError || data.pagesError)
        setSyncMsg({ type: hasWarning ? "error" : "success", text: data.message })
        fetchAll()
      } else setSyncMsg({ type: "error", text: data.error })
    } catch { setSyncMsg({ type: "error", text: "Loi ket noi" }) }
    setSyncLoading(false)
  }

  async function saveSelectedAccs() {
    try {
      const ids = Array.from(selAcc)
      const r = await fetch("/api/accounts/select", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) })
      if (!r.ok) throw new Error("HTTP " + r.status)
      setSyncMsg({ type: "success", text: `Da luu ${selAcc.size} tai khoan QC! (sync moi browser)` })
      setTimeout(() => setSyncMsg(null), 2000)
    } catch (e: any) {
      setSyncMsg({ type: "error", text: "Loi luu: " + (e?.message || "unknown") })
    }
  }

  async function saveSelectedPages() {
    try {
      const ids = Array.from(selPg)
      const r = await fetch("/api/pages/select", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) })
      if (!r.ok) throw new Error("HTTP " + r.status)
      setSyncMsg({ type: "success", text: `Da luu ${selPg.size} fanpage! (sync moi browser)` })
      setTimeout(() => setSyncMsg(null), 2000)
    } catch (e: any) {
      setSyncMsg({ type: "error", text: "Loi luu: " + (e?.message || "unknown") })
    }
  }

  async function saveToken() {
    setTokenLoading(true); setTokenMsg(null)
    try {
      const res = await fetch("/api/fb/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tokenForm) })
      const data = await res.json()
      if (res.ok) {
        setTokenMsg({ type: "success", text: data.message })
        setTokenInfo({ hasToken: true, ...data })
        setTimeout(() => { setShowTokenModal(false); setTokenMsg(null) }, 1500)
      } else setTokenMsg({ type: "error", text: data.error })
    } catch { setTokenMsg({ type: "error", text: "Loi ket noi" }) }
    setTokenLoading(false)
  }

  async function deleteToken() {
    if (!await ask("Xoá token này?", { title: "Xác nhận xoá token FB", danger: true })) return
    await fetch("/api/fb/token", { method: "DELETE" })
    setTokenInfo(null); fetchAll()
  }

  async function addAccount() {
    const res = await fetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: accForm.name, actId: accForm.actId, status: accForm.status, budget: Number(accForm.budget) || 0 }) })
    if (res.ok) { setShowAccModal(false); setAccForm({ name: "", actId: "", status: "on", budget: "" }); fetchAll() }
  }

  async function deleteAcc(id: string) { await fetch(`/api/accounts/${id}`, { method: "DELETE" }); fetchAll() }

  async function addPage() {
    const res = await fetch("/api/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pgForm.name, pageId: pgForm.pageId, category: pgForm.category }) })
    if (res.ok) { setShowPgModal(false); setPgForm({ name: "", pageId: "", category: "" }); fetchAll() }
  }

  async function deletePage(id: string) { await fetch(`/api/pages/${id}`, { method: "DELETE" }); fetchAll() }

  // Dedupe trùng theo FB ID (actId / pageId): khi user có dataAccess grant
  // xem TKQC/Page của user khác, có thể trùng nhau (cùng FB asset, 2 record DB của 2 user).
  // Giữ record đầu tiên gặp.
  function dedupeBy<T extends { [k: string]: any }>(arr: T[], key: string): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const item of arr) {
      const k = String(item[key] || "")
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push(item)
    }
    return out
  }
  const accountsUniq = dedupeBy(accounts, "actId")
  const pagesUniq = dedupeBy(pages, "pageId")
  const filtAcc = accountsUniq.filter(a => !accSearch || a.name.toLowerCase().includes(accSearch.toLowerCase()) || a.actId.includes(accSearch))
  const filtPg = pagesUniq.filter(p => !pgSearch || p.name.toLowerCase().includes(pgSearch.toLowerCase()) || p.pageId?.includes(pgSearch))

  function handleAccClick(idx: number, a: any, e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('input, button, select, textarea, a, [data-no-row-select]')) return
    if (e.shiftKey && lastAccIdx !== null) {
      e.preventDefault()
      try { window.getSelection()?.removeAllRanges() } catch {}
      const start = Math.min(lastAccIdx, idx)
      const end = Math.max(lastAccIdx, idx)
      const ids: string[] = []
      for (let k = start; k <= end; k++) { const r = filtAcc[k]; if (r) ids.push(r.id) }
      setSelAcc(new Set(ids))
    } else if (e.ctrlKey || e.metaKey) {
      setSelAcc(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n })
      setLastAccIdx(idx)
    } else {
      setSelAcc(new Set([a.id]))
      setLastAccIdx(idx)
    }
  }
  function handlePgClick(idx: number, p: any, e: React.MouseEvent) {
    const target = e.target as HTMLElement
    if (target.closest('input, button, select, textarea, a, [data-no-row-select]')) return
    if (e.shiftKey && lastPgIdx !== null) {
      e.preventDefault()
      try { window.getSelection()?.removeAllRanges() } catch {}
      const start = Math.min(lastPgIdx, idx)
      const end = Math.max(lastPgIdx, idx)
      const ids: string[] = []
      for (let k = start; k <= end; k++) { const r = filtPg[k]; if (r) ids.push(r.id) }
      setSelPg(new Set(ids))
    } else if (e.ctrlKey || e.metaKey) {
      setSelPg(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n })
      setLastPgIdx(idx)
    } else {
      setSelPg(new Set([p.id]))
      setLastPgIdx(idx)
    }
  }

  const inp = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", outline: "none", height: 34, width: "100%", boxSizing: "border-box" } as React.CSSProperties
  const lbl = { fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }
  const stColor: Record<string, string> = { ON: "#2ecc8f", on: "#2ecc8f", OFF: "#e84d4d", off: "#e84d4d", ERROR: "#f5a623", err: "#f5a623" }
  const stBg: Record<string, string> = { ON: "rgba(46,204,143,.1)", on: "rgba(46,204,143,.1)", OFF: "rgba(255,255,255,.05)", off: "rgba(255,255,255,.05)", ERROR: "rgba(232,77,45,.1)", err: "rgba(232,77,45,.1)" }
  const stLabel: Record<string, string> = { ON: "Hoat dong", on: "Hoat dong", OFF: "Tat", off: "Tat", ERROR: "Loi", err: "Loi" }

  return (
    <AppLayout>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Facebook Assets</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Tai khoan quang cao va Fanpage</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const, alignItems: "flex-end", gap: 8 }}>
          {syncMsg && (
            <div style={{ fontSize: 11, color: syncMsg.type==="success"?"var(--success)":"var(--danger)", background: syncMsg.type==="success"?"rgba(46,204,143,.08)":"rgba(232,77,45,.08)", border: `1px solid ${syncMsg.type==="success"?"rgba(46,204,143,.2)":"rgba(232,77,45,.2)"}`, borderRadius: 6, padding: "8px 12px", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, maxWidth: 600, fontFamily: syncMsg.text.includes("DEBUG") ? "monospace" : "inherit" }}>
              {syncMsg.text}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {tokenInfo?.hasToken && (
              <>
                <button onClick={() => syncAssets("all")} disabled={syncLoading}
                  title="Đồng bộ cả TKQC và Fanpage"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: syncLoading?"wait":"pointer", border: "none", fontFamily: "inherit", fontWeight: 600, background: "var(--success)", color: "#fff", height: 34, whiteSpace: "nowrap" as const, opacity: syncLoading?0.7:1 }}>
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ animation: syncLoading?"spin 1s linear infinite":"none" }}><path d="M14 8A6 6 0 112 8"/><path d="M11 5l3 3-3 3"/></svg>
                  {syncLoading ? "Đang đồng bộ..." : "Đồng bộ tất cả"}
                </button>
                <button onClick={() => syncAssets("pages")} disabled={syncLoading}
                  title="Chỉ đồng bộ Fanpage (dùng khi token thiếu quyền ads_read)"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px", borderRadius: 8, fontSize: 12, cursor: syncLoading?"wait":"pointer", border: "1px solid rgba(46,204,143,.4)", fontFamily: "inherit", fontWeight: 500, background: "transparent", color: "var(--success)", height: 34, whiteSpace: "nowrap" as const, opacity: syncLoading?0.7:1 }}>
                  Chỉ Fanpage
                </button>
              </>
            )}
            {tokenInfo?.hasToken ? (
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(46,204,143,.08)", border: "1px solid rgba(46,204,143,.2)", borderRadius: 8, padding: "6px 12px" }}>
                <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#2ecc8f" }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#2ecc8f" }}>Token hoat dong</div>
                  <div style={{ fontSize: 9.5, color: "var(--muted)" }}>App: {tokenInfo.appId}</div>
                </div>
                <button onClick={() => setShowTokenModal(true)} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(46,204,143,.3)", background: "transparent", color: "#2ecc8f", cursor: "pointer", fontFamily: "inherit" }}>Cap nhat</button>
                <button onClick={deleteToken} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, border: "1px solid rgba(232,77,45,.3)", background: "transparent", color: "var(--danger)", cursor: "pointer", fontFamily: "inherit" }}>Xoa</button>
              </div>
            ) : (
              <button onClick={() => setShowTokenModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer", border: "1px solid rgba(79,126,248,.3)", fontFamily: "inherit", fontWeight: 600, background: "rgba(79,126,248,.1)", color: "var(--pill-text)", height: 34 }}>
                Ket noi Facebook Token
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* Accounts */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: "#1877f2", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="#fff"><path d="M8 1a4 4 0 100 8A4 4 0 008 1zM2 14a6 6 0 1112 0H2z"/></svg>
              </div>
              <div><div style={{ fontSize: 12, fontWeight: 600 }}>Tai khoan QC</div><div style={{ fontSize: 10, color: "var(--muted)" }}>Ad Accounts</div></div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ background: "var(--pill-bg)", color: "var(--pill-text)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>{accounts.length}</span>
              <button onClick={() => setShowAccModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", height: 24 }}>+ Them</button>
            </div>
          </div>
          <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7 }}>
            <input type="checkbox" checked={filtAcc.length>0 && filtAcc.every(a=>selAcc.has(a.id))} onChange={e => setSelAcc(s => { const n = new Set(s); if (e.target.checked) filtAcc.forEach(a => n.add(a.id)); else filtAcc.forEach(a => n.delete(a.id)); return n })} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Tat ca</span>
            <div style={{ position: "relative" as const, flex: 1 }}>
              <svg style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }} width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4"/><path d="M11 11l3 3"/></svg>
              <input value={accSearch} onChange={e => setAccSearch(e.target.value)} placeholder="Tim tai khoan..." style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, fontFamily: "inherit", padding: "5px 8px 5px 24px", outline: "none", width: "100%", height: 28 }} />
            </div>
          </div>
          {selAcc.size > 0 && (
            <div style={{ padding: "5px 10px", background: "rgba(79,126,248,.07)", borderBottom: "1px solid rgba(79,126,248,.13)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--pill-text)", fontWeight: 500 }}>{selAcc.size} da chon</span>
              <div style={{ display: "flex", gap: 5 }}>
                <button onClick={saveSelectedAccs} style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(46,204,143,.2)", background: "rgba(46,204,143,.1)", color: "var(--success)", fontFamily: "inherit", fontWeight: 600 }}>Luu lai</button>
                <button onClick={() => { selAcc.forEach(id => deleteAcc(id)); setSelAcc(new Set()) }} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.2)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit" }}>Xoa da chon</button>
              </div>
            </div>
          )}
          <div style={{ maxHeight: 320, overflowY: "auto" as const }}>
            {filtAcc.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 11 }}>
                {tokenInfo?.hasToken ? (
                  <div>
                    <div style={{ marginBottom: 8 }}>Chua co tai khoan nao</div>
                    <button onClick={() => syncAssets("all")} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "none", background: "var(--success)", color: "#fff", fontFamily: "inherit" }}>
                      Dong bo tu FB ngay
                    </button>
                  </div>
                ) : "Chua co tai khoan nao"}
              </div>
            ) : filtAcc.map((a, idx) => (
              <div key={a.id} onClick={(e) => handleAccClick(idx, a, e)} onMouseDown={(e)=>{ if(e.shiftKey) e.preventDefault() }}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: selAcc.has(a.id) ? "rgba(79,126,248,.06)" : "transparent", userSelect: "none" as const }}>
                <input type="checkbox" checked={selAcc.has(a.id)} onChange={e => { e.stopPropagation(); setSelAcc(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n }) }} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: ac(a.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{ini(a.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>{a.actId}</div>
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, padding: "2px 7px", borderRadius: 4, background: stBg[a.status] || stBg.off, color: stColor[a.status] || "var(--muted)", border: `1px solid ${stColor[a.status] || "#888"}30` }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                  {stLabel[a.status] || a.status}
                </span>
                <button onClick={e => { e.stopPropagation(); deleteAcc(a.id) }} style={{ opacity: 0, padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.2)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit" }}
                  onMouseOver={e => (e.currentTarget as HTMLElement).style.opacity="1"} onMouseOut={e => (e.currentTarget as HTMLElement).style.opacity="0"}>Xoa</button>
              </div>
            ))}
          </div>
        </div>

        {/* Pages */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: "#42b72a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg viewBox="0 0 16 16" width="14" height="14" fill="#fff"><path d="M2 2h12v2H2zm0 4h10v2H2zm0 4h8v2H2z"/></svg>
              </div>
              <div><div style={{ fontSize: 12, fontWeight: 600 }}>Fanpage</div><div style={{ fontSize: 10, color: "var(--muted)" }}>Pages</div></div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ background: "var(--pill-bg)", color: "var(--pill-text)", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 20 }}>{pages.length}</span>
              <button onClick={() => setShowPgModal(true)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 5, fontSize: 11, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", height: 24 }}>+ Them</button>
            </div>
          </div>
          <div style={{ padding: "7px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 7 }}>
            <input type="checkbox" checked={filtPg.length>0 && filtPg.every(p=>selPg.has(p.id))} onChange={e => setSelPg(s => { const n = new Set(s); if (e.target.checked) filtPg.forEach(p => n.add(p.id)); else filtPg.forEach(p => n.delete(p.id)); return n })} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Tat ca</span>
            <div style={{ position: "relative" as const, flex: 1 }}>
              <svg style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }} width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4"/><path d="M11 11l3 3"/></svg>
              <input value={pgSearch} onChange={e => setPgSearch(e.target.value)} placeholder="Tim fanpage..." style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, fontFamily: "inherit", padding: "5px 8px 5px 24px", outline: "none", width: "100%", height: 28 }} />
            </div>
          </div>
          {selPg.size > 0 && (
            <div style={{ padding: "5px 10px", background: "rgba(79,126,248,.07)", borderBottom: "1px solid rgba(79,126,248,.13)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--pill-text)", fontWeight: 500 }}>{selPg.size} da chon</span>
              <div style={{ display: "flex", gap: 5 }}>
                <button onClick={saveSelectedPages} style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(46,204,143,.2)", background: "rgba(46,204,143,.1)", color: "var(--success)", fontFamily: "inherit", fontWeight: 600 }}>Luu lai</button>
                <button onClick={() => { selPg.forEach(id => deletePage(id)); setSelPg(new Set()) }} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.2)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit" }}>Xoa da chon</button>
              </div>
            </div>
          )}
          <div style={{ maxHeight: 320, overflowY: "auto" as const }}>
            {filtPg.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 11 }}>
                {tokenInfo?.hasToken ? (
                  <div>
                    <div style={{ marginBottom: 8 }}>Chua co fanpage nao</div>
                    <button onClick={() => syncAssets("all")} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "none", background: "var(--success)", color: "#fff", fontFamily: "inherit" }}>
                      Dong bo tu FB ngay
                    </button>
                  </div>
                ) : "Chua co fanpage nao"}
              </div>
            ) : filtPg.map((p, idx) => (
              <div key={p.id} onClick={(e) => handlePgClick(idx, p, e)} onMouseDown={(e)=>{ if(e.shiftKey) e.preventDefault() }}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderBottom: "1px solid var(--border)", cursor: "pointer", background: selPg.has(p.id) ? "rgba(79,126,248,.06)" : "transparent", userSelect: "none" as const }}>
                <input type="checkbox" checked={selPg.has(p.id)} onChange={e => { e.stopPropagation(); setSelPg(s => { const n = new Set(s); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n }) }} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
                <div style={{ width: 32, height: 32, borderRadius: "50%", background: ac(p.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{ini(p.name)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>{p.pageId}{p.category ? ` · ${p.category}` : ""}</div>
                </div>
                <button onClick={e => { e.stopPropagation(); deletePage(p.id) }} style={{ opacity: 0, padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.2)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit" }}
                  onMouseOver={e => (e.currentTarget as HTMLElement).style.opacity="1"} onMouseOut={e => (e.currentTarget as HTMLElement).style.opacity="0"}>Xoa</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* TOKEN MODAL */}
      {showTokenModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 480, maxWidth: "94vw", maxHeight: "92vh", overflowY: "auto" as const, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => { setShowTokenModal(false); setTokenMsg(null) }} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Ket noi Facebook Token</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Short token se duoc doi thanh Long-lived token (60 ngay)</div>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px", fontSize: 11, color: "var(--muted)", lineHeight: 1.8 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Huong dan lay Short Token:</div>
              <div>1. Vao <a href="https://developers.facebook.com/tools/explorer" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>Graph API Explorer</a></div>
              <div>2. Chon App → Generate Access Token</div>
              <div>3. Bat quyen: <code style={{ background: "rgba(79,126,248,.1)", padding: "1px 5px", borderRadius: 3, color: "var(--pill-text)" }}>ads_read, ads_management, pages_read_engagement</code></div>
              <div>4. Copy token va dan vao o ben duoi</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <div style={{ background: "rgba(79,126,248,.1)", border: "1px solid rgba(79,126,248,.2)", borderRadius: 6, padding: "4px 10px", color: "var(--pill-text)", fontWeight: 600 }}>Short Token</div>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: 10, color: "var(--muted)" }}>FB API</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <div style={{ background: "rgba(46,204,143,.1)", border: "1px solid rgba(46,204,143,.2)", borderRadius: 6, padding: "4px 10px", color: "var(--success)", fontWeight: 600 }}>Long Token (60 ngay)</div>
              <div style={{ flex: 0.5, height: 1, background: "var(--border)" }} />
              <div style={{ background: "rgba(245,166,35,.1)", border: "1px solid rgba(245,166,35,.2)", borderRadius: 6, padding: "4px 10px", color: "var(--warn)", fontWeight: 600 }}>DB</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div><label style={lbl}>App ID *</label><input value={tokenForm.appId} onChange={e => setTokenForm(f => ({ ...f, appId: e.target.value }))} placeholder="123456789" style={inp} /></div>
              <div><label style={lbl}>App Secret *</label><input type="password" value={tokenForm.appSecret} onChange={e => setTokenForm(f => ({ ...f, appSecret: e.target.value }))} placeholder="••••••••" style={inp} /></div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={lbl}>Short-lived Access Token *</label>
                <textarea value={tokenForm.shortToken} onChange={e => setTokenForm(f => ({ ...f, shortToken: e.target.value }))} placeholder="EAAxxxxxxxxxx..." rows={3}
                  style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 11, fontFamily: "monospace", padding: "8px 10px", outline: "none", width: "100%", resize: "vertical" as const, boxSizing: "border-box" as const }} />
              </div>
            </div>
            {tokenMsg && (
              <div style={{ background: tokenMsg.type==="success"?"rgba(46,204,143,.08)":"rgba(232,77,45,.08)", border: `1px solid ${tokenMsg.type==="success"?"rgba(46,204,143,.2)":"rgba(232,77,45,.2)"}`, borderRadius: 6, padding: "10px 12px", fontSize: 11, color: tokenMsg.type==="success"?"var(--success)":"var(--danger)", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, lineHeight: 1.5, maxHeight: 200, overflowY: "auto" as const }}>
                {tokenMsg.text}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowTokenModal(false); setTokenMsg(null) }} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huy</button>
              <button onClick={saveToken} disabled={tokenLoading || !tokenForm.appId || !tokenForm.appSecret || !tokenForm.shortToken}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 600, height: 32, opacity: (!tokenForm.appId||!tokenForm.appSecret||!tokenForm.shortToken)?0.5:1 }}>
                {tokenLoading ? "Dang xu ly..." : "Exchange & Luu Token"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD ACCOUNT MODAL */}
      {showAccModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 440, padding: 22, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => setShowAccModal(false)} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Them Tai khoan QC</div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Ten tai khoan *</label><input value={accForm.name} onChange={e => setAccForm(f => ({ ...f, name: e.target.value }))} placeholder="Nguyen Store - Chinh" style={inp} /></div>
              <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Act ID *</label><input value={accForm.actId} onChange={e => setAccForm(f => ({ ...f, actId: e.target.value }))} placeholder="act_XXXXXXXXXX" style={inp} /></div>
              <div><label style={lbl}>Trang thai</label><select value={accForm.status} onChange={e => setAccForm(f => ({ ...f, status: e.target.value }))} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", height: 34, width: "100%", outline: "none" }}><option value="on">Hoat dong</option><option value="off">Tat</option></select></div>
              <div><label style={lbl}>Ngan sach/ngay</label><input type="number" value={accForm.budget} onChange={e => setAccForm(f => ({ ...f, budget: e.target.value }))} placeholder="500000" style={inp} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowAccModal(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huy</button>
              <button onClick={addAccount} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 32 }}>Them</button>
            </div>
          </div>
        </div>
      )}

      {/* ADD PAGE MODAL */}
      {showPgModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 440, padding: 22, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => setShowPgModal(false)} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Them Fanpage</div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
              <div><label style={lbl}>Ten Fanpage *</label><input value={pgForm.name} onChange={e => setPgForm(f => ({ ...f, name: e.target.value }))} placeholder="Nguyen Store Official" style={inp} /></div>
              <div><label style={lbl}>Page ID *</label><input value={pgForm.pageId} onChange={e => setPgForm(f => ({ ...f, pageId: e.target.value }))} placeholder="107382940162" style={inp} /></div>
              <div><label style={lbl}>Danh muc</label><input value={pgForm.category} onChange={e => setPgForm(f => ({ ...f, category: e.target.value }))} placeholder="Cua hang ban le" style={inp} /></div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowPgModal(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huy</button>
              <button onClick={addPage} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 32 }}>Them</button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </AppLayout>
  )
}