"use client"
import { createContext, useCallback, useContext, useState, ReactNode } from "react"

type ConfirmOptions = {
  title?: string
  okText?: string
  cancelText?: string
  danger?: boolean // tô đỏ nút OK (xoá / nguy hiểm)
  warn?: boolean // tô vàng (cảnh báo)
}
type ConfirmState = {
  open: boolean
  message: string
  options: ConfirmOptions
  resolve: ((v: boolean) => void) | null
}

const ConfirmCtx = createContext<{ ask: (msg: string, opts?: ConfirmOptions) => Promise<boolean> } | null>(null)

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState>({ open: false, message: "", options: {}, resolve: null })

  const ask = useCallback((message: string, options: ConfirmOptions = {}) => {
    return new Promise<boolean>((resolve) => {
      setState({ open: true, message, options, resolve })
    })
  }, [])

  function close(answer: boolean) {
    state.resolve?.(answer)
    setState((s) => ({ ...s, open: false, resolve: null }))
  }

  const danger = !!state.options.danger
  const warn = !!state.options.warn
  const accentColor = danger ? "var(--danger)" : warn ? "var(--warn)" : "var(--accent)"
  const accentBg = danger ? "rgba(232,77,45,.12)" : warn ? "rgba(245,166,35,.12)" : "rgba(79,126,248,.12)"
  const icon = danger ? "⚠" : warn ? "⚡" : "ℹ"

  return (
    <ConfirmCtx.Provider value={{ ask }}>
      {children}
      {state.open && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) close(false) }}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 10000,
            display: "flex", alignItems: "center", justifyContent: "center",
            backdropFilter: "blur(4px)", padding: 12,
            animation: "confirmFadeIn .15s ease",
          }}
        >
          <div
            style={{
              background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12,
              width: 420, maxWidth: "100%", padding: 20,
              display: "flex", flexDirection: "column", gap: 14,
              boxShadow: "0 20px 60px rgba(0,0,0,.5)",
              animation: "confirmSlideIn .2s ease",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10, background: accentBg,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18, color: accentColor, flexShrink: 0,
              }}>
                {icon}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                {state.options.title && (
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>
                    {state.options.title}
                  </div>
                )}
                <div style={{ fontSize: 12.5, color: "var(--text)", lineHeight: 1.5, whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const }}>
                  {state.message}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button
                onClick={() => close(false)}
                autoFocus
                style={{
                  padding: "8px 16px", borderRadius: 6, fontSize: 12.5,
                  cursor: "pointer", border: "1px solid var(--border)",
                  background: "transparent", color: "var(--muted)",
                  fontFamily: "inherit", minWidth: 80,
                }}
              >
                {state.options.cancelText || "Huỷ"}
              </button>
              <button
                onClick={() => close(true)}
                style={{
                  padding: "8px 18px", borderRadius: 6, fontSize: 12.5,
                  cursor: "pointer", border: "none",
                  background: accentColor, color: "#fff",
                  fontFamily: "inherit", fontWeight: 600, minWidth: 90,
                }}
              >
                {state.options.okText || (danger ? "Xoá" : "OK")}
              </button>
            </div>
          </div>
          <style jsx global>{`
            @keyframes confirmFadeIn { from { opacity: 0 } to { opacity: 1 } }
            @keyframes confirmSlideIn { from { opacity: 0; transform: translateY(-8px) scale(.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
          `}</style>
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) {
    // Fallback: native confirm nếu chưa wrap Provider
    return { ask: async (msg: string) => typeof window !== "undefined" && window.confirm(msg) }
  }
  return ctx
}
