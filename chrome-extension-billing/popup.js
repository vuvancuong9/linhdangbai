// Popup v5.1.0: chi con SMIT sync.

const APP_BASE = "https://linhdangbai-2odf.vercel.app"

const statusEl = document.getElementById("status")
const smitStatusEl = document.getElementById("smitStatus")
const openBtn = document.getElementById("openApp")
const smitBtn = document.getElementById("manualSmitSync")

async function checkLogin() {
  try {
    const r = await fetch(APP_BASE + "/api/auth/me", { method: "GET", credentials: "include" })
    if (r.ok) {
      const d = await r.json()
      const u = d?.data?.user || d?.user || d
      statusEl.innerHTML = `<span class="ok">✅ Đã login: ${u?.name || u?.email || "OK"}</span>`
    } else if (r.status === 401) {
      statusEl.innerHTML = `<span class="err">❌ Chưa đăng nhập</span>`
    } else {
      statusEl.innerHTML = `<span class="warn">⚠ Status HTTP ${r.status}</span>`
    }
  } catch (e) {
    statusEl.innerHTML = `<span class="err">❌ Không kết nối được: ${e.message}</span>`
  }
}

async function loadStatus() {
  const data = await chrome.storage.local.get([
    "smitLastSyncAt", "smitLastSummary", "smitLastError",
  ])

  if (data.smitLastError) {
    smitStatusEl.innerHTML = `<span class="err">❌ ${escapeHtml(data.smitLastError)}</span>`
  } else if (data.smitLastSyncAt) {
    const mins = Math.floor((Date.now() - data.smitLastSyncAt) / 60000)
    const timeAgo = mins < 60 ? `${mins}p trước` : `${Math.floor(mins / 60)}h ${mins % 60}p trước`
    smitStatusEl.innerHTML = `<span class="ok">✅ ${escapeHtml(data.smitLastSummary || "OK")}</span><br><span class="small">(${timeAgo})</span>`
  } else {
    smitStatusEl.innerHTML = `Chưa sync lần nào — sẽ tự chạy sau 20-50p, hoặc bấm "Sync SMIT ngay".`
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))
}

openBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: APP_BASE + "/billing" })
})

smitBtn.addEventListener("click", async () => {
  smitBtn.disabled = true
  smitBtn.textContent = "⏳ Đang scrape SMIT..."
  try {
    const res = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: "RUN_SMIT_SYNC_NOW" }, (response) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
        else resolve(response)
      })
    })
    if (!res?.ok) {
      smitStatusEl.innerHTML = `<span class="err">❌ ${escapeHtml(res?.error || "Unknown")}</span>`
    } else {
      await loadStatus()
    }
  } catch (e) {
    smitStatusEl.innerHTML = `<span class="err">❌ ${escapeHtml(e.message)}</span>`
  } finally {
    smitBtn.disabled = false
    smitBtn.textContent = "🚀 Sync SMIT ngay"
  }
})

checkLogin()
loadStatus()
