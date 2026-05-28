// Content script chay tren adscheck.smit.vn.
// Job: khi background goi SCRAPE_SMIT_NOW → scrape bang TKQC, tra ve list rows.
//
// Strategy:
//   1. Tim table thuc su (chua "Ngưỡng" trong header)
//   2. Map cot tu header text → column index
//   3. Voi moi row: extract actId (16-digit number trong text), va cac so theo cot
//   4. Parse so VN format "1.234.567" → 1234567
//
// SPA: SMIT React-based → data load sau khi page render. Background phai doi 8-12s.
// Background co the bao "WAIT_FOR_DATA" - content tu poll cho den khi co data.

(function () {
  if (window.__quybeoSmitInjected) return
  window.__quybeoSmitInjected = true

  console.log("[QuyBeo SMIT] Content script loaded on", window.location.href)

  function parseVnNumber(text) {
    if (text == null) return null
    const s = String(text).trim()
    if (!s) return null
    // "No limit" hoac "—" hoac "-" → null
    if (/no limit|^[—-]+$/i.test(s)) return null
    // Bo dot/comma thousand separator + dau d/đ/₫ + khoang trang
    const cleaned = s.replace(/[.,\s đ₫]+/g, "")
    const n = parseInt(cleaned, 10)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  // Tim bang chinh: thu nhieu chien luoc
  const HEADER_KEYWORDS = ["ngưỡng", "số dư", "limit", "tổng tiêu", "tài khoản", "id gốc"]

  function countKeywordMatches(text) {
    const lower = (text || "").toLowerCase()
    return HEADER_KEYWORDS.filter(k => lower.includes(k)).length
  }

  function findMainTable() {
    // Strategy 1: <table> co >= 2 keyword billing
    const tables = document.querySelectorAll("table")
    let best = null
    let bestScore = 0
    for (const t of tables) {
      const score = countKeywordMatches(t.textContent || "")
      if (score >= 2 && score > bestScore) {
        best = t
        bestScore = score
      }
    }
    if (best) {
      console.log("[QuyBeo SMIT] findMainTable: <table> match score", bestScore)
      return best
    }

    // Strategy 2: [role="table"] (div-based React tables)
    const roleTables = document.querySelectorAll('[role="table"]')
    for (const t of roleTables) {
      const score = countKeywordMatches(t.textContent || "")
      if (score >= 2 && score > bestScore) {
        best = t
        bestScore = score
      }
    }
    if (best) {
      console.log("[QuyBeo SMIT] findMainTable: [role=table] match score", bestScore)
      return best
    }

    // Strategy 3: tim div co >= 5 row "Hoạt động" + >= 5 actId 14-18 digits
    // (truong hop SMIT khong dung <table> hay role=table — vd dung CSS grid/flexbox)
    // Iterate ALL divs, pick SMALLEST match (du data nhung khong wrap qua big page area)
    let smallestMatch = null
    let smallestLen = Infinity
    const allDivs = document.querySelectorAll("div")
    for (const div of allDivs) {
      const text = div.textContent || ""
      if (text.length < 500) continue
      const statusCount = (text.match(/hoạt động/gi) || []).length
      const actIdCount = (text.match(/\b\d{14,18}\b/g) || []).length
      if (statusCount >= 5 && actIdCount >= 5) {
        // Smallest matching div = closest to actual rows container (khong wrap qua header/footer/sidebar)
        if (text.length < smallestLen) {
          smallestLen = text.length
          smallestMatch = div
        }
      }
    }
    if (smallestMatch) {
      console.log("[QuyBeo SMIT] findMainTable: smallest div match (text len=" + smallestLen + ")")
      return smallestMatch
    }

    return null
  }

  // Map column header label → index
  function buildColumnMap(table) {
    const headers = table.querySelectorAll('th, [role="columnheader"]')
    const map = {}
    headers.forEach((h, idx) => {
      const t = (h.textContent || "").trim().toLowerCase().replace(/\s+/g, " ")
      // Match flexible: header co the co them icon, dau ↑↓, etc.
      if (/^tài khoản/.test(t)) map.account = idx
      else if (/^id gốc/.test(t)) map.origId = idx
      else if (/^số dư/.test(t)) map.balance = idx
      else if (/^ngưỡng còn lại/.test(t)) map.thresholdLeft = idx
      else if (/^ngưỡng/.test(t)) map.threshold = idx
      else if (/^limit/.test(t)) map.limit = idx
      else if (/^tổng tiêu/.test(t)) map.totalSpent = idx
    })
    return map
  }

  // Parse 1 row dang div-based.
  // VAN DE truoc: textContent KHONG co separator giua cells → actId + IDgoc dinh nhau (18-19 digit).
  // FIX: split text thanh tokens, tim token la STANDALONE 14-18 digit (anchored ^...$).
  function parseRowTextStructural(rowText) {
    // Split row text thanh tokens — separator la moi ky tu KHONG phai digit/dot/comma
    const tokens = rowText.split(/[^\d.,]+/).filter(t => t && t.length > 0)

    // actId: token dau tien LA STANDALONE 14-18 digit (khong co dot/comma)
    let actId = null
    for (const t of tokens) {
      if (/^\d{14,18}$/.test(t)) {
        actId = t
        break
      }
    }
    if (!actId) return null

    // Money: tokens VN format (co dot thousand separator)
    const moneyTokens = tokens.filter(t => /^\d{1,3}(?:\.\d{3})+$/.test(t))
    const data = moneyTokens
      .map(s => parseInt(s.replace(/\./g, ""), 10))
      .filter(n => Number.isFinite(n))

    return {
      actId,
      accountName: (rowText.split(actId)[0] || "").trim().slice(0, 200).replace(/[\n\r]+/g, " ").replace(/●/g, "").trim(),
      balance: data[0] ?? null,
      threshold: data[1] ?? null,
      thresholdLeft: data[2] ?? null,
      dailyLimit: data[3] ?? null,
      totalSpent: data[4] ?? null,
    }
  }

  function scrapeRows() {
    const table = findMainTable()
    if (!table) return { ok: false, error: "Khong tim thay bang co header Ngưỡng + Tài khoản" }

    // Phan 1: thu cell-based (table/role=table)
    const colMap = buildColumnMap(table)
    let rows = table.querySelectorAll("tbody tr")
    if (rows.length === 0) rows = table.querySelectorAll('[role="row"]')
    const hasCellBased = rows.length > 0 && Array.from(rows).some(r => r.querySelectorAll('td, [role="cell"]').length > 0)

    if (hasCellBased && (colMap.threshold !== undefined || colMap.balance !== undefined)) {
      console.log("[QuyBeo SMIT] scrapeRows: cell-based mode, colMap:", colMap)
      const result = []
      let skipped = 0
      for (const row of rows) {
        const cells = row.querySelectorAll('td, [role="cell"]')
        if (cells.length === 0) continue
        const rowText = (row.textContent || "").toLowerCase()
        if (rowText.includes("ngưỡng") && rowText.includes("số dư") && cells.length < 5) continue

        const cleanedRowText = (row.textContent || "").replace(/[.\s]/g, "")
        const actIdMatch = cleanedRowText.match(/\b(\d{14,18})\b/)
        if (!actIdMatch) { skipped++; continue }
        const actId = actIdMatch[1]

        const getCell = (idx) => idx !== undefined && cells[idx] ? cells[idx].textContent : null
        const accountName = getCell(colMap.account)?.trim().split("\n")[0]?.trim() || ""

        result.push({
          actId,
          accountName: accountName.replace(/\d{10,}/g, "").trim(),
          threshold: parseVnNumber(getCell(colMap.threshold)),
          thresholdLeft: parseVnNumber(getCell(colMap.thresholdLeft)),
          balance: parseVnNumber(getCell(colMap.balance)),
          dailyLimit: parseVnNumber(getCell(colMap.limit)),
          totalSpent: parseVnNumber(getCell(colMap.totalSpent)),
        })
      }
      console.log(`[QuyBeo SMIT] Scraped (cell-based) ${result.length} rows, skipped ${skipped}`)
      return { ok: true, rows: result }
    }

    // Phan 2: STRUCTURAL/DIV mode — chia rows theo direct children, parse text
    console.log("[QuyBeo SMIT] scrapeRows: structural/div mode")
    // Tim row container: thuong la 1 div con cua match container, co N children = N rows
    let rowContainer = table
    // Neu match container co nhieu cap, dao xuong tim 1 cap co >= 5 children
    function findRowContainer(el, depth = 0) {
      if (depth > 5) return null
      if (el.children.length >= 5) {
        // Check children co statusBadge
        let badgeCount = 0
        for (const c of el.children) {
          const t = (c.textContent || "").toLowerCase()
          if (t.includes("hoạt động") || /\b\d{14,18}\b/.test(t)) badgeCount++
        }
        if (badgeCount >= 5) return el
      }
      for (const c of el.children) {
        const r = findRowContainer(c, depth + 1)
        if (r) return r
      }
      return null
    }
    rowContainer = findRowContainer(table) || table
    console.log("[QuyBeo SMIT] rowContainer children:", rowContainer.children.length)

    const result = []
    let skipped = 0
    for (const child of rowContainer.children) {
      // UU TIEN innerText (co line break giua cells) - textContent concat khong separator
      const text = child.innerText || child.textContent || ""
      if (text.length < 30) { skipped++; continue }
      const lower = text.toLowerCase()
      // Skip header row (co tat ca cot label)
      if (lower.includes("ngưỡng còn lại") && lower.includes("tổng tiêu")) {
        skipped++
        continue
      }
      const parsed = parseRowTextStructural(text)
      if (!parsed) { skipped++; continue }
      result.push(parsed)
    }

    if (result.length === 0) {
      return { ok: false, error: `Khong scrape duoc row nao (rowContainer.children=${rowContainer.children.length}, skipped=${skipped})` }
    }
    console.log(`[QuyBeo SMIT] Scraped (structural) ${result.length} rows, skipped ${skipped}`)
    return { ok: true, rows: result }
  }

  // Poll: doi den khi bang co data (max 8s khi user da mo tab — data thuong da co san)
  async function waitForDataReady(maxWaitMs = 8000) {
    const start = Date.now()
    while (Date.now() - start < maxWaitMs) {
      const table = findMainTable()
      if (table) {
        const text = table.textContent || ""
        // Check: co >= 5 actId 14-18 digit + >= 5 VN number format
        const actIdCount = (text.match(/\b\d{14,18}\b/g) || []).length
        const numCount = (text.match(/\d{1,3}\.\d{3}/g) || []).length
        if (actIdCount >= 5 && numCount >= 5) return true
      }
      await new Promise(r => setTimeout(r, 300))
    }
    return false
  }

  function diagnose() {
    const hasTable = !!findMainTable()
    const url = window.location.href
    const isLogin = /login|sign-?in|signin/i.test(url) || !!document.querySelector('input[type="password"]')
    // Diagnose chi tiet:
    const allTables = document.querySelectorAll("table").length
    const roleTables = document.querySelectorAll('[role="table"]').length
    const bodyText = document.body.textContent || ""
    const matchCount = countKeywordMatches(bodyText)
    const hasActIds = ((bodyText.match(/\b\d{14,18}\b/g) || []).length)
    const hasStatusBadges = ((bodyText.match(/hoạt động/gi) || []).length)
    return { url, hasTable, isLogin, allTables, roleTables, keywordMatches: matchCount, actIdsInBody: hasActIds, statusBadges: hasStatusBadges }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "SCRAPE_SMIT_NOW") {
      console.log("[QuyBeo SMIT] Received SCRAPE_SMIT_NOW")
      waitForDataReady().then(ready => {
        if (!ready) {
          const d = diagnose()
          console.warn("[QuyBeo SMIT] Diagnose:", d)
          let errMsg = "Bang SMIT khong co data."
          if (d.isLogin) {
            errMsg = "SMIT chua dang nhap - hay login adscheck.smit.vn truoc."
          } else if (!d.hasTable) {
            errMsg = `Khong tim thay bang SMIT (tables=${d.allTables}, roleTables=${d.roleTables}, keywordMatches=${d.keywordMatches}, statusBadges=${d.statusBadges}, actIds=${d.actIdsInBody}). F12 → Console xem chi tiet.`
          }
          sendResponse({ ok: false, error: errMsg, diagnose: d })
          return
        }
        const r = scrapeRows()
        sendResponse(r)
      })
      return true // async
    }
  })
})()
