"use client"
// Nút "Bật/Tắt thông báo" + "Cài app" cho PWA.
// Tự ẩn nếu browser không hỗ trợ Push API.

import { useEffect, useState } from "react"
import { useToast } from "./Toast"

// Convert base64 URL-safe → Uint8Array (PushManager.subscribe yêu cầu applicationServerKey dạng này).
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(b64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export default function PushSubscribeButton() {
  const toast = useToast()
  const [supported, setSupported] = useState(false)
  const [subscribed, setSubscribed] = useState(false)
  const [busy, setBusy] = useState(false)
  // Install prompt (Android Chrome). iOS không support beforeinstallprompt — hiện hint thay thế.
  const [installEvent, setInstallEvent] = useState<any>(null)
  const [isIOS, setIsIOS] = useState(false)
  const [isStandalone, setIsStandalone] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    setSupported(ok)
    setIsIOS(/iPad|iPhone|iPod/.test(navigator.userAgent))
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true)
    if (!ok) return
    // Check current subscription state
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => setSubscribed(!!sub))
    }).catch(() => {})
    // Capture install prompt
    const onInstall = (e: any) => { e.preventDefault(); setInstallEvent(e) }
    window.addEventListener("beforeinstallprompt", onInstall)
    return () => window.removeEventListener("beforeinstallprompt", onInstall)
  }, [])

  async function subscribe() {
    if (busy) return
    setBusy(true)
    try {
      // Bước 1: Xin permission
      const perm = await Notification.requestPermission()
      if (perm !== "granted") {
        toast.show("⚠️ Anh đã từ chối quyền thông báo. Vào Settings trình duyệt để cấp lại.", "error" as any)
        return
      }
      // Bước 2: Lấy VAPID public key
      const r = await fetch("/api/push/public-key")
      const { publicKey } = await r.json()
      if (!publicKey) throw new Error("Server chưa cấu hình VAPID_PUBLIC_KEY")
      // Bước 3: Subscribe qua service worker
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // Cast tránh TS lỗi ArrayBufferLike vs ArrayBuffer trong Uint8Array
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
      // Bước 4: Gửi subscription lên server lưu
      const subJson = sub.toJSON() as any
      const saveRes = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: subJson.keys,
          userAgent: navigator.userAgent,
        }),
      })
      if (!saveRes.ok) throw new Error("Server lưu thất bại")
      setSubscribed(true)
      toast.show("✅ Đã bật thông báo. Anh sẽ nhận push khi có cảnh báo billing.", "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Bật thông báo thất bại"), "error" as any)
    } finally { setBusy(false) }
  }

  async function unsubscribe() {
    if (busy) return
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        })
        await sub.unsubscribe()
      }
      setSubscribed(false)
      toast.show("✓ Đã tắt thông báo", "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Tắt thất bại"), "error" as any)
    } finally { setBusy(false) }
  }

  async function testPush() {
    setBusy(true)
    try {
      const r = await fetch("/api/push/test", { method: "POST" })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Test fail")
      toast.show(`📤 Đã gửi test push (${d.sent} device)`, "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Test fail"), "error" as any)
    } finally { setBusy(false) }
  }

  async function installApp() {
    if (!installEvent) return
    installEvent.prompt()
    const r = await installEvent.userChoice
    if (r?.outcome === "accepted") toast.show("✓ Đã cài app", "success" as any)
    setInstallEvent(null)
  }

  if (!supported) return (
    <div style={{ padding: 10, background: "var(--bg3)", borderRadius: 6, fontSize: 11, color: "var(--muted)" }}>
      Browser không hỗ trợ Push Notification. Dùng Chrome/Edge/Safari (iOS 16.4+) trên thiết bị này.
    </div>
  )

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {!subscribed ? (
          <button onClick={subscribe} disabled={busy}
            style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: busy ? "wait" : "pointer", fontFamily: "inherit", opacity: busy ? 0.6 : 1 }}>
            🔔 Bật thông báo
          </button>
        ) : (
          <>
            <span style={{ background: "rgba(46,204,143,.15)", color: "var(--success)", padding: "8px 12px", borderRadius: 6, fontSize: 12, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 5 }}>
              ✅ Thông báo: BẬT
            </span>
            <button onClick={testPush} disabled={busy}
              style={{ background: "var(--bg3)", color: "var(--text)", border: "1px solid var(--border2)", borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              📤 Test push
            </button>
            <button onClick={unsubscribe} disabled={busy}
              style={{ background: "transparent", color: "var(--muted)", border: "1px solid var(--border2)", borderRadius: 6, padding: "8px 14px", fontSize: 12, cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
              Tắt
            </button>
          </>
        )}

        {/* Install prompt — chỉ Android Chrome có beforeinstallprompt */}
        {installEvent && !isStandalone && (
          <button onClick={installApp}
            style={{ background: "rgba(79,126,248,.12)", color: "var(--accent)", border: "1px solid var(--accent)", borderRadius: 6, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            📱 Cài app vào màn hình
          </button>
        )}
      </div>

      {/* iOS hint — Safari không có beforeinstallprompt, user phải làm tay */}
      {isIOS && !isStandalone && (
        <div style={{ padding: "8px 12px", background: "rgba(79,126,248,.08)", border: "1px solid rgba(79,126,248,.2)", borderRadius: 6, fontSize: 11, color: "var(--text)", lineHeight: 1.5 }}>
          💡 <b>Cài app trên iPhone</b>: Mở Safari → bấm nút <b>Chia sẻ</b> (□↑) → chọn <b>"Thêm vào Màn hình chính"</b>. Sau khi cài, mở app từ icon mới rồi bật thông báo (iOS 16.4+ mới hỗ trợ push).
        </div>
      )}
      {!isStandalone && !isIOS && !installEvent && (
        <div style={{ padding: "8px 12px", background: "var(--bg3)", borderRadius: 6, fontSize: 11, color: "var(--muted)" }}>
          💡 Mở app trong Chrome mobile → menu (⋮) → "Add to Home screen" để cài như app.
        </div>
      )}
    </div>
  )
}
