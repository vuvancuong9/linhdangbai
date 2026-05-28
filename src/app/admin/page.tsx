"use client"
import { useState, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useAuthStore } from "@/store/auth"
import { useToast } from "@/components/Toast"
import { useConfirm } from "@/components/Confirm"
import { MENU_PERMISSIONS, MENU_KEYS } from "@/lib/permissions"

const COLORS = ['#4f7ef8','#2ecc8f','#f5a623','#e84d4d','#9b59b6','#1abc9c']
const ac = (n: string) => { let h = 0; for (const c of n) h = (h + c.charCodeAt(0)) % COLORS.length; return COLORS[h] }
const ini = (n: string) => n.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
const fmt = (n: number) => "d" + n.toLocaleString("vi-VN")

export default function AdminPage() {
  const toast = useToast()
  const { ask } = useConfirm()
  const { user: currentUser } = useAuthStore()
  const isSuperAdmin = currentUser?.role === "SUPER_ADMIN"
  const isAdmin = isSuperAdmin || currentUser?.role === "ADMIN"
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState("")
  const [showAddUser, setShowAddUser] = useState(false)
  // ADMIN chỉ tạo được USER → role mặc định USER. SUPER_ADMIN có thể tạo USER hoặc ADMIN.
  const [newUser, setNewUser] = useState<{ name: string; email: string; password: string; role: string; permissions: string[] }>({ name: "", email: "", password: "", role: "USER", permissions: [] })
  const [editPerms, setEditPerms] = useState<{ userId: string; perms: string[] } | null>(null)
  const [savingPerms, setSavingPerms] = useState(false)
  const [addMsg, setAddMsg] = useState<{type:"success"|"error",text:string}|null>(null)
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set())
  const [cleaningDb, setCleaningDb] = useState(false)

  useEffect(() => { fetchOverview() }, [])

  // Perms current user co the GAN cho user khac.
  // - SUPER_ADMIN: gan duoc TAT CA permissions (full).
  // - ADMIN: chi gan duoc nhung perm chinh ADMIN co. Neu ADMIN khong limited (legacy full) → gan duoc tat ca.
  const grantablePerms: string[] = (() => {
    if (isSuperAdmin) return MENU_KEYS.slice()
    if (currentUser?.permissions) {
      try {
        const parsed = JSON.parse(currentUser.permissions)
        if (Array.isArray(parsed)) return parsed.filter(k => MENU_KEYS.includes(k))
      } catch {}
    }
    // Legacy ADMIN khong co permissions JSON → coi nhu full
    return MENU_KEYS.slice()
  })()
  const grantableMenus = MENU_PERMISSIONS.filter(m => grantablePerms.includes(m.key))

  async function fetchOverview(opts?: { background?: boolean }) {
    const cacheKey = "admin_overview_cache"
    if (!opts?.background) {
      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const { data: cd, ts } = JSON.parse(cached)
          if (Date.now() - ts < 2 * 60 * 1000) {
            setData(cd)
            fetchOverview({ background: true })
            return
          }
        }
      } catch {}
      setLoading(true)
    }
    const res = await fetch("/api/admin/overview")
    if (res.ok) {
      const d = await res.json()
      setData(d)
      try { localStorage.setItem(cacheKey, JSON.stringify({ data: d, ts: Date.now() })) } catch {}
    } else if (res.status === 403) window.location.href = "/keo-ads"
    else if (res.status === 401) window.location.href = "/login"
    if (!opts?.background) setLoading(false)
  }

  async function addUser() {
    if (!isAdmin) return
    setAddMsg(null)
    // Validate permissions bắt buộc khi role !== SUPER_ADMIN
    if (newUser.role !== "SUPER_ADMIN" && newUser.permissions.length === 0) {
      setAddMsg({ type: "error", text: "Tích chọn ít nhất 1 quyền truy cập" })
      return
    }
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newUser.name,
        email: newUser.email,
        password: newUser.password,
        role: newUser.role,
        permissions: newUser.role !== "SUPER_ADMIN" ? newUser.permissions : null,
      }),
    })
    const d = await res.json()
    if (res.ok) {
      setAddMsg({ type: "success", text: "Tao tai khoan thanh cong!" })
      setNewUser({ name: "", email: "", password: "", role: "USER", permissions: [] })
      setTimeout(() => { setShowAddUser(false); setAddMsg(null); fetchOverview() }, 1200)
    } else setAddMsg({ type: "error", text: d.error || "Loi" })
  }

  // Sửa permissions của user đang có.
  async function savePerms() {
    if (!editPerms || savingPerms) return
    if (editPerms.perms.length === 0) {
      toast.show("Tích chọn ít nhất 1 quyền truy cập", "warn" as any)
      return
    }
    setSavingPerms(true)
    try {
      const r = await fetch(`/api/users/${editPerms.userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: editPerms.perms }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Loi")
      toast.show(d.sessionsRevoked ? "✅ Đã cập nhật quyền — user sẽ tự động bị đăng xuất" : "Đã cập nhật quyền truy cập", "success" as any)
      setEditPerms(null)
      fetchOverview()
    } catch (e: any) {
      toast.show("Lỗi: " + e.message, "error" as any)
    } finally {
      setSavingPerms(false)
    }
  }

  // Optimistic update: cập nhật UI ngay, đảo lại nếu server fail.
  async function toggleLock(userId: string, currentStatus: string) {
    if (!isSuperAdmin || pendingIds.has(userId)) return
    const newStatus = currentStatus === "ACTIVE" ? "LOCKED" : "ACTIVE"
    // Optimistic: update local data
    setData((d:any) => d ? { ...d, users: d.users.map((u:any) => u.id === userId ? { ...u, status: newStatus } : u) } : d)
    setPendingIds(s => new Set(s).add(userId))
    try {
      const r = await fetch(`/api/users/${userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: newStatus }) })
      if (!r.ok) throw new Error((await r.json()).error || "Lỗi")
    } catch (e:any) {
      // Rollback
      setData((d:any) => d ? { ...d, users: d.users.map((u:any) => u.id === userId ? { ...u, status: currentStatus } : u) } : d)
      toast.show("Lỗi: " + e.message, "error" as any)
    } finally {
      setPendingIds(s => { const n = new Set(s); n.delete(userId); return n })
    }
  }

  // Manual cleanup DB: xoá data cũ (LoginSession, CampLog, OrderCommission cancelled, ...).
  async function runDbCleanup() {
    if (!isSuperAdmin || cleaningDb) return
    if (!await ask(
      "Dọn dẹp DB ngay?\n\n• Xoá LoginSession revoke > 30 ngày\n• Xoá CampLog > 90 ngày\n• Xoá đơn cancelled > 180 ngày\n• Xoá click data > 1 năm\n• Xoá Post đã xoá > 30 ngày\n\nKhông thể undo.",
      { title: "Xác nhận dọn dẹp", danger: true },
    )) return
    setCleaningDb(true)
    try {
      const r = await fetch("/api/admin/cleanup-db", { method: "POST" })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lỗi")
      const x = d.result
      toast.show(
        `✅ Đã xoá ${x.totalDeleted} rows (${x.durationMs}ms): ` +
        `session=${x.loginSessionRevoked + x.loginSessionStale}, log=${x.campLogOld}, ` +
        `order_cancel=${x.orderCommissionCancelled}, click=${x.affiliateClicksOld}, post=${x.postsSoftDeleted}`,
        "success" as any,
      )
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally {
      setCleaningDb(false)
    }
  }

  // Đổi quyền user (SUPER_ADMIN / ADMIN / USER). Optimistic update.
  async function changeRole(userId: string, currentRole: string, newRole: string) {
    if (!isSuperAdmin || pendingIds.has(userId)) return
    if (currentRole === newRole) return
    if (userId === currentUser?.userId) {
      toast.show("Không thể tự đổi quyền của mình", "warn" as any)
      return
    }
    const labelMap: Record<string, string> = { SUPER_ADMIN: "Super Admin", ADMIN: "Admin", USER: "User" }
    const ok = await ask(`Đổi quyền user này từ ${labelMap[currentRole]} → ${labelMap[newRole]}?`, { title: "Xác nhận đổi quyền" })
    if (!ok) return
    // Optimistic
    setData((d:any) => d ? { ...d, users: d.users.map((u:any) => u.id === userId ? { ...u, role: newRole } : u) } : d)
    setPendingIds(s => new Set(s).add(userId))
    try {
      const r = await fetch(`/api/users/${userId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: newRole }) })
      if (!r.ok) throw new Error((await r.json()).error || "Lỗi")
      toast.show(`✓ Đã đổi quyền: ${labelMap[newRole]}`, "success" as any)
    } catch (e:any) {
      // Rollback
      setData((d:any) => d ? { ...d, users: d.users.map((u:any) => u.id === userId ? { ...u, role: currentRole } : u) } : d)
      toast.show("Lỗi: " + e.message, "error" as any)
    } finally {
      setPendingIds(s => { const n = new Set(s); n.delete(userId); return n })
    }
  }

  async function deleteUser(userId: string) {
    if (!isSuperAdmin || pendingIds.has(userId)) return
    if (!await ask("Xoá user này?", { title: "Xác nhận xoá user", danger: true })) return
    // Optimistic: ẩn khỏi list
    const oldUsers = data?.users
    setData((d:any) => d ? { ...d, users: d.users.filter((u:any) => u.id !== userId) } : d)
    setPendingIds(s => new Set(s).add(userId))
    try {
      const r = await fetch(`/api/users/${userId}`, { method: "DELETE" })
      if (!r.ok) throw new Error((await r.json()).error || "Lỗi")
    } catch (e:any) {
      setData((d:any) => d ? { ...d, users: oldUsers } : d)
      toast.show("Lỗi: " + e.message, "error" as any)
    } finally {
      setPendingIds(s => { const n = new Set(s); n.delete(userId); return n })
    }
  }

  const filtered = data?.users?.filter((u: any) =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  ) || []

  const inp = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", outline: "none", height: 34, width: "100%", boxSizing: "border-box" } as React.CSSProperties
  const lbl = { fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }
  const TH = { padding: "8px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const }
  const THR = { ...TH, textAlign: "right" as const }
  const TD = { padding: "10px 12px", borderBottom: "1px solid var(--border)", verticalAlign: "middle" as const, fontSize: 12 }
  const TDR = { ...TD, textAlign: "right" as const }

  return (
    <AppLayout>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Quan ly Nguoi dung</div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>Tong quan he thong - Admin only</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => { try { localStorage.removeItem("admin_overview_cache") } catch {}; fetchOverview() }} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 30 }}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 8A6 6 0 112 8"/><path d="M11 5l3 3-3 3"/></svg>
            Refresh
          </button>
          {isSuperAdmin && (
            <button onClick={runDbCleanup} disabled={cleaningDb} title="Xoá data cũ để giữ DB gọn (auto chạy mỗi Chủ nhật 3h sáng)" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: cleaningDb ? "wait" : "pointer", border: "1px solid rgba(245,166,35,.4)", background: "rgba(245,166,35,.1)", color: "var(--warn)", fontFamily: "inherit", height: 30, opacity: cleaningDb ? 0.6 : 1 }}>
              {cleaningDb ? "⏳ Đang dọn..." : "🧹 Dọn dẹp DB"}
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowAddUser(true)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 30 }}>
              + Them nguoi dung
            </button>
          )}
        </div>
      </div>

      {/* System totals */}
      {data?.totals && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 10 }}>
          {[
            ["Tong Users", data.totals.totalUsers, "var(--accent)"],
            ["Co Token", data.totals.usersWithToken, "var(--success)"],
          ].map(([l,v,c]) => (
            <div key={l as string} style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{l}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: c as string, marginTop: 4 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* User table */}
      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ position: "relative" as const, flex: 1, maxWidth: 280 }}>
            <svg style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" as const }} width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4"/><path d="M11 11l3 3"/></svg>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Tim kiem..." style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 11, fontFamily: "inherit", padding: "5px 8px 5px 24px", outline: "none", width: "100%", height: 28 }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: "auto" }}>{filtered.length} users</span>
        </div>
        <div style={{ overflowX: "auto" as const }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg3)" }}>
                <th style={{ ...TH, width: 32 }}>#</th>
                <th style={TH}>Nguoi dung</th>
                <th style={TH}>Role</th>
                <th style={TH}>Quyen truy cap</th>
                <th style={TH}>Token</th>
                <th style={THR}>Camps</th>
                <th style={THR}>Posts</th>
                <th style={TH}>Trang thai</th>
                <th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Dang tai...</td></tr>
              ) : filtered.map((u: any, i: number) => (
                <tr key={u.id}>
                  <td style={{ ...TD, color: "var(--muted)" }}>{i+1}</td>
                  <td style={TD}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: "50%", background: ac(u.name), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{ini(u.name)}</div>
                      <div>
                        <div style={{ fontWeight: 500 }}>{u.name}</div>
                        <div style={{ fontSize: 10, color: "var(--muted)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td style={TD}>
                    {isSuperAdmin && u.id !== currentUser?.userId ? (
                      <select
                        value={u.role}
                        disabled={pendingIds.has(u.id)}
                        onChange={e => changeRole(u.id, u.role, e.target.value)}
                        title="Đổi quyền user"
                        style={{
                          fontSize: 10, fontWeight: 600, padding: "2px 22px 2px 8px", borderRadius: 20,
                          background: u.role==="SUPER_ADMIN" ? "rgba(232,77,45,.1)" : u.role==="ADMIN" ? "rgba(245,166,35,.1)" : "var(--pill-bg)",
                          color: u.role==="SUPER_ADMIN" ? "var(--danger)" : u.role==="ADMIN" ? "var(--warn)" : "var(--pill-text)",
                          border: "1px solid transparent", outline: "none", fontFamily: "inherit",
                          cursor: pendingIds.has(u.id) ? "wait" : "pointer",
                          appearance: "none" as const, WebkitAppearance: "none" as const, MozAppearance: "none" as const,
                          backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 16 16'><path fill='%23999' d='M8 11L3 6h10z'/></svg>\")",
                          backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center"
                        }}
                      >
                        <option value="USER">USER</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SUPER_ADMIN">SUPER_ADMIN</option>
                      </select>
                    ) : (
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: u.role==="SUPER_ADMIN"?"rgba(232,77,45,.1)":u.role==="ADMIN"?"rgba(245,166,35,.1)":"var(--pill-bg)", color: u.role==="SUPER_ADMIN"?"var(--danger)":u.role==="ADMIN"?"var(--warn)":"var(--pill-text)", fontWeight: 600 }}>{u.role}</span>
                    )}
                  </td>
                  <td style={TD}>
                    {u.role === "SUPER_ADMIN" ? (
                      <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: "rgba(232,77,45,.1)", color: "var(--danger)", fontWeight: 500 }}>Toàn quyền</span>
                    ) : (() => {
                      // Resolve permissions: ưu tiên field mới, fallback userType cũ.
                      let perms: string[] = []
                      if (u.permissions) {
                        try { const p = JSON.parse(u.permissions); if (Array.isArray(p)) perms = p } catch {}
                      }
                      if (perms.length === 0 && u.userType) {
                        const legacy: Record<string, string[]> = { accountant: ["chi-phi-van-phong"] }
                        perms = legacy[u.userType] || []
                      }
                      const isFull = !u.permissions && !u.userType
                      return (
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
                          {isFull ? (
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: "rgba(245,166,35,.1)", color: "var(--warn)", fontWeight: 500 }}>Toàn quyền (legacy)</span>
                          ) : perms.length === 0 ? (
                            <span style={{ fontSize: 10, color: "var(--muted)" }}>Chưa có quyền</span>
                          ) : (
                            <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 12, background: "rgba(79,126,248,.1)", color: "var(--pill-text)", fontWeight: 500 }} title={perms.map(k => MENU_PERMISSIONS.find(m => m.key === k)?.label || k).join(", ")}>{perms.length} quyền</span>
                          )}
                          {isAdmin && u.id !== currentUser?.userId && (
                            <button onClick={() => setEditPerms({ userId: u.id, perms: perms.length > 0 ? [...perms] : (isFull ? [...MENU_KEYS] : []) })} style={{ padding: "1px 6px", borderRadius: 3, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>Sửa</button>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                  <td style={TD}>
                    {u.stats.hasToken
                      ? <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(46,204,143,.1)", color: "var(--success)", border: "1px solid rgba(46,204,143,.2)" }}>
                          Co token{u.stats.tokenExpiry ? ` · HH: ${new Date(u.stats.tokenExpiry).toLocaleDateString("vi-VN")}` : ""}
                        </span>
                      : <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: "rgba(255,255,255,.05)", color: "var(--muted)" }}>Chua co</span>
                    }
                  </td>
                  <td style={TDR}>{u.stats.activeCamps}/{u.stats.campaigns}</td>
                  <td style={TDR}>{u.stats.posts}</td>
                  <td style={TD}>
                    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 20, background: u.status==="ACTIVE"?"rgba(46,204,143,.1)":"rgba(232,77,45,.08)", color: u.status==="ACTIVE"?"var(--success)":"var(--danger)" }}>{u.status}</span>
                  </td>
                  <td style={TD}>
                    {isAdmin && u.id !== currentUser?.userId ? (
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => toggleLock(u.id, u.status)} disabled={pendingIds.has(u.id)} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: pendingIds.has(u.id)?"not-allowed":"pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", opacity: pendingIds.has(u.id)?0.5:1 }}>
                          {pendingIds.has(u.id) ? "..." : (u.status === "ACTIVE" ? "Khoa" : "Mo")}
                        </button>
                        <button onClick={() => deleteUser(u.id)} disabled={pendingIds.has(u.id)} style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, cursor: pendingIds.has(u.id)?"not-allowed":"pointer", border: "1px solid rgba(232,77,45,.2)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit", opacity: pendingIds.has(u.id)?0.5:1 }}>Xoa</button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 10, color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showAddUser && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 440, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => { setShowAddUser(false); setAddMsg(null) }} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Them nguoi dung moi</div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Ho va ten *</label><input value={newUser.name} onChange={e => setNewUser(u => ({ ...u, name: e.target.value }))} placeholder="Nguyen Van A" style={inp} /></div>
              <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Email *</label><input type="email" value={newUser.email} onChange={e => setNewUser(u => ({ ...u, email: e.target.value }))} placeholder="email@example.com" style={inp} /></div>
              <div><label style={lbl}>Mat khau *</label><input type="password" value={newUser.password} onChange={e => setNewUser(u => ({ ...u, password: e.target.value }))} placeholder="••••••••" style={inp} /></div>
              <div><label style={lbl}>Role</label>
                <select value={newUser.role} onChange={e => setNewUser(u => ({ ...u, role: e.target.value }))} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", height: 34, width: "100%", outline: "none" }}>
                  <option value="USER">User</option>
                  {isSuperAdmin && <option value="ADMIN">Admin</option>}
                </select>
              </div>
              {newUser.role !== "SUPER_ADMIN" && (
                <div style={{ gridColumn: "1/-1" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <label style={{ ...lbl, marginBottom: 0 }}>Quyền truy cập * <span style={{ fontSize: 9, color: "var(--muted)", fontWeight: 400 }}>(chỉ gán được quyền bạn đang có)</span></label>
                    <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                      <span onClick={() => setNewUser(u => ({ ...u, permissions: [...grantablePerms] }))} style={{ cursor: "pointer", color: "var(--accent)" }}>Tất cả</span>
                      <span onClick={() => setNewUser(u => ({ ...u, permissions: [] }))} style={{ cursor: "pointer", color: "var(--accent)" }}>Bỏ chọn</span>
                    </div>
                  </div>
                  <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, padding: "8px 10px", maxHeight: 220, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 4 }}>
                    {(["main", "manage", "finance"] as const).map(group => {
                      const items = grantableMenus.filter(m => m.group === group)
                      if (items.length === 0) return null
                      const groupLabel = group === "main" ? "Chính" : group === "manage" ? "Quản lý" : "Tài chính"
                      return (
                        <div key={group}>
                          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", padding: "4px 0 2px" }}>{groupLabel}</div>
                          {items.map(m => {
                            const checked = newUser.permissions.includes(m.key)
                            return (
                              <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", borderRadius: 4, cursor: "pointer", background: checked ? "rgba(79,126,248,.08)" : "transparent", fontSize: 12 }}>
                                <input type="checkbox" checked={checked} onChange={e => setNewUser(u => ({ ...u, permissions: e.target.checked ? [...u.permissions, m.key] : u.permissions.filter(k => k !== m.key) }))} style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                                <span>{m.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 4 }}>Đã chọn: <strong style={{ color: "var(--text)" }}>{newUser.permissions.length}</strong> / {grantablePerms.length} quyền</div>
                </div>
              )}
            </div>
            {addMsg && <div style={{ background: addMsg.type==="success"?"rgba(46,204,143,.08)":"rgba(232,77,45,.08)", border: `1px solid ${addMsg.type==="success"?"rgba(46,204,143,.2)":"rgba(232,77,45,.2)"}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, color: addMsg.type==="success"?"var(--success)":"var(--danger)" }}>{addMsg.text}</div>}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => { setShowAddUser(false); setAddMsg(null) }} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huy</button>
              <button onClick={addUser} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 32 }}>Tao tai khoan</button>
            </div>
          </div>
        </div>
      )}
      {editPerms && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 440, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => setEditPerms(null)} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Sửa quyền truy cập</div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Tích các menu user được phép vào {!isSuperAdmin && <span style={{ color: "var(--warn)" }}>(chỉ gán được quyền bạn có)</span>}</div>
              <div style={{ display: "flex", gap: 8, fontSize: 10 }}>
                <span onClick={() => setEditPerms(p => p ? { ...p, perms: [...grantablePerms] } : p)} style={{ cursor: "pointer", color: "var(--accent)" }}>Tất cả</span>
                <span onClick={() => setEditPerms(p => p ? { ...p, perms: [] } : p)} style={{ cursor: "pointer", color: "var(--accent)" }}>Bỏ chọn</span>
              </div>
            </div>
            <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, padding: "8px 10px", maxHeight: 320, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 4 }}>
              {(["main", "manage", "finance"] as const).map(group => {
                const items = grantableMenus.filter(m => m.group === group)
                if (items.length === 0) return null
                const groupLabel = group === "main" ? "Chính" : group === "manage" ? "Quản lý" : "Tài chính"
                return (
                  <div key={group}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", padding: "4px 0 2px" }}>{groupLabel}</div>
                    {items.map(m => {
                      const checked = editPerms.perms.includes(m.key)
                      return (
                        <label key={m.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 4px", borderRadius: 4, cursor: "pointer", background: checked ? "rgba(79,126,248,.08)" : "transparent", fontSize: 12 }}>
                          <input type="checkbox" checked={checked} onChange={e => setEditPerms(p => p ? { ...p, perms: e.target.checked ? [...p.perms, m.key] : p.perms.filter(k => k !== m.key) } : p)} style={{ width: 14, height: 14, accentColor: "var(--accent)", cursor: "pointer" }} />
                          <span>{m.label}</span>
                        </label>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>Đã chọn: <strong style={{ color: "var(--text)" }}>{editPerms.perms.length}</strong> / {grantablePerms.length} quyền · <span style={{ color: "var(--warn)" }}>User sẽ bị tự động đăng xuất khi lưu</span></div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditPerms(null)} disabled={savingPerms} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: savingPerms ? "not-allowed" : "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huỷ</button>
              <button onClick={savePerms} disabled={savingPerms} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: savingPerms ? "not-allowed" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 32, opacity: savingPerms ? 0.6 : 1 }}>{savingPerms ? "Đang lưu..." : "Lưu thay đổi"}</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}