// Background service worker (v5.1.0):
// CHI con SMIT sync (FB auto-sync da bo).
// Alarm random 20-50p → mo tab an adscheck.smit.vn → content-smit.js scrape → POST bulk app.

const APP_BASE = "https://app.quybeo.com"
const SMIT_SYNC_ENDPOINT = APP_BASE + "/api/accounts/sync-thresholds-bulk-from-ext"

const SMIT_URL = "https://adscheck.smit.vn/app/adscheck-pro"
const SMIT_ALARM = "quybeo-smit-auto-sync"
const SMIT_DELAY_MIN_MIN = 20
const SMIT_DELAY_MAX_MIN = 50
const SMIT_TAB_LOAD_WAIT_MS = 10000

function nextSmitDelayMin() {
  return SMIT_DELAY_MIN_MIN + Math.floor(Math.random() * (SMIT_DELAY_MAX_MIN - SMIT_DELAY_MIN_MIN + 1))
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "RUN_SMIT_SYNC_NOW") {
    runSmitSync().then((r) => sendResponse({ ok: true, ...r })).catch((e) => sendResponse({ ok: false, error: e?.message }))
    return true
  }
})

// Setup alarm khi cai dat / startup
chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(SMIT_ALARM, { delayInMinutes: nextSmitDelayMin() })
  console.log("[QuyBeo SMIT] Alarm setup random 20-50p")
})
chrome.runtime.onStartup.addListener(async () => {
  await chrome.alarms.create(SMIT_ALARM, { delayInMinutes: nextSmitDelayMin() })
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SMIT_ALARM) return
  console.log("[QuyBeo SMIT] Trigger luc " + new Date().toLocaleString("vi-VN"))
  try {
    await runSmitSync()
  } catch (e) {
    console.error("[QuyBeo SMIT] runSmitSync exception:", e?.message)
  }
  // Schedule next random run
  const nextMin = nextSmitDelayMin()
  await chrome.alarms.create(SMIT_ALARM, { delayInMinutes: nextMin })
  console.log("[QuyBeo SMIT] Next run in " + nextMin + " phut")
})

// Tim tab SMIT user da mo san (extension SMIT chi load data trong tab ACTIVE, tab an khong co data)
async function findExistingSmitTab() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://adscheck.smit.vn/*" })
    // Uu tien tab co url /adscheck-pro
    const proTab = tabs.find(t => t.url && t.url.includes("adscheck-pro"))
    return proTab || tabs[0] || null
  } catch {
    return null
  }
}

async function runSmitSync() {
  let tab = null
  let createdNewTab = false
  try {
    // Strategy 1: dung tab SMIT user da mo san
    const existingTab = await findExistingSmitTab()
    if (existingTab) {
      tab = existingTab
      console.log("[QuyBeo SMIT] Tim thay tab SMIT (id=" + tab.id + "), F5 de lay data fresh...")
      // F5 (reload) tab SMIT → SMIT extension re-fetch data moi
      try { await chrome.tabs.reload(tab.id) } catch (e) {
        console.warn("[QuyBeo SMIT] Reload fail:", e?.message)
      }
      // Doi 10s cho page reload + SMIT extension fetch data
      await sleep(SMIT_TAB_LOAD_WAIT_MS)
    } else {
      // Strategy 2: fallback - mo tab moi
      console.log("[QuyBeo SMIT] Khong co tab SMIT, mo tab moi...")
      tab = await chrome.tabs.create({ url: SMIT_URL, active: false })
      createdNewTab = true
      await sleep(SMIT_TAB_LOAD_WAIT_MS)
    }

    let scrapeRes = null
    try {
      scrapeRes = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_SMIT_NOW" })
    } catch (e) {
      throw new Error("Content script SMIT khong response (reload extension SMIT hoac F5 tab SMIT?): " + (e?.message || e))
    }
    if (!scrapeRes?.ok) {
      throw new Error(scrapeRes?.error || "Scrape SMIT fail")
    }

    const rows = scrapeRes.rows || []
    console.log(`[QuyBeo SMIT] Scraped ${rows.length} rows. Sample actIds:`, rows.slice(0, 3).map(r => r.actId))
    console.log(`[QuyBeo SMIT] Sample data:`, rows.slice(0, 2))
    if (rows.length === 0) {
      await chrome.storage.local.set({
        smitLastSyncAt: Date.now(),
        smitLastSummary: "0 TKQC — co the chua login SMIT",
        smitLastError: "Khong co row nao",
      })
      return { ok: true, rowCount: 0, savedCount: 0 }
    }

    const r = await fetch(SMIT_SYNC_ENDPOINT, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) {
      throw new Error(data?.error || `HTTP ${r.status}`)
    }
    console.log(`[QuyBeo SMIT] Backend response:`, data)
    let summary = `${data.saved || 0}/${rows.length} TKQC (skipped ${data.skipped || 0}) ${new Date().toLocaleString("vi-VN")}`
    // Neu skip nhieu, them sample actId skip vao summary de debug
    if (data.skipped > 0 && data.skippedSample?.length > 0) {
      summary += ` | Skipped actIds: ${data.skippedSample.slice(0, 3).join(", ")}...`
    }
    await chrome.storage.local.set({
      smitLastSyncAt: Date.now(),
      smitLastSummary: summary,
      smitLastError: null,
      smitDebugSampleScraped: rows.slice(0, 3).map(r => ({ actId: r.actId, threshold: r.threshold, accountName: r.accountName })),
      smitDebugSkipped: data.skippedSample || [],
    })
    console.log("[QuyBeo SMIT] " + summary)
    return { ok: true, rowCount: rows.length, savedCount: data.saved || 0 }
  } catch (e) {
    const msg = String(e?.message || e)
    console.error("[QuyBeo SMIT] runSmitSync error:", msg)
    await chrome.storage.local.set({
      smitLastSyncAt: Date.now(),
      smitLastError: msg,
    })
    return { ok: false, error: msg }
  } finally {
    // CHI dong tab moi tao boi extension. Tab user mo san GIU NGUYEN.
    if (createdNewTab && tab?.id) {
      try { await chrome.tabs.remove(tab.id) } catch {}
    }
  }
}

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)) }
