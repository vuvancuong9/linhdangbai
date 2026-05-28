"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useConfirm } from "@/components/Confirm"

const COLORS = ["#4f7ef8", "#2ecc8f", "#f5a623", "#e84d4d", "#9b59b6", "#1abc9c", "#e67e22", "#3498db"]

// Format month label (vi-VN)
function fmtMonthLabel(monthKey: string): string {
  if (monthKey === "default") return "Mặc định (fallback)"
  const m = monthKey.match(/^(\d{4})-(\d{2})/)
  if (!m) return monthKey
  return `Tháng ${parseInt(m[2])}/${m[1]}`
}
function currentMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}
function prevMonthKey(monthKey: string): string {
  if (monthKey === "default") return "default"
  const m = monthKey.match(/^(\d{4})-(\d{2})/)
  if (!m) return monthKey
  const y = parseInt(m[1]), mm = parseInt(m[2])
  if (mm === 1) return `${y - 1}-12`
  return `${y}-${String(mm - 1).padStart(2, "0")}`
}
// Generate month options từ tháng hiện tại lùi về tháng 2/2026 (DATA_LOCK_DATE).
// Default vẫn giữ làm fallback.
const LOCK_YEAR = 2026
const LOCK_MONTH = 2  // tháng 2
function monthOptions(): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [{ key: "default", label: "Mặc định (fallback)" }]
  const today = new Date()
  let y = today.getFullYear()
  let m = today.getMonth() + 1
  while (y > LOCK_YEAR || (y === LOCK_YEAR && m >= LOCK_MONTH)) {
    const key = `${y}-${String(m).padStart(2, "0")}`
    out.push({ key, label: fmtMonthLabel(key) })
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

export default function NhomTaiKhoanPage() {
  const { ask } = useConfirm()
  const [groups, setGroups] = useState<any[]>([])
  const [adAccounts, setAdAccounts] = useState<any[]>([]) // {id, name, actId, status, groupId, fromDefault}
  const [shopeeAccounts, setShopeeAccounts] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ id: "", name: "", color: COLORS[0] })
  const [msg, setMsg] = useState("")
  // Per-month state
  const [monthKey, setMonthKey] = useState<string>(currentMonthKey())
  // Bulk selection: chọn nhiều TKQC FB → gán nhóm cùng lúc
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkGroupId, setBulkGroupId] = useState<string>("")
  const [bulkLoading, setBulkLoading] = useState(false)

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectAll(ids: string[]) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      const allSelected = ids.every(id => next.has(id))
      if (allSelected) ids.forEach(id => next.delete(id))
      else ids.forEach(id => next.add(id))
      return next
    })
  }
  function clearSelection() { setSelectedIds(new Set()) }

  async function loadAll() {
    setLoading(true)
    try {
      const [g, s, assignRes] = await Promise.all([
        fetch("/api/groups", { cache: "no-store" }).then(r => r.ok ? r.json() : { groups: [] }),
        fetch("/api/shopee/token", { cache: "no-store" }).then(r => r.ok ? r.json() : { accounts: [] }),
        fetch(`/api/account-assignment?monthKey=${encodeURIComponent(monthKey)}`, { cache: "no-store" }).then(r => r.ok ? r.json() : { items: [] }),
      ])
      setGroups(g.groups || [])
      setShopeeAccounts(s.accounts || [])
      // Map từ assignment API: items có { accountId, accountName, groupId, fromDefault, ... }
      const ads = (assignRes.items || []).map((it: any) => ({
        id: it.accountId,
        name: it.accountName,
        actId: it.accountActId,
        status: it.accountStatus,
        groupId: it.groupId, // resolved cho monthKey hiện tại (có thể từ default)
        fromDefault: it.fromDefault,
        hasMonthOverride: it.hasMonthOverride,
      }))
      setAdAccounts(ads)
    } catch {}
    setLoading(false)
  }
  useEffect(() => { loadAll(); clearSelection() }, [monthKey])

  // Bulk gán: chọn nhiều TK → áp dụng nhóm cho tất cả (cho monthKey hiện tại).
  // groupId = "" → gỡ khỏi nhóm (tombstone cho tháng cụ thể, hoặc xoá entry với default).
  async function bulkAssign() {
    if (bulkLoading) return
    if (selectedIds.size === 0) { setMsg("⚠️ Chưa chọn TK nào"); setTimeout(() => setMsg(""), 2500); return }
    const targetGroupId = bulkGroupId || null
    const targetLabel = targetGroupId ? (groups.find(g => g.id === targetGroupId)?.name || "?") : "— Gỡ khỏi nhóm —"
    if (!await ask(`Áp dụng "${targetLabel}" cho ${selectedIds.size} TKQC?\n\nÁp dụng cho ${fmtMonthLabel(monthKey)}.`, { title: "Gán cả loạt", warn: !targetGroupId })) return
    setBulkLoading(true)
    setMsg(`⏳ Đang áp dụng cho ${selectedIds.size} TK...`)
    let ok = 0, fail = 0
    const ids = Array.from(selectedIds)
    // Chạy parallel cap 5 để không quá tải server
    const CONC = 5
    for (let i = 0; i < ids.length; i += CONC) {
      const batch = ids.slice(i, i + CONC)
      const results = await Promise.allSettled(batch.map(accountId =>
        fetch("/api/account-assignment", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, groupId: targetGroupId, monthKey }),
        }).then(r => { if (!r.ok) throw new Error("HTTP " + r.status) })
      ))
      for (const r of results) { if (r.status === "fulfilled") ok++; else fail++ }
    }
    setBulkLoading(false)
    setMsg(fail === 0 ? `✅ Đã áp dụng ${ok} TK` : `⚠️ ${ok} thành công, ${fail} lỗi`)
    setTimeout(() => setMsg(""), 4000)
    clearSelection()
    loadAll()
  }

  async function saveGroup() {
    if (!form.name.trim()) return
    try {
      const r = await fetch("/api/groups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lỗi")
      setShowForm(false); setForm({ id: "", name: "", color: COLORS[0] })
      setMsg(form.id ? "✅ Đã cập nhật" : "✅ Đã tạo nhóm"); setTimeout(()=>setMsg(""), 2500)
      loadAll()
    } catch (e:any) { setMsg("❌ " + e.message); setTimeout(()=>setMsg(""), 4000) }
  }

  async function deleteGroup(id: string, name: string) {
    if (!await ask(`Xoá nhóm "${name}"?\n\nTKQC + Shopee bên trong sẽ về dạng "chưa nhóm".`, { title: "Xoá nhóm", danger: true })) return
    await fetch("/api/groups?id=" + encodeURIComponent(id), { method: "DELETE" })
    loadAll()
  }

  // Gán FB ad account → dùng /api/account-assignment với monthKey hiện tại
  async function assignFb(accountId: string, groupId: string | null) {
    if (groupId === null) {
      const acc = adAccounts.find((x:any) => x.id === accountId)
      if (acc?.groupId) {
        if (!await ask(`Gỡ "${acc.name}" khỏi nhóm cho ${fmtMonthLabel(monthKey)}?`, { warn: true })) return
      }
    }
    try {
      const r = await fetch("/api/account-assignment", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, groupId, monthKey }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      // Optimistic update
      setAdAccounts(arr => arr.map((x:any) => x.id === accountId ? { ...x, groupId, hasMonthOverride: !!groupId, fromDefault: false } : x))
      setMsg(`✅ Đã cập nhật cho ${fmtMonthLabel(monthKey)}`); setTimeout(()=>setMsg(""), 2500)
    } catch (e:any) {
      setMsg("❌ " + (e?.message || "Lỗi"))
      setTimeout(()=>setMsg(""), 5000)
      loadAll()
    }
  }

  // Gán Shopee → dùng API cũ (không per-month)
  async function assignShopee(accountId: string, groupId: string | null) {
    if (groupId === null) {
      const acc = shopeeAccounts.find((x:any) => x.id === accountId)
      if (acc?.groupId) {
        if (!await ask(`Gỡ "${acc.name}" khỏi nhóm hiện tại?`, { warn: true })) return
      }
    }
    try {
      const r = await fetch("/api/groups/assign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "shopee", accountId, groupId }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setShopeeAccounts(arr => arr.map((x:any) => x.id === accountId ? { ...x, groupId } : x))
      setMsg("✅ Đã cập nhật"); setTimeout(()=>setMsg(""), 2000)
    } catch (e:any) {
      setMsg("❌ " + (e?.message || "Lỗi"))
      setTimeout(()=>setMsg(""), 5000)
      loadAll()
    }
  }

  async function copyFromPrev() {
    const fromKey = prevMonthKey(monthKey)
    if (fromKey === monthKey) return
    const fromLabel = fmtMonthLabel(fromKey)
    const toLabel = fmtMonthLabel(monthKey)
    if (!await ask(`Copy assignment từ "${fromLabel}" sang "${toLabel}"?\n\n⚠ Data ${toLabel} hiện tại sẽ bị OVERWRITE.`, { title: "Copy assignment", warn: true })) return
    try {
      const r = await fetch("/api/account-assignment/copy", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromMonthKey: fromKey, toMonthKey: monthKey }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setMsg(`✅ Copy ${d.copied} TK từ ${fromLabel}`); setTimeout(()=>setMsg(""), 3000)
      loadAll()
    } catch (e:any) {
      setMsg("❌ " + (e?.message || "Lỗi"))
      setTimeout(()=>setMsg(""), 5000)
    }
  }

  const ungroupedAd = adAccounts.filter((a: any) => !a.groupId)
  const ungroupedSh = shopeeAccounts.filter((a: any) => !a.groupId)

  return (
    <AppLayout>
      <div className="row-actions" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Nhóm tài khoản</div>
        <div className="row-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
          {msg && <span style={{ fontSize: 11, color: "var(--muted)", alignSelf: "center" }}>{msg}</span>}
          <button onClick={() => loadAll()} disabled={loading} title="Tải lại từ server" style={{ padding: "6px 12px", borderRadius: 6, fontSize: 12, cursor: loading?"wait":"pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", opacity: loading?0.6:1 }}>
            {loading ? "⏳" : "🔄 Refresh"}
          </button>
          <button onClick={() => { setForm({ id: "", name: "", color: COLORS[0] }); setShowForm(true) }} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}>+ Tạo nhóm</button>
        </div>
      </div>

      {/* Month picker — chỉ áp dụng cho TKQC FB */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".4px" }}>📅 Tháng áp dụng (cho TKQC FB)</div>
        <select value={monthKey} onChange={(e) => setMonthKey(e.target.value)} style={{ height: 30, padding: "0 10px", borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, fontFamily: "inherit", outline: "none", minWidth: 180 }}>
          {monthOptions().map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <button onClick={copyFromPrev} disabled={monthKey === "default"} title="Copy assignment từ tháng trước sang tháng này" style={{ padding: "5px 10px", borderRadius: 5, fontSize: 11, cursor: monthKey === "default" ? "not-allowed" : "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit", opacity: monthKey === "default" ? 0.4 : 1 }}>📋 Copy từ tháng trước</button>
        <div style={{ flex: 1, minWidth: 120 }} />
        <div style={{ fontSize: 10, color: "var(--muted)", fontStyle: "italic", maxWidth: 360 }}>
          {monthKey === "default"
            ? "Default: dùng khi 1 tháng chưa có assignment riêng → fallback về đây."
            : "Đổi nhóm cho TKQC chỉ ảnh hưởng tháng này. Tháng khác giữ nguyên."}
        </div>
      </div>

      {/* Bulk action bar — sticky khi có tích chọn */}
      {selectedIds.size > 0 && (
        <div style={{ position: "sticky" as const, top: 48, zIndex: 200, background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const, boxShadow: "0 4px 12px rgba(0,0,0,.15)" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>✅ Đã chọn {selectedIds.size} TKQC</span>
          <span style={{ fontSize: 11, opacity: .9 }}>→ Gán vào nhóm:</span>
          <select value={bulkGroupId} onChange={e => setBulkGroupId(e.target.value)} disabled={bulkLoading} style={{ height: 30, fontSize: 12, background: "rgba(255,255,255,.95)", border: "none", borderRadius: 5, color: "#222", padding: "0 8px", outline: "none", minWidth: 150, fontFamily: "inherit" }}>
            <option value="">— Gỡ khỏi nhóm —</option>
            {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <button onClick={bulkAssign} disabled={bulkLoading} style={{ padding: "6px 14px", borderRadius: 5, fontSize: 12, cursor: bulkLoading ? "wait" : "pointer", border: "none", background: "#fff", color: "var(--accent)", fontFamily: "inherit", fontWeight: 600, opacity: bulkLoading ? 0.6 : 1 }}>
            {bulkLoading ? "⏳ Đang chạy..." : "Áp dụng"}
          </button>
          <button onClick={clearSelection} disabled={bulkLoading} style={{ padding: "6px 12px", borderRadius: 5, fontSize: 11, cursor: bulkLoading ? "wait" : "pointer", border: "1px solid rgba(255,255,255,.5)", background: "transparent", color: "#fff", fontFamily: "inherit" }}>
            Bỏ chọn
          </button>
        </div>
      )}

      {/* Ungrouped */}
      {(ungroupedAd.length > 0 || ungroupedSh.length > 0) && (
        <div style={{ background: "var(--bg2)", border: "1px dashed var(--border2)", borderRadius: 8, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 8, flexWrap: "wrap" as const }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>
              Chưa thuộc nhóm — chọn nhóm bên phải để gán
            </div>
            {ungroupedAd.length > 0 && (
              <button onClick={() => selectAll(ungroupedAd.map((a: any) => a.id))} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>
                {ungroupedAd.every((a: any) => selectedIds.has(a.id)) ? "Bỏ chọn tất cả" : `Chọn tất cả ${ungroupedAd.length} TK`}
              </button>
            )}
          </div>
          <AccountList
            adAccounts={ungroupedAd}
            shopeeAccounts={ungroupedSh}
            groups={groups}
            onAssignFb={assignFb}
            onAssignShopee={assignShopee}
            monthKey={monthKey}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        </div>
      )}

      {/* Groups */}
      {loading ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Đang tải...</div>
      ) : groups.length === 0 ? (
        <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>Chưa có nhóm nào. Bấm "+ Tạo nhóm" để bắt đầu.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 12 }}>
          {groups.map((g: any) => {
            const groupAd = adAccounts.filter((a: any) => a.groupId === g.id)
            const groupSh = shopeeAccounts.filter((a: any) => a.groupId === g.id)
            return (
              <div key={g.id} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
                <div style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", background: g.color + "12", flexWrap: "wrap" as const, gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" as const }}>
                    <div style={{ width: 12, height: 12, borderRadius: 3, background: g.color }} />
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{g.name}</div>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(79,126,248,.12)", color: "var(--pill-text)" }}>FB ×{groupAd.length}</span>
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 3, background: "rgba(238,77,45,.12)", color: "#ee4d2d" }}>Shopee ×{groupSh.length}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => { setForm({ id: g.id, name: g.name, color: g.color }); setShowForm(true) }} style={{ padding: "3px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)" }}>Sửa</button>
                    <button onClick={() => deleteGroup(g.id, g.name)} style={{ padding: "3px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.3)", background: "transparent", color: "var(--danger)" }}>Xoá</button>
                  </div>
                </div>
                <div style={{ padding: 14 }}>
                  {groupAd.length === 0 && groupSh.length === 0 ? (
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>Nhóm trống cho {fmtMonthLabel(monthKey)}.</div>
                  ) : (
                    <>
                      {groupAd.length > 0 && (
                        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
                          <button onClick={() => selectAll(groupAd.map((a: any) => a.id))} style={{ padding: "2px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>
                            {groupAd.every((a: any) => selectedIds.has(a.id)) ? "Bỏ chọn" : `Chọn ${groupAd.length} TK`}
                          </button>
                        </div>
                      )}
                      <AccountList
                        adAccounts={groupAd}
                        shopeeAccounts={groupSh}
                        groups={groups}
                        onAssignFb={assignFb}
                        onAssignShopee={assignShopee}
                        monthKey={monthKey}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                      />
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 420, padding: 22, display: "flex", flexDirection: "column" as const, gap: 14, position: "relative" as const }}>
            <button onClick={() => setShowForm(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{form.id ? "Sửa nhóm" : "Tạo nhóm mới"}</div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>Tên nhóm *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Mỹ phẩm / Thời trang / Tech..." style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, padding: "0 10px", height: 34, width: "100%", outline: "none", boxSizing: "border-box" } as React.CSSProperties} autoFocus />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>Màu</label>
              <div style={{ display: "flex", gap: 7 }}>
                {COLORS.map(c => (
                  <div key={c} onClick={() => setForm(f => ({ ...f, color: c }))} style={{ width: 26, height: 26, borderRadius: 5, background: c, cursor: "pointer", border: form.color === c ? "2px solid #fff" : "2px solid transparent", boxShadow: form.color === c ? "0 0 0 2px " + c : "none" }} />
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button onClick={() => setShowForm(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>Huỷ</button>
              <button onClick={saveGroup} disabled={!form.name.trim()} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: form.name.trim() ? 1 : 0.5 }}>{form.id ? "Cập nhật" : "Tạo"}</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

function AccountList({ adAccounts, shopeeAccounts, groups, onAssignFb, onAssignShopee, monthKey, selectedIds, onToggleSelect }: {
  adAccounts: any[]
  shopeeAccounts: any[]
  groups: any[]
  onAssignFb: (id: string, groupId: string | null) => void
  onAssignShopee: (id: string, groupId: string | null) => void
  monthKey: string
  selectedIds: Set<string>
  onToggleSelect: (id: string) => void
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column" as const, gap: 6 }}>
      {adAccounts.map((a: any) => (
        <AccountRowFb key={"ad-" + a.id} account={a} groups={groups} onAssign={onAssignFb} monthKey={monthKey} checked={selectedIds.has(a.id)} onToggle={() => onToggleSelect(a.id)} />
      ))}
      {shopeeAccounts.map((a: any) => (
        <AccountRowShopee key={"sh-" + a.id} account={a} groups={groups} onAssign={onAssignShopee} />
      ))}
    </div>
  )
}

function AccountRowFb({ account, groups, onAssign, monthKey, checked, onToggle }: { account: any; groups: any[]; onAssign: (id: string, groupId: string | null) => void; monthKey: string; checked: boolean; onToggle: () => void }) {
  const isFromDefault = account.fromDefault
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: checked ? "rgba(79,126,248,.08)" : "var(--bg3)", border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`, borderRadius: 6 }}>
      <input type="checkbox" checked={checked} onChange={onToggle} style={{ width: 20, height: 20, cursor: "pointer", accentColor: "var(--accent)", flexShrink: 0 }} />
      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(79,126,248,.15)", color: "var(--pill-text)", fontWeight: 600 }}>FB</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{account.name}</div>
        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{account.actId}</div>
      </div>
      {isFromDefault && monthKey !== "default" && (
        <span title="Đang dùng giá trị từ Mặc định (chưa override cho tháng này)" style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(245,166,35,.15)", color: "var(--warn)", fontWeight: 600 }}>↪ default</span>
      )}
      <select value={account.groupId || ""} onChange={e => onAssign(account.id, e.target.value || null)} style={{ height: 28, fontSize: 11, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", padding: "0 8px", outline: "none", minWidth: 130 }}>
        <option value="">— Chưa nhóm —</option>
        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
  )
}

function AccountRowShopee({ account, groups, onAssign }: { account: any; groups: any[]; onAssign: (id: string, groupId: string | null) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 6 }}>
      <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 3, background: "rgba(238,77,45,.15)", color: "#ee4d2d", fontWeight: 600 }}>SHOPEE</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500 }}>{account.name}</div>
        <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{account.appId}</div>
      </div>
      <select value={account.groupId || ""} onChange={e => onAssign(account.id, e.target.value || null)} style={{ height: 28, fontSize: 11, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", padding: "0 8px", outline: "none", minWidth: 130 }}>
        <option value="">— Chưa nhóm —</option>
        {groups.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
    </div>
  )
}
