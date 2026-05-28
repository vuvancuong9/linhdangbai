"use client"
import { createContext, useContext, useState, useCallback, ReactNode } from "react"

type ToastType = "success" | "error" | "info" | "warn"
type Toast = { id: number; type: ToastType; msg: string }

const ToastCtx = createContext<{ show: (msg: string, type?: ToastType, durationMs?: number) => void } | null>(null)

let _id = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((msg: string, type: ToastType = "info", durationMs?: number) => {
    const id = ++_id
    // Error toasts có thể chứa multi-line detail → cần thời gian đọc lâu hơn.
    const defaultMs = type === "error" ? 7000 : 3500
    const finalMs = typeof durationMs === "number" ? durationMs : defaultMs
    setToasts((t) => [...t, { id, type, msg }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), finalMs)
  }, [])

  return (
    <ToastCtx.Provider value={{ show }}>
      {children}
      <div style={{ position: "fixed", top: 60, right: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        {toasts.map((t) => {
          const map: Record<ToastType, { bg: string; bd: string; col: string; icon: string }> = {
            success: { bg: "rgba(46,204,143,.12)", bd: "rgba(46,204,143,.4)", col: "var(--success)", icon: "✓" },
            error:   { bg: "rgba(232,77,45,.12)",  bd: "rgba(232,77,45,.4)",  col: "var(--danger)",  icon: "⚠" },
            info:    { bg: "rgba(79,126,248,.12)", bd: "rgba(79,126,248,.4)", col: "var(--accent)",  icon: "ℹ" },
            warn:    { bg: "rgba(245,166,35,.12)", bd: "rgba(245,166,35,.4)", col: "var(--warn)",    icon: "⚡" },
          }
          const s = map[t.type]
          return (
            <div key={t.id} style={{ minWidth: 240, maxWidth: 360, padding: "10px 14px", borderRadius: 8, background: s.bg, border: `1px solid ${s.bd}`, color: s.col, fontSize: 12, fontWeight: 500, boxShadow: "0 4px 12px rgba(0,0,0,.2)", display: "flex", alignItems: "flex-start", gap: 8, pointerEvents: "auto", animation: "slideIn .2s ease" }}>
              <span style={{ fontSize: 14, lineHeight: 1 }}>{s.icon}</span>
              <span style={{ flex: 1, lineHeight: 1.4, whiteSpace: "pre-line", wordBreak: "break-word" }}>{t.msg}</span>
            </div>
          )
        })}
      </div>
      <style jsx global>{`
        @keyframes slideIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
      `}</style>
    </ToastCtx.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastCtx)
  if (!ctx) {
    // Fallback: nếu chưa wrap Provider thì dùng alert tạm.
    return { show: (msg: string) => { if (typeof window !== "undefined") alert(msg) } }
  }
  return ctx
}
