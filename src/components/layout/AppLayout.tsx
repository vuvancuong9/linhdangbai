"use client"
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { useAuthStore } from "@/store/auth"
import BottomNav from "./BottomNav"
import { useIsMobile } from "@/hooks/useIsMobile"

const COLORS = ['#4f7ef8','#2ecc8f','#f5a623','#e84d4d','#9b59b6','#1abc9c','#e67e22','#3498db']
const avatarColor = (n: string) => { let h = 0; for (const c of n) h = (h + c.charCodeAt(0)) % COLORS.length; return COLORS[h] }
const initials = (n: string) => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  const pathname = usePathname()
  const isMobile = useIsMobile()
  const [mounted, setMounted] = useState(false)
  const [showPwModal, setShowPwModal] = useState(false)
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" })
  const [pwState, setPwState] = useState<{ loading: boolean; msg: string; ok: boolean }>({ loading: false, msg: "", ok: false })
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [theme, setTheme] = useState<"dark" | "light">("light")

  // Auto theme theo giờ VN (UTC+7, không DST):
  //   06:00 → 18:59 = light | 19:00 → 05:59 = dark
  // Tính qua getUTCHours để không phụ thuộc timezone máy user.
  function computeVNTheme(): "light" | "dark" {
    const h = (new Date().getUTCHours() + 7) % 24
    return h >= 6 && h < 19 ? "light" : "dark"
  }
  function applyTheme(t: "light" | "dark") {
    setTheme(t)
    try {
      document.documentElement.setAttribute("data-theme", t)
      const m = document.querySelector('meta[name="theme-color"]')
      if (m) m.setAttribute("content", t === "light" ? "#eef0f5" : "#0f1117")
    } catch {}
  }

  useEffect(() => {
    setMounted(true)
    // Migrate khỏi localStorage cũ (manual) → giờ chỉ auto.
    try { localStorage.removeItem("theme") } catch {}
    // Tính ngay khi mount → tránh flash sai theme.
    applyTheme(computeVNTheme())
    // Align lần check tiếp theo vào giây 00 của phút kế (vd 6:00:00 sharp).
    // setInterval thuần 60_000 chạy lệch theo lúc load → lag tối đa 59s qua boundary.
    let intervalId: ReturnType<typeof setInterval> | null = null
    const timeoutId = setTimeout(() => {
      applyTheme(computeVNTheme())
      intervalId = setInterval(() => applyTheme(computeVNTheme()), 60_000)
    }, 60_000 - (Date.now() % 60_000))
    const onVis = () => { if (!document.hidden) applyTheme(computeVNTheme()) }
    document.addEventListener("visibilitychange", onVis)
    return () => {
      clearTimeout(timeoutId)
      if (intervalId) clearInterval(intervalId)
      document.removeEventListener("visibilitychange", onVis)
    }
  }, [])
  // Đóng drawer khi route đổi
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  async function submitChangePassword() {
    if (pwState.loading) return
    setPwState({ loading: true, msg: "", ok: false })
    try {
      if (pwForm.next !== pwForm.confirm) throw new Error("Mật khẩu mới và xác nhận không khớp")
      if (pwForm.next.length < 6) throw new Error("Mật khẩu mới phải tối thiểu 6 ký tự")
      const r = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.next }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || "Lỗi")
      setPwState({ loading: false, msg: "✅ Đã đổi mật khẩu. Đang đăng xuất...", ok: true })
      setTimeout(async () => {
        await fetch("/api/auth/logout", { method: "POST" })
        window.location.href = "/login"
      }, 1500)
    } catch (e: any) {
      setPwState({ loading: false, msg: "❌ " + (e?.message || "Lỗi"), ok: false })
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.href = "/login"
  }

  if (!mounted) return null

  const name = user?.name || "User"
  const avColor = avatarColor(name)
  const avInit = initials(name)
  const isAdmin = user?.role === "ADMIN" || user?.role === "SUPER_ADMIN"
  const isSuperAdmin = user?.role === "SUPER_ADMIN"
  // Resolve permissions: ưu tiên field mới, fallback userType cũ.
  // CHỈ SUPER_ADMIN bypass — ADMIN con + USER đều có thể bị giới hạn theo permissions.
  // Permissions null/undefined = legacy → full access (backward compat).
  let userPerms: string[] | null = null
  if (user?.role !== "SUPER_ADMIN") {
    if (user?.permissions) {
      try { const p = JSON.parse(user.permissions); if (Array.isArray(p)) userPerms = p } catch {}
    }
    if (!userPerms && user?.userType) {
      const legacy: Record<string, string[]> = { accountant: ["chi-phi-van-phong"] }
      userPerms = legacy[user.userType] || null
    }
  }
  const isLimited = user?.role !== "SUPER_ADMIN" && userPerms !== null
  const can = (key: string) => !isLimited || (userPerms?.includes(key) ?? false)

  const canSeeKeoAds        = can("keo-ads")
  const canSeeFanpagePosts  = can("fanpage-posts")
  const canSeeNghiemThu     = can("nghiem-thu")
  const canSeeDashboard     = can("dashboard")
  const canSeeInsights      = can("insights")
  const canSeeTrinhQuanLy   = can("trinh-quan-ly")
  const canSeeQuanLyCamp    = can("quan-ly-campaign")
  const canSeeLaiLoCamp     = can("lai-lo-camp")
  const canSeeCampKoCan     = can("camp-khong-can-tien")
  const canSeeGioiHanQC     = can("gioi-han-quang-cao")
  const canSeeChiTieuPage   = can("chi-tieu-fanpage")
  const canSeeNhomTK        = can("nhom-tai-khoan")
  const canSeeBilling       = can("billing")
  const canSeeInvoices      = can("invoices")
  const canSeeOfficeExpense = can("chi-phi-van-phong")
  const canSeeAdmin         = isAdmin
  const canSeeMainSection   = canSeeKeoAds || canSeeFanpagePosts || canSeeNghiemThu
  const canSeeManageSection = canSeeDashboard || canSeeInsights || canSeeTrinhQuanLy || canSeeQuanLyCamp || canSeeLaiLoCamp || canSeeCampKoCan || canSeeGioiHanQC || canSeeChiTieuPage || canSeeNhomTK || canSeeBilling || canSeeInvoices

  const nav: any[] = []
  if (canSeeKeoAds) nav.push({ id: "keo-ads", label: "Keo Ads", href: "/keo-ads", icon: <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 1a6 6 0 100 12A6 6 0 008 1z"/></svg> })
  if (canSeeFanpagePosts) nav.push({ id: "fanpage-posts", label: "Fanpage Posts", href: "/fanpage-posts", icon: <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2 2h12v1l-5 5v6l-2-1V8L2 3z"/></svg> })
  if (canSeeNghiemThu) nav.push({ id: "nghiem-thu", label: "Nghiệm thu", href: "/nghiem-thu", icon: <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/><path d="M5 9l2 2 3-4"/></svg> })
  if (nav.length > 0) nav.push(null)

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontSize: 12 }}>
      {/* Topbar */}
      <div className="app-topbar" style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", padding: "0 18px", height: 48, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, position: "sticky" as const, top: 0, zIndex: 250 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Hamburger menu — ẨN trên mobile theo yêu cầu user (chỉ Dashboard + Billing).
              Giữ trên desktop (mặc dù sidebar đã hiện sẵn, không cần hamburger) — nhưng
              class mobile-only đã ẩn trên desktop sẵn. Ở đây bọc thêm !isMobile để
              ẩn HOÀN TOÀN trên mobile. */}
          {!isMobile && (
            <button
              className="mobile-only"
              onClick={() => setDrawerOpen(o => !o)}
              aria-label="Menu"
              style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, width: 34, height: 34, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {drawerOpen ? <><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></> : <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>}
              </svg>
            </button>
          )}
          <div style={{ width: 24, height: 24, background: "var(--accent)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg viewBox="0 0 16 16" width="12" height="12" fill="#fff"><path d="M8 1L14 4V12L8 15L2 12V4Z"/></svg>
          </div>
          <span className="topbar-title" style={{ fontSize: 13, fontWeight: 600 }}>FB <span style={{ color: "var(--accent)" }}>Ads Manager</span></span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 20, padding: "3px 10px 3px 4px", cursor: "pointer" }}>
            <div style={{ width: 24, height: 24, borderRadius: "50%", background: avColor, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{avInit}</div>
            <span className="topbar-name" style={{ fontSize: 11, fontWeight: 500 }}>{name.split(" ").pop()}</span>
            <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: isSuperAdmin ? "rgba(232,77,45,.15)" : isAdmin ? "rgba(245,166,35,.12)" : "var(--pill-bg)", color: isSuperAdmin ? "var(--danger)" : isAdmin ? "var(--warn)" : "var(--pill-text)" }}>{isSuperAdmin ? "Super" : isAdmin ? "Admin" : "User"}</span>
          </div>
          <div title={`Auto theo giờ VN: ${theme === "dark" ? "tối (19h-5h59)" : "sáng (6h-18h59)"}`} aria-label="Giao diện auto" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", cursor: "default" }}>
            {theme === "dark" ? (
              // Moon icon - đang dark
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            ) : (
              // Sun icon - đang light
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/></svg>
            )}
          </div>
          <a href="/lich-su-dang-nhap" className="topbar-btn" title="Lịch sử đăng nhập" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", height: 30, textDecoration: "none" }}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M8 5v3l2 1"/></svg>
            <span className="topbar-btn-text">Thiết bị</span>
          </a>
          <button className="topbar-btn" onClick={() => { setPwForm({ current: "", next: "", confirm: "" }); setPwState({ loading: false, msg: "", ok: false }); setShowPwModal(true) }} title="Đổi mật khẩu" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", height: 30 }}>🔑<span className="topbar-btn-text"> Đổi MK</span></button>
          <button className="topbar-btn" onClick={handleLogout} title="Đăng xuất" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", height: 30 }}>
            <span className="topbar-btn-text">Đăng xuất</span>
            <svg className="mobile-only" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3"/><polyline points="11 11 14 8 11 5"/><line x1="14" y1="8" x2="6" y2="8"/></svg>
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Mobile overlay khi drawer mở — KHÔNG render trên mobile (sidebar đã ẩn hoàn toàn) */}
        {!isMobile && drawerOpen && <div className="app-overlay mobile-only" onClick={() => setDrawerOpen(false)} />}

        {/* Sidebar — ẨN HOÀN TOÀN trên mobile theo yêu cầu user.
            Mobile chỉ có bottom nav 2 mục (Dashboard + Billing). */}
        {!isMobile && (
        <div className={`app-sidebar ${drawerOpen ? "open" : ""}`} style={{ width: 180, background: "var(--bg2)", borderRight: "1px solid var(--border)", padding: "12px 8px", flexShrink: 0, display: "flex", flexDirection: "column", gap: 1, position: "sticky" as const, top: 48, height: "calc(100vh - 48px)", overflowY: "auto" }}>
          {canSeeMainSection && (
            <>
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".8px", padding: "8px 8px 4px" }}>Chính</div>
              {nav.map((item, i) => {
                if (!item) return <div key={i} style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
                const active = pathname === item.href
                return (
                  <a key={item.id} href={item.href} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: active ? "var(--pill-text)" : "var(--muted)", fontSize: 13, fontWeight: active ? 600 : 400, background: active ? "var(--pill-bg)" : "transparent", userSelect: "none" as const }}>
                    {item.icon}{item.label}
                  </a>
                )
              })}
              <div style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
            </>
          )}
          {canSeeManageSection && (
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".8px", padding: "8px 8px 4px" }}>Quản lý</div>
          )}
          {canSeeDashboard && (
            <a href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/dashboard" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/dashboard" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/dashboard" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="5" height="6" rx="1"/><rect x="9" y="2" width="5" height="3" rx="1"/><rect x="2" y="10" width="5" height="4" rx="1"/><rect x="9" y="7" width="5" height="7" rx="1"/></svg>
              Dashboard
            </a>
          )}
          {canSeeInsights && (
            <a href="/insights" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/insights" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/insights" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/insights" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M2 14L6 9l3 3 5-7"/><circle cx="6" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="14" cy="5" r="1.2" fill="currentColor"/></svg>
              Insights
            </a>
          )}
          {canSeeTrinhQuanLy && (
            <a href="/trinh-quan-ly" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/trinh-quan-ly" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/trinh-quan-ly" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/trinh-quan-ly" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 6h12"/><path d="M6 6v8"/></svg>
              Trình quản lý
            </a>
          )}
          {canSeeQuanLyCamp && (
            <a href="/quan-ly-campaign" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/quan-ly-campaign" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/quan-ly-campaign" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75Zm0 4A.75.75 0 0 1 2.75 7h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 7.75Zm0 4a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5h-5.5a.75.75 0 0 1-.75-.75Z"/></svg>
              Quản lý Campaign
            </a>
          )}
          {canSeeLaiLoCamp && (
            <a href="/lai-lo-camp" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/lai-lo-camp" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/lai-lo-camp" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/lai-lo-camp" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 13l4-4 3 3 5-6"/><path d="M11 6h3v3"/></svg>
              Lãi/Lỗ Camp
            </a>
          )}
          {canSeeCampKoCan && (
            <a href="/camp-khong-can-tien" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/camp-khong-can-tien" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/camp-khong-can-tien" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/camp-khong-can-tien" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M5 10l3-3 3 3"/></svg>
              Camp không cắn tiền
            </a>
          )}
          {canSeeGioiHanQC && (
            <a href="/gioi-han-quang-cao" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/gioi-han-quang-cao" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/gioi-han-quang-cao" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/gioi-han-quang-cao" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12M2 8h12M2 12h8"/><path d="M12 12l3-3M12 12l-3-3" stroke="currentColor"/></svg>
              Giới hạn QC Page
            </a>
          )}
          {canSeeChiTieuPage && (
            <a href="/chi-tieu-fanpage" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/chi-tieu-fanpage" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/chi-tieu-fanpage" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/chi-tieu-fanpage" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 12V8m4 4V4m4 8v-6"/></svg>
              Chi tiêu Fanpage
            </a>
          )}
          {canSeeNhomTK && (
            <a href="/nhom-tai-khoan" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/nhom-tai-khoan" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/nhom-tai-khoan" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="3" width="5" height="5" rx="1"/><rect x="9" y="3" width="5" height="5" rx="1"/><rect x="2" y="10" width="5" height="3" rx="1"/><rect x="9" y="10" width="5" height="3" rx="1"/></svg>
              Nhóm tài khoản
            </a>
          )}
          {canSeeBilling && (
            <a href="/billing" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/billing" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/billing" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/billing" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="4" width="12" height="9" rx="1"/><path d="M2 7h12"/><path d="M5 11h2"/></svg>
              Billing FB
            </a>
          )}
          {canSeeInvoices && (
            <a href="/invoices" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/invoices" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/invoices" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/invoices" ? 600 : 400 }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 2h7l3 3v9H3z"/><path d="M10 2v3h3"/><path d="M5 8h6M5 10h6M5 12h4"/></svg>
              Invoices
            </a>
          )}
          {canSeeOfficeExpense && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
              <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".8px", padding: "8px 8px 4px" }}>Tài chính</div>
              <a href="/chi-phi-van-phong" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/chi-phi-van-phong" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/chi-phi-van-phong" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/chi-phi-van-phong" ? 600 : 400 }}>
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 4h12v8H2z"/><path d="M2 7h12"/><circle cx="11.5" cy="9.5" r=".75" fill="currentColor"/></svg>
                Chi phí văn phòng
              </a>
            </>
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
          <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".8px", padding: "8px 8px 4px" }}>Tài khoản</div>
          <a href="/lich-su-dang-nhap" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/lich-su-dang-nhap" ? "var(--pill-text)" : "var(--muted)", background: pathname === "/lich-su-dang-nhap" ? "var(--pill-bg)" : "transparent", textDecoration: "none", fontSize: 13, fontWeight: pathname === "/lich-su-dang-nhap" ? 600 : 400 }}>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M8 5v3l2 1"/></svg>
            Lịch sử đăng nhập
          </a>
          {canSeeAdmin && <>
            <div style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
            <div style={{ fontSize: 9, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".8px", padding: "8px 8px 4px" }}>Hệ thống</div>
            <a href="/admin" style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 10px", borderRadius: 6, color: pathname === "/admin" ? "var(--pill-text)" : "var(--muted)", fontSize: 13, fontWeight: pathname === "/admin" ? 600 : 400, background: pathname === "/admin" ? "var(--pill-bg)" : "transparent" }}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 1a4 4 0 100 8A4 4 0 008 1zM2 14a6 6 0 1112 0H2z"/></svg>
              Quản lý User
            </a>
          </>}
        </div>
        )}

        {/* Content */}
        <div className="app-content" style={{ flex: 1, padding: isMobile ? "12px 14px" : "18px 20px", paddingBottom: isMobile ? "calc(88px + env(safe-area-inset-bottom))" : 20, display: "flex", flexDirection: "column", gap: 14, background: "var(--bg)", minWidth: 0 }}>
          {children}
        </div>
      </div>

      {/* Bottom nav — chỉ mobile. Chỉ 2 mục Dashboard + Billing.
          Menu phụ truy cập qua nút hamburger ☰ ở top bar trái. */}
      {isMobile && <BottomNav user={user as any} />}

      {showPwModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", padding: 12 }}>
          <div className="app-modal" style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 400, padding: 22, display: "flex", flexDirection: "column" as const, gap: 12, position: "relative" as const }}>
            <button onClick={() => setShowPwModal(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", color: "var(--muted)", fontSize: 24, cursor: "pointer", lineHeight: 1, width: 32, height: 32 }}>×</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>🔑 Đổi mật khẩu</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Sau khi đổi, mày sẽ tự động đăng xuất và cần login lại.</div>
            <div style={{ height: 1, background: "var(--border)" }} />

            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>Mật khẩu hiện tại</label>
              <input type="password" value={pwForm.current} onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))} autoFocus style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 14, padding: "0 10px", height: 40, width: "100%", outline: "none", boxSizing: "border-box" } as React.CSSProperties} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>Mật khẩu mới (≥6 ký tự)</label>
              <input type="password" value={pwForm.next} onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 14, padding: "0 10px", height: 40, width: "100%", outline: "none", boxSizing: "border-box" } as React.CSSProperties} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }}>Xác nhận mật khẩu mới</label>
              <input type="password" value={pwForm.confirm} onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))} onKeyDown={e => { if (e.key === "Enter") submitChangePassword() }} style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 14, padding: "0 10px", height: 40, width: "100%", outline: "none", boxSizing: "border-box" } as React.CSSProperties} />
            </div>

            {pwState.msg && (
              <div style={{ padding: "8px 10px", borderRadius: 5, background: pwState.ok ? "rgba(46,204,143,.08)" : "rgba(232,77,45,.08)", border: `1px solid ${pwState.ok ? "rgba(46,204,143,.25)" : "rgba(232,77,45,.25)"}`, color: pwState.ok ? "var(--success)" : "var(--danger)", fontSize: 11 }}>{pwState.msg}</div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button onClick={() => setShowPwModal(false)} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", minHeight: 40 }}>Huỷ</button>
              <button onClick={submitChangePassword} disabled={pwState.loading || !pwForm.current || !pwForm.next || !pwForm.confirm} style={{ padding: "8px 18px", borderRadius: 6, fontSize: 13, cursor: pwState.loading ? "wait" : "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: (pwState.loading || !pwForm.current || !pwForm.next || !pwForm.confirm) ? 0.5 : 1, minHeight: 40 }}>{pwState.loading ? "Đang đổi..." : "Đổi mật khẩu"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
