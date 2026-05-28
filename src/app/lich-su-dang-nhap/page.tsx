"use client"
import { useEffect, useState } from "react"
import AppLayout from "@/components/layout/AppLayout"

interface Session {
  id: string
  ipAddress: string | null
  userAgent: string | null
  device: { browser: string; os: string }
  createdAt: string
  lastSeenAt: string
  revokedAt: string | null
  isCurrent: boolean
}

function fmtDate(d: string) {
  return new Date(d).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function LichSuDangNhapPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch("/api/auth/sessions")
      const d = await r.json()
      if (d.success) setSessions(d.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function revoke(id: string) {
    if (revoking) return
    setRevoking(id)
    setMsg(null)
    try {
      const r = await fetch(`/api/auth/sessions/${id}`, { method: "DELETE" })
      const d = await r.json()
      if (d.success) {
        setMsg({ text: "Đã đăng xuất thiết bị này", ok: true })
        setSessions(prev => prev.map(s => s.id === id ? { ...s, revokedAt: new Date().toISOString() } : s))
      } else {
        setMsg({ text: d.message || "Lỗi", ok: false })
      }
    } catch {
      setMsg({ text: "Lỗi kết nối", ok: false })
    } finally {
      setRevoking(null)
    }
  }

  const active = sessions.filter(s => !s.revokedAt)
  const revoked = sessions.filter(s => s.revokedAt)

  return (
    <AppLayout>
      <div style={{ maxWidth: 700 }}>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Lịch sử đăng nhập</div>
          <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Quản lý các thiết bị đang đăng nhập. Đăng xuất khỏi thiết bị không dùng nữa để bảo mật tài khoản.</div>
        </div>

        {msg && (
          <div style={{ padding: "9px 12px", borderRadius: 6, marginBottom: 14, background: msg.ok ? "rgba(46,204,143,.08)" : "rgba(232,77,45,.08)", border: `1px solid ${msg.ok ? "rgba(46,204,143,.25)" : "rgba(232,77,45,.25)"}`, color: msg.ok ? "var(--success)" : "var(--danger)", fontSize: 12 }}>
            {msg.text}
          </div>
        )}

        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>Đang tải...</div>
        ) : sessions.length === 0 ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
            Chưa có lịch sử đăng nhập.<br />
            <span style={{ fontSize: 11 }}>Đăng xuất và login lại để tạo session đầu tiên.</span>
          </div>
        ) : (
          <>
            {/* Active sessions */}
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>
              Đang hoạt động ({active.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: revoked.length > 0 ? 20 : 0 }}>
              {active.map(s => (
                <SessionRow key={s.id} session={s} onRevoke={revoke} revoking={revoking} />
              ))}
              {active.length === 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", padding: "10px 0" }}>Không có session đang hoạt động</div>
              )}
            </div>

            {/* Revoked sessions */}
            {revoked.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 8 }}>
                  Đã đăng xuất ({revoked.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {revoked.map(s => (
                    <SessionRow key={s.id} session={s} onRevoke={revoke} revoking={revoking} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </AppLayout>
  )
}

function SessionRow({ session: s, onRevoke, revoking }: { session: Session; onRevoke: (id: string) => void; revoking: string | null }) {
  const isRevoked = !!s.revokedAt
  const isLoading = revoking === s.id

  const osIcon = () => {
    if (s.device.os === "Windows") return "🖥️"
    if (s.device.os === "macOS") return "🍎"
    if (s.device.os === "Android") return "📱"
    if (s.device.os === "iOS") return "📱"
    return "💻"
  }

  return (
    <div style={{ background: "var(--bg2)", border: `1px solid ${s.isCurrent ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, opacity: isRevoked ? 0.5 : 1 }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{osIcon()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" as const }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{s.device.browser} trên {s.device.os}</span>
          {s.isCurrent && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, background: "rgba(79,126,248,.12)", color: "var(--accent)", fontWeight: 600 }}>Thiết bị này</span>
          )}
          {isRevoked && (
            <span style={{ fontSize: 10, padding: "1px 7px", borderRadius: 10, background: "rgba(150,150,150,.1)", color: "var(--muted)" }}>Đã đăng xuất</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" as const }}>
          {s.ipAddress && <span>IP: {s.ipAddress}</span>}
          <span>Đăng nhập: {fmtDate(s.createdAt)}</span>
          {isRevoked && s.revokedAt && <span>Đăng xuất: {fmtDate(s.revokedAt)}</span>}
        </div>
      </div>
      {!isRevoked && !s.isCurrent && (
        <button
          onClick={() => onRevoke(s.id)}
          disabled={!!revoking}
          style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: revoking ? "wait" : "pointer", border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)", fontFamily: "inherit", flexShrink: 0, opacity: revoking ? 0.5 : 1 }}
        >
          {isLoading ? "..." : "Đăng xuất"}
        </button>
      )}
      {!isRevoked && s.isCurrent && (
        <span style={{ fontSize: 10, color: "var(--success)", flexShrink: 0 }}>✓ Đang dùng</span>
      )}
    </div>
  )
}
