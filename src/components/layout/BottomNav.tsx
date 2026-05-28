"use client"
// Bottom navigation cho mobile (<700px). Cố định đáy màn hình, 5 mục.
// Mục "More" mở drawer side để truy cập menu phụ (Billing card, Office expense, etc.).
//
// Active item dựa vào pathname hiện tại. Item highlight = accent color.
import { usePathname, useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import type { JWTPayload } from "@/lib/auth"

type NavItem = {
  key: string
  label: string
  href?: string
  icon: React.ReactNode
  permission?: string  // menu key trong permissions
}

// Mobile chỉ giữ 2 mục chính: Dashboard + Billing.
// Menu phụ vẫn truy cập được qua nút hamburger (☰) ở top bar trái.
const ITEMS: NavItem[] = [
  {
    key: "dashboard", label: "Dashboard", href: "/dashboard", permission: "dashboard",
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></svg>,
  },
  {
    key: "billing", label: "Billing", href: "/billing", permission: "billing",
    icon: <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>,
  },
]

export default function BottomNav({ user }: { user: JWTPayload | null }) {
  const pathname = usePathname()
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  // Parse permissions để filter item.
  let userPerms: string[] | null = null
  if (user?.role !== "SUPER_ADMIN") {
    if (user?.permissions) {
      try { const p = JSON.parse(user.permissions); if (Array.isArray(p)) userPerms = p } catch {}
    }
  }
  const can = (key?: string) => !key || userPerms === null || userPerms.includes(key)
  const items = ITEMS.filter(it => can(it.permission))

  return (
    <nav
      role="navigation"
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        background: "var(--bg2)",
        borderTop: "1px solid var(--border)",
        padding: "8px 0",
        paddingBottom: "max(8px, env(safe-area-inset-bottom))",
        display: "flex", justifyContent: "space-around",
        zIndex: 90,
        boxShadow: "0 -2px 12px rgba(0,0,0,.04)",
      }}
    >
      {items.map(item => {
        const active = item.href ? pathname === item.href : false
        return (
          <button key={item.key}
            onClick={() => { if (item.href) router.push(item.href) }}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              padding: "6px 4px", border: "none", background: "transparent",
              color: active ? "var(--accent)" : "var(--muted)",
              cursor: "pointer", fontFamily: "inherit",
            }}>
            {item.icon}
            <span style={{ fontSize: 10, fontWeight: 600 }}>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
