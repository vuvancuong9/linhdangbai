"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"
import { useConfirm } from "@/components/Confirm"
import { useAuthStore } from "@/store/auth"
import DateInputVN from "@/components/DateInputVN"

export default function CampLoiPage() {
  const toast = useToast()
  const { ask } = useConfirm()
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN"
  const [posts, setPosts] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [pages, setPages] = useState<any[]>([])
  const [accounts, setAccounts] = useState<any[]>([])
  // Filter
  const [search, setSearch] = useState("")
  const [filterPageId, setFilterPageId] = useState("")
  const [filterAccId, setFilterAccId] = useState("")
  const [filterFrom, setFilterFrom] = useState("")
  const [filterTo, setFilterTo] = useState("")
  const [currentPage, setCurrentPage] = useState(1)
  const PER_PAGE = 20
  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkRetrying, setBulkRetrying] = useState(false)
  // Filter chỉ posts đủ điều kiện retry (page đã có TKQC + retry count < 3)
  const [onlyEligible, setOnlyEligible] = useState(false)

  // Posts hiển thị sau filter eligibility (client-side filter trên page hiện tại)
  const displayPosts = onlyEligible
    ? posts.filter((p) => !!p.page?.accountId && (p.adErrorRetryCount ?? 0) < 3)
    : posts

  // Khôi phục modal (post lỗi đã bị "Xoá hết data" nhầm)
  const [showRestore, setShowRestore] = useState(false)
  const [restoreHours, setRestoreHours] = useState(24)
  const [restorePreview, setRestorePreview] = useState<{ count: number; sample: any[] } | null>(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  async function openRestore() {
    setShowRestore(true); setRestorePreview(null)
    await loadRestorePreview(restoreHours)
  }
  async function loadRestorePreview(hours: number) {
    setRestoreLoading(true)
    try {
      const r = await fetch(`/api/posts/restore-deleted?hoursAgo=${hours}&mode=errors`, { credentials: "include" })
      if (r.ok) { const d = await r.json(); setRestorePreview({ count: d.count, sample: d.sample }) }
    } catch {} finally { setRestoreLoading(false) }
  }
  async function doRestore() {
    if (restoring || !restorePreview || restorePreview.count === 0) return
    if (!await ask(`Khôi phục ${restorePreview.count} post lỗi đã xoá nhầm (trong ${restoreHours} giờ)?`, { title: "Khôi phục post đã xoá" })) return
    setRestoring(true)
    try {
      const r = await fetch("/api/posts/restore-deleted", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursAgo: restoreHours, mode: "errors" }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show(d.message || `Đã khôi phục ${d.count}`, "success" as any)
      setShowRestore(false)
      await fetchPosts(1); setCurrentPage(1)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setRestoring(false) }
  }

  useEffect(() => {
    fetchPosts(1)
    fetch("/api/pages", { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => setPages(Array.isArray(d) ? d : []))
    fetch("/api/accounts", { credentials: "include" }).then(r => r.ok ? r.json() : []).then(d => setAccounts(Array.isArray(d) ? d : []))
  }, [])

  async function fetchPosts(page = 1) {
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE), status: "error" })
    if (search.trim()) params.set("search", search.trim())
    if (filterPageId) params.set("pageId", filterPageId)
    if (filterAccId) params.set("adAccountId", filterAccId)
    if (filterFrom) params.set("from", filterFrom)
    if (filterTo) params.set("to", filterTo)
    const res = await fetch(`/api/posts?${params}`, { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      setPosts(data.posts || [])
      setTotal(data.total || 0)
    }
    setLoading(false)
  }

  function applyFilter() { setCurrentPage(1); fetchPosts(1) }
  function clearFilter() {
    setSearch(""); setFilterPageId(""); setFilterAccId(""); setFilterFrom(""); setFilterTo("")
    setCurrentPage(1)
    setTimeout(() => fetchPosts(1), 0)
  }

  async function retry(id: string) {
    if (!await ask("Đưa post này về trạng thái chờ tạo lại?", { warn: true })) return
    await fetch(`/api/posts/${id}/reset-status`, { method: "POST", credentials: "include" }).catch(() => {})
    fetchPosts(currentPage)
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleSelectAll() {
    const visibleIds = displayPosts.map((p) => p.id)
    const allSelected = visibleIds.every((id) => selectedIds.has(id))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allSelected) visibleIds.forEach((id) => next.delete(id))
      else visibleIds.forEach((id) => next.add(id))
      return next
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  async function bulkRetrySelected() {
    if (bulkRetrying) return
    const ids = Array.from(selectedIds)
    if (ids.length === 0) { toast.show("⚠ Chưa chọn post nào", "warn" as any); return }
    if (!await ask(`Thử lại ${ids.length} post đã chọn?\n\nClear adError + reset retry count → cron đầu giờ tới (hoặc click Trigger Auto-camp) sẽ tạo lại.`, { title: "Thử lại loạt", warn: true })) return
    setBulkRetrying(true)
    try {
      const r = await fetch("/api/posts/bulk-clear", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-confirm": "yes" },
        body: JSON.stringify({ mode: "reset-errors", postIds: ids }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show(`✅ Đã reset ${d.count} post — cron tiếp sẽ tạo lại`, "success" as any)
      clearSelection()
      await fetchPosts(currentPage)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setBulkRetrying(false) }
  }

  async function resetAllErrors() {
    if (resetting) return
    if (!await ask(`Reset toàn bộ ${total} post lỗi về trạng thái chờ tạo lại?\n\nPost sẽ quay về trang 'Fanpage Posts' để mày chọn và tạo lại.`, { title: "Reset Camp lỗi", warn: true })) return
    setResetting(true)
    try {
      const r = await fetch("/api/posts/bulk-clear", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-confirm": "yes" },
        body: JSON.stringify({ mode: "reset-errors" }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show(d.message || `Đã reset ${d.count}`, "success" as any)
      await fetchPosts(1); setCurrentPage(1)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setResetting(false) }
  }

  async function clearAll() {
    if (clearing) return
    if (!await ask(`Xoá hẳn ${total} post lỗi?\n\n⚠ Action không hoàn tác. Post bị xoá khỏi DB. Phải sync lại từ FB nếu cần.`, { title: "Xoá data Camp lỗi", danger: true })) return
    setClearing(true)
    try {
      const r = await fetch("/api/posts/bulk-clear", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", "x-confirm": "yes" },
        body: JSON.stringify({ mode: "delete-errors" }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      toast.show(d.message || `Đã xoá ${d.count}`, "success" as any)
      await fetchPosts(1); setCurrentPage(1)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setClearing(false) }
  }

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const SH2: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, fontFamily: "inherit", padding: "0 9px", outline: "none", height: 28 }

  return (
    <AppLayout>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Camp lỗi ({total})</div>
        <div style={{ display: "flex", gap: 6 }}>
          {/* Nút "↩ Khôi phục đã xoá" đã ẨN theo yêu cầu user (2026-05-27).
              Backend endpoint /api/posts/restore-deleted vẫn giữ — dùng cho emergency.
              Re-enable: bỏ comment khối {isAdmin && (<button onClick={openRestore}...)} bên dưới. */}
          {/* {isAdmin && (
            <button onClick={openRestore} title="Khôi phục post lỗi đã bị xoá nhầm"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid rgba(46,204,143,.4)", fontFamily: "inherit", fontWeight: 500, background: "rgba(46,204,143,.08)", color: "var(--success)", height: 30, whiteSpace: "nowrap" as const }}>
              ↩ Khôi phục đã xoá
            </button>
          )} */}
        {isAdmin && total > 0 && (
          <>
            <button onClick={resetAllErrors} disabled={resetting} title="Reset tất cả post lỗi về pending để tạo lại"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: resetting?"wait":"pointer", border: "1px solid rgba(245,166,35,.4)", fontFamily: "inherit", fontWeight: 500, background: "rgba(245,166,35,.1)", color: "var(--warn)", height: 30, whiteSpace: "nowrap" as const, opacity: resetting?0.6:1 }}>
              {resetting ? "⏳..." : "🔄 Reset (tạo lại)"}
            </button>
            <button onClick={clearAll} disabled={clearing} title="Xoá hẳn data 'Camp lỗi' khỏi DB"
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: clearing?"wait":"pointer", border: "1px solid rgba(232,77,45,.4)", fontFamily: "inherit", fontWeight: 500, background: "rgba(232,77,45,.08)", color: "var(--danger)", height: 30, whiteSpace: "nowrap" as const, opacity: clearing?0.6:1 }}>
              {clearing ? "⏳..." : "🗑 Xoá hết data"}
            </button>
          </>
        )}
        </div>
      </div>

      {/* Modal Khôi phục */}
      {showRestore && (
        <div onClick={() => setShowRestore(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: 18, width: 560, maxWidth: "100%", maxHeight: "84vh", overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>↩ Khôi phục post lỗi đã xoá</div>
              <button onClick={() => setShowRestore(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 0, width: 24, height: 24 }}>×</button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Hệ thống dùng <strong>soft delete</strong>. Post bị "Xoá hết data" trong 24-168h có thể khôi phục.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "var(--text)" }}>Khôi phục post bị xoá trong</span>
              <select value={restoreHours} onChange={(e) => { const h = Number(e.target.value); setRestoreHours(h); loadRestorePreview(h) }}
                style={{ ...SH2, width: 110 }}>
                <option value={1}>1 giờ</option>
                <option value={6}>6 giờ</option>
                <option value={24}>24 giờ</option>
                <option value={48}>2 ngày</option>
                <option value={168}>7 ngày</option>
              </select>
            </div>
            {restoreLoading ? (
              <div style={{ padding: 20, textAlign: "center" as const, color: "var(--muted)" }}>Đang quét...</div>
            ) : restorePreview ? (
              <>
                <div style={{ padding: "10px 14px", background: restorePreview.count > 0 ? "rgba(46,204,143,.08)" : "rgba(120,120,120,.08)", borderRadius: 6, border: `1px solid ${restorePreview.count > 0 ? "rgba(46,204,143,.3)" : "var(--border2)"}` }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: restorePreview.count > 0 ? "var(--success)" : "var(--muted)" }}>
                    {restorePreview.count > 0 ? `✅ Tìm thấy ${restorePreview.count} post lỗi đã xoá` : "Không có post nào bị xoá trong khoảng này"}
                  </div>
                </div>
                {restorePreview.sample.length > 0 && (
                  <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden", maxHeight: 280, overflowY: "auto" as const }}>
                    <div style={{ padding: "6px 10px", background: "var(--bg3)", fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>10 POST GẦN NHẤT (preview)</div>
                    {restorePreview.sample.map((p: any) => (
                      <div key={p.id} style={{ padding: "8px 10px", borderTop: "1px solid var(--border)", fontSize: 11 }}>
                        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name || p.fbId || "—"}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                          {p.campaign?.name && <span>{p.campaign.name} • </span>}
                          Xoá lúc: {new Date(p.deletedAt).toLocaleString("vi-VN")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowRestore(false)} style={{ padding: "7px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}>Huỷ</button>
              <button onClick={doRestore} disabled={restoring || !restorePreview || restorePreview.count === 0}
                style={{ padding: "7px 16px", borderRadius: 6, fontSize: 12, cursor: (restoring || !restorePreview || restorePreview.count === 0) ? "default" : "pointer", border: "none", background: "var(--success)", color: "#fff", fontWeight: 600, opacity: (restoring || !restorePreview || restorePreview.count === 0) ? 0.5 : 1 }}>
                {restoring ? "⏳ Đang khôi phục..." : `↩ Khôi phục ${restorePreview?.count || 0}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="filter-bar" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" as const, padding: 10, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
        <input placeholder="Tìm tên camp / bài..." value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")applyFilter()}} style={{...SH2, width: 180}} />
        <select value={filterPageId} onChange={e=>setFilterPageId(e.target.value)} style={{...SH2, width: 150}}>
          <option value="">Tất cả Fanpage</option>
          {pages.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filterAccId} onChange={e=>setFilterAccId(e.target.value)} style={{...SH2, width: 170}}>
          <option value="">Tất cả TKQC</option>
          {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <DateInputVN value={filterFrom} onChange={setFilterFrom} style={{...SH2, width: 120}} placeholder="Từ ngày" />
        <DateInputVN value={filterTo} onChange={setFilterTo} style={{...SH2, width: 120}} placeholder="Đến ngày" />
        <button onClick={applyFilter} style={{padding:"6px 14px", borderRadius:5, fontSize:11, cursor:"pointer", border:"none", background:"var(--accent)", color:"#fff", fontFamily:"inherit", fontWeight:500, height:28}}>Lọc</button>
        <button onClick={clearFilter} style={{padding:"6px 12px", borderRadius:5, fontSize:11, cursor:"pointer", border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", fontFamily:"inherit", height:28}}>Xoá lọc</button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer", color: "var(--text)", marginLeft: 6 }} title="Chỉ hiện posts có page đã gán TKQC + retry count < 3">
          <input type="checkbox" checked={onlyEligible} onChange={e => setOnlyEligible(e.target.checked)} />
          Chỉ posts đủ điều kiện retry
        </label>
      </div>

      {/* Bulk selection toolbar */}
      {(selectedIds.size > 0 || displayPosts.length > 0) && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", background: selectedIds.size > 0 ? "rgba(46,204,143,.08)" : "var(--bg2)", border: "1px solid " + (selectedIds.size > 0 ? "rgba(46,204,143,.4)" : "var(--border)"), borderRadius: 8, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: selectedIds.size > 0 ? "var(--success)" : "var(--muted)" }}>
            {selectedIds.size > 0 ? `✓ Đã chọn ${selectedIds.size} post` : `Tổng ${displayPosts.length} post hiển thị`}
          </span>
          {displayPosts.length > 0 && (
            <button onClick={toggleSelectAll} style={{ padding: "4px 10px", fontSize: 11, borderRadius: 5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>
              {displayPosts.every(p => selectedIds.has(p.id)) ? "Bỏ chọn tất cả" : "Chọn tất cả (trang này)"}
            </button>
          )}
          {selectedIds.size > 0 && (
            <>
              <button onClick={clearSelection} style={{ padding: "4px 10px", fontSize: 11, borderRadius: 5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }}>Bỏ chọn</button>
              <button onClick={bulkRetrySelected} disabled={bulkRetrying} style={{ padding: "4px 12px", fontSize: 11, borderRadius: 5, cursor: bulkRetrying ? "wait" : "pointer", border: "none", background: "var(--success)", color: "#fff", fontWeight: 600, opacity: bulkRetrying ? 0.6 : 1 }}>
                {bulkRetrying ? "⏳ Đang reset..." : `🔄 Thử lại ${selectedIds.size} đã chọn`}
              </button>
            </>
          )}
        </div>
      )}

      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" as const, minWidth: 860 }}>
          <colgroup>
            <col style={{ width: 32 }}/><col style={{ width: 44 }}/><col style={{ width: "19%" }}/><col style={{ width: "12%" }}/><col style={{ width: "12%" }}/><col /><col style={{ width: 130 }}/><col style={{ width: 90 }}/>
          </colgroup>
          <thead>
            <tr style={{ background: "var(--bg3)" }}>
              <th style={{ padding: "8px 8px", textAlign: "center" as const, borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={displayPosts.length > 0 && displayPosts.every(p => selectedIds.has(p.id))} onChange={toggleSelectAll} title="Chọn tất cả trên trang này" />
              </th>
              {["STT","BAI DANG","FANPAGE","TEN CAMP","LOI","THOI GIAN","THAO TAC"].map(h => (
                <th key={h} style={{ padding: "8px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Dang tai...</td></tr>
            ) : displayPosts.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>{onlyEligible ? "Không có post đủ điều kiện retry" : "Chua co camp loi"}</td></tr>
            ) : displayPosts.map((p, i) => (
              <tr key={p.id} style={{ borderBottom: "1px solid var(--border)", background: selectedIds.has(p.id) ? "rgba(46,204,143,.04)" : "transparent" }}>
                <td style={{ padding: "10px 8px", textAlign: "center" as const }}>
                  <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                </td>
                <td style={{ padding: "10px 12px", color: "var(--muted)", textAlign: "center" as const }}>{(currentPage-1)*PER_PAGE+i+1}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }} title={p.name}>{p.name||"Bai dang"}</div>
                  <div style={{ fontSize: 9.5, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>{p.fbId||"—"}</div>
                </td>
                <td style={{ padding: "10px 12px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.page?.name||"—"}</td>
                <td style={{ padding: "10px 12px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.campaign?.name||"—"}</td>
                <td style={{ padding: "10px 12px", fontSize: 10.5, color: "var(--danger)", whiteSpace: "normal" as const, wordBreak: "break-word" as const }} title={p.adError}>{p.adError || "—"}</td>
                <td style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" as const }}>{p.adErrorAt ? new Date(p.adErrorAt).toLocaleString("vi-VN") : "—"}</td>
                <td style={{ padding: "10px 12px" }}>
                  <button onClick={() => retry(p.id)} style={{ padding: "3px 9px", fontSize: 10, borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}>Thử lại</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
          <span>Hien thi {total>0?(currentPage-1)*PER_PAGE+1:0}-{Math.min(currentPage*PER_PAGE,total)} / {total} bai</span>
          <div style={{ display: "flex", gap: 3 }}>
            <button onClick={()=>{const p=Math.max(1,currentPage-1);setCurrentPage(p);fetchPosts(p)}} disabled={currentPage===1} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:currentPage===1?"var(--muted)":"var(--text)",fontSize:11,cursor:currentPage===1?"default":"pointer" }}>‹</button>
            {Array.from({length:Math.min(totalPages,5)},(_,i)=>{
              let pg=i+1; if(totalPages>5&&currentPage>3) pg=currentPage-2+i; if(pg>totalPages) return null
              return <button key={pg} onClick={()=>{setCurrentPage(pg);fetchPosts(pg)}} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${pg===currentPage?"var(--accent)":"var(--border)"}`,background:pg===currentPage?"var(--accent)":"transparent",color:pg===currentPage?"#fff":"var(--muted)",fontSize:11,cursor:"pointer" }}>{pg}</button>
            })}
            <button onClick={()=>{const p=Math.min(totalPages,currentPage+1);setCurrentPage(p);fetchPosts(p)}} disabled={currentPage===totalPages} style={{ width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:currentPage===totalPages?"var(--muted)":"var(--text)",fontSize:11,cursor:currentPage===totalPages?"default":"pointer" }}>›</button>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
