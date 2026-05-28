"use client"
// Register service worker khi page load (chỉ chạy 1 lần ở client).
// Nên đặt trong Providers để chỉ mount 1 lần cho cả app.
import { useEffect } from "react"

export default function PWARegister() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    // Register sau khi page load để không block initial render.
    const reg = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" })
        .then((r) => {
          // Khi có version mới (sw.js đã đổi) → tự update sau 60s idle.
          if (r.waiting) r.waiting.postMessage({ type: "SKIP_WAITING" })
          r.addEventListener("updatefound", () => {
            const installing = r.installing
            if (!installing) return
            installing.addEventListener("statechange", () => {
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                // SW mới đã install xong → reload để áp dụng (nếu user OK).
                console.log("[PWA] New version available — reload to update")
              }
            })
          })
        })
        .catch((e) => console.warn("[PWA] SW register failed:", e?.message))
    }
    if (document.readyState === "complete") reg()
    else window.addEventListener("load", reg, { once: true })
  }, [])
  return null
}
