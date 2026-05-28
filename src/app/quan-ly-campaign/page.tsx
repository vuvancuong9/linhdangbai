"use client"
import { useState, useEffect, useMemo } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateInputVN from "@/components/DateInputVN"
import DateRangePickerVN from "@/components/DateRangePickerVN"
import { DATA_LOCK_DATE } from "@/lib/data-lock"
import { useConfirm } from "@/components/Confirm"
import { useToast } from "@/components/Toast"

export default function QuanLyCampaignPage() {
  const { ask } = useConfirm()
  const toast = useToast()
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [affiliateImporting, setAffiliateImporting] = useState(false)
  const [affiliateMsg, setAffiliateMsg] = useState("")
  const [shopeeAccounts, setShopeeAccounts] = useState<any[]>([])
  const [selectedShopeeId, setSelectedShopeeId] = useState("")
  const [showShopeeCfg, setShowShopeeCfg] = useState(false)
  const [shopeeApiSyncing, setShopeeApiSyncing] = useState(false)
  const [shopeeForm, setShopeeForm] = useState({ id: "", name: "", appId: "", apiKey: "" })
  const [shopeeSaving, setShopeeSaving] = useState(false)
  const [shopeeCfgErr, setShopeeCfgErr] = useState("")
  // Multi-select TKQC để Tải tất cả
  const [showTkPicker, setShowTkPicker] = useState(false)
  const [pickedTkIds, setPickedTkIds] = useState<Set<string>>(new Set())
  // Bulk update budget
  const [showBulkBudget, setShowBulkBudget] = useState(false)
  const [bulkBudgetValue, setBulkBudgetValue] = useState(100000)
  const [bulkBudgetSaving, setBulkBudgetSaving] = useState(false)
  // Orphan commission: HH có subId2 không match camp visible (camp legacy / đã xoá)
  const [orphan, setOrphan] = useState<{ total: number; orderCount: number; items: Array<{ subId2: string; commission: number; orderCount: number; legacyCamp: { id: string; name: string; campId: string } | null }> } | null>(null)
  const [showOrphan, setShowOrphan] = useState(false)
  // Map<subId2, {posts, note}> cache kết quả tìm Post; loadingSubId = đang fetch
  const [orphanPosts, setOrphanPosts] = useState<Map<string, { posts: any[]; note?: string }>>(new Map())
  const [orphanLoadingSub, setOrphanLoadingSub] = useState<string | null>(null)
  // Recreate camp loading state: postId đang tạo lại
  const [recreatingPostId, setRecreatingPostId] = useState<string | null>(null)

  async function recreateCampForPost(postId: string, campName: string) {
    if (recreatingPostId) return
    if (!await ask(`Tạo lại camp "${campName}" cho Post này?\n\n• Camp mới sẽ được tạo trên FB Ads Manager với config gần nhất anh dùng.\n• Post sẽ link với camp mới này.`, { title: "Tạo lại camp" })) return
    setRecreatingPostId(postId)
    try {
      const r = await fetch("/api/posts/recreate-camp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postId, campName }),
      })
      const d = await r.json()
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setSyncMsg(`✅ ${d.message} (FB ID: ${d.campaignFbId})`)
      // Refresh: camp mới giờ visible → reload campaigns + orphan
      await fetchCampaigns()
      // Đóng modal orphan, banner sẽ update với data mới
      setShowOrphan(false)
      setOrphanPosts(new Map())
      setTimeout(() => setSyncMsg(""), 6000)
      playBeep(true)
    } catch (e: any) {
      setSyncMsg("❌ Tạo lại camp lỗi: " + (e?.message || "unknown"))
      setTimeout(() => setSyncMsg(""), 8000)
      playBeep(false)
    } finally {
      setRecreatingPostId(null)
    }
  }

  async function searchPostsBySubId(subId: string) {
    if (orphanPosts.has(subId)) {
      // Toggle: nếu đã có data → xoá để collapse
      setOrphanPosts(m => { const n = new Map(m); n.delete(subId); return n })
      return
    }
    setOrphanLoadingSub(subId)
    try {
      const r = await fetch("/api/posts/search-by-name?q=" + encodeURIComponent(subId))
      const d = await r.json()
      if (r.ok) setOrphanPosts(m => new Map(m).set(subId, { posts: d.posts || [], note: d.note }))
      else setOrphanPosts(m => new Map(m).set(subId, { posts: [], note: d.error || "Lỗi tìm" }))
    } catch (e: any) {
      setOrphanPosts(m => new Map(m).set(subId, { posts: [], note: e?.message || "Lỗi" }))
    } finally {
      setOrphanLoadingSub(null)
    }
  }

  async function loadShopeeAccounts() {
    try {
      const r = await fetch("/api/shopee/token")
      if (!r.ok) return
      const d = await r.json()
      setShopeeAccounts(Array.isArray(d.accounts) ? d.accounts : [])
    } catch {}
  }
  useEffect(() => { loadShopeeAccounts() }, [])

  async function saveShopeeToken() {
    // Yêu cầu duy nhất là tên. AppID/API Key có thể bỏ trống (nhiều TK Shopee không có API).
    if (!shopeeForm.name.trim()) return
    setShopeeSaving(true)
    setShopeeCfgErr("")
    try {
      const r = await fetch("/api/shopee/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(shopeeForm) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setAffiliateMsg(shopeeForm.id ? "✅ Đã cập nhật Shopee account" : "✅ Đã thêm Shopee account")
      setTimeout(() => setAffiliateMsg(""), 2500)
      setShopeeForm({ id: "", name: "", appId: "", apiKey: "" })
      loadShopeeAccounts()
    } catch (e: any) {
      setShopeeCfgErr(e?.message || "Lỗi lưu")
    } finally { setShopeeSaving(false) }
  }

  async function deleteShopeeAccount(id: string) {
    if (!await ask("Xoá Shopee account này?", { danger: true })) return
    await fetch("/api/shopee/token?id=" + encodeURIComponent(id), { method: "DELETE" })
    loadShopeeAccounts()
  }

  async function clearManualForSelectedShopee() {
    if (!selectedShopeeId) {
      setAffiliateMsg("❌ Chọn TK Shopee trước (dropdown bên trái)")
      setTimeout(() => setAffiliateMsg(""), 4000)
      return
    }
    const acc = shopeeAccounts.find((a: any) => a.id === selectedShopeeId)
    const accName = acc?.name || "TK Shopee"
    if (!await ask(`Xoá data CSV upload (manual) của "${accName}" trong VÒNG 30 NGÀY GẦN ĐÂY?\n\n⚠ Data từ CSV trong 30 ngày gần đây bị xoá. Data sync API GIỮ NGUYÊN.\n🔒 Đơn hàng cũ hơn 30 ngày được BẢO VỆ — không bị xoá.\n\nDùng khi upload nhầm CSV vào account này.`, { title: "Xoá CSV upload (rolling 30d)", danger: true })) return
    setAffiliateMsg(`⏳ Đang xoá data manual của "${accName}"...`)
    try {
      const r = await fetch("/api/affiliate/clear-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Confirm": "yes" },
        body: JSON.stringify({ shopeeAccountId: selectedShopeeId }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setAffiliateMsg(`✅ Đã xoá ${d.deleted} rows (${(d.totalCommission || 0).toLocaleString("vi-VN")}đ) cho ${accName}`)
      await fetchCampaigns()
      setTimeout(() => setAffiliateMsg(""), 6000)
    } catch (e: any) {
      setAffiliateMsg(`❌ ${e?.message || "Lỗi"}`)
      setTimeout(() => setAffiliateMsg(""), 6000)
    }
  }

  // Parse Shopee Affiliate CSV/XLSX, aggregate by (Sub_id2, DATE(Thời gian Click))
  // and POST to /api/affiliate/import. After success, refetch campaigns so the
  // commission column reflects the imported data within the current date range.
  async function handleAffiliateUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    // Cap file size 200MB — đủ cho CSV nhiều tháng. CSV stream parse, không OOM.
    const MAX_FILE_MB = 200
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setAffiliateMsg(`❌ File quá lớn (${(f.size/1024/1024).toFixed(1)}MB > ${MAX_FILE_MB}MB). Tách file theo tháng và upload riêng.`)
      setTimeout(() => setAffiliateMsg(""), 7000)
      try { e.target.value = "" } catch {}
      return
    }
    if (shopeeAccounts.length > 0 && !selectedShopeeId) {
      setAffiliateMsg("❌ Chọn TK Shopee trước khi upload")
      setTimeout(() => setAffiliateMsg(""), 4000)
      try { e.target.value = "" } catch {}
      return
    }
    setAffiliateImporting(true)
    setAffiliateMsg("📖 Đang đọc file...")
    try {
      const name = f.name.toLowerCase()
      const norm = (s: any) => String(s ?? "").trim().toLowerCase()
      // V2: aggregate per orderId thay vì per (sub_id2, date) — track từng đơn riêng biệt.
      type OrderAcc = {
        orderId: string
        subId1: string | null
        subId2: string | null
        subId3: string | null
        subId4: string | null
        subId5: string | null
        clickTime: string | null    // raw original string for backend parse
        purchaseTime: string | null
        completeTime: string | null
        clickDate: string           // YYYY-MM-DD normalized
        statusRaw: string           // original status from CSV
        commission: number          // sum of all line items
        orderValue: number          // sum or first non-null
        shopName: string | null
        shopId: string | null
        productName: string | null  // first item name as representative
        itemCount: number
        channel: string | null
      }
      const orders = new Map<string, OrderAcc>()

      let skippedNoOrderId = 0
      let skippedNoTime = 0
      let skippedBadDate = 0
      let totalRows = 0

      const parseClickDate = (ct: string): string => {
        const isoMatch = ct.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2,"0")}-${isoMatch[3].padStart(2,"0")}`
        const slashMatch = ct.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (slashMatch) {
          const a = parseInt(slashMatch[1]), b = parseInt(slashMatch[2])
          const isDMY = a > 12
          const day = isDMY ? a : b
          const month = isDMY ? b : a
          if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${slashMatch[3]}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`
          }
        }
        return ""
      }

      const normalizeStatus = (raw: string): string => {
        const s = norm(raw)
        if (!s) return "pending"
        if (s.includes("hủy") || s.includes("huy") || s.includes("cancel")) return "cancelled"
        if (s.includes("hoàn thành") || s.includes("hoan thanh") || s.includes("complete")) return "completed"
        return "pending"
      }

      const processRow = (row: Record<string, any>) => {
        totalRows++
        const orderId = String(row["ID đơn hàng"] ?? "").trim()
        if (!orderId) { skippedNoOrderId++; return }
        const ct = String(row["Thời gian Click"] ?? "").trim()
        if (!ct) { skippedNoTime++; return }
        const date = parseClickDate(ct)
        if (!date) { skippedBadDate++; return }

        const nc = parseFloat(String(row["Hoa hồng ròng tiếp thị liên kết(₫)"] ?? "0").replace(/,/g, ""))
        const ncSafe = isNaN(nc) ? 0 : nc
        const ov = parseFloat(String(row["Giá trị đơn hàng (₫)"] ?? "0").replace(/,/g, ""))
        const ovSafe = isNaN(ov) ? 0 : ov
        const statusRaw = String(row["Trạng thái đặt hàng"] ?? row["Trạng thái đơn hàng"] ?? "").trim()

        // Get-or-create order entry
        let acc = orders.get(orderId)
        if (!acc) {
          acc = {
            orderId,
            subId1: String(row["Sub_id1"] ?? "").trim() || null,
            subId2: String(row["Sub_id2"] ?? "").trim() || null,
            subId3: String(row["Sub_id3"] ?? "").trim() || null,
            subId4: String(row["Sub_id4"] ?? "").trim() || null,
            subId5: String(row["Sub_id5"] ?? "").trim() || null,
            clickTime: ct,
            purchaseTime: String(row["Thời Gian Đặt Hàng"] ?? "").trim() || null,
            completeTime: String(row["Thời gian hoàn thành"] ?? "").trim() || null,
            clickDate: date,
            statusRaw: statusRaw,
            commission: 0,
            orderValue: 0,
            shopName: String(row["Tên Shop"] ?? "").trim() || null,
            shopId: String(row["Shop id"] ?? "").trim() || null,
            productName: String(row["Tên Item"] ?? "").trim() || null,
            itemCount: 0,
            channel: String(row["Kênh"] ?? "").trim() || null,
          }
          orders.set(orderId, acc)
        }
        // Sum commission across all line items of this order
        acc.commission += ncSafe
        acc.orderValue += ovSafe
        acc.itemCount++
        // Latest status wins (CSV usually consistent across rows of same order)
        if (statusRaw) acc.statusRaw = statusRaw
      }

      if (name.endsWith(".csv")) {
        // Stream-parse CSV theo từng chunk 5MB. Không dùng worker vì
        // worker + step có thể dừng sớm với file rất lớn.
        const Papa = (await import("papaparse")).default
        const parseErrors: any[] = []
        await new Promise<void>((resolve, reject) => {
          let lastTick = 0
          Papa.parse<Record<string, any>>(f, {
            header: true,
            skipEmptyLines: true,
            chunkSize: 5 * 1024 * 1024,
            // Strip BOM (﻿) khoi header de "ID don hang" match dung.
            // File CSV tu Shopee Affiliate co BOM EF BB BF -> cot dau bi
            // `﻿ID don hang` -> row["ID don hang"] = undefined -> skip het.
            transformHeader: (h: string) => h.replace(/^﻿/, "").trim(),
            chunk: (results) => {
              if (results.errors?.length) {
                parseErrors.push(...results.errors.slice(0, 5))
              }
              for (const row of results.data) processRow(row)
              const now = Date.now()
              if (now - lastTick > 250) {
                setAffiliateMsg(`📖 Đã đọc ${totalRows.toLocaleString("vi-VN")} dòng...`)
                lastTick = now
              }
            },
            complete: () => {
              if (parseErrors.length > 0) {
                console.warn("[CSV parse warnings]", parseErrors.slice(0, 3))
              }
              resolve()
            },
            error: (err) => reject(new Error(err.message || "Lỗi đọc CSV")),
          })
        })
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx")
        const buf = await f.arrayBuffer()
        const wb = XLSX.read(buf, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const records = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { raw: false, defval: "" })
        // Strip BOM khoi key cua moi row (de phong xlsx export tu CSV co BOM)
        for (const row of records) {
          const cleaned: Record<string, any> = {}
          for (const k of Object.keys(row)) cleaned[k.replace(/^﻿/, "").trim()] = row[k]
          processRow(cleaned)
        }
      } else {
        throw new Error("Định dạng không hỗ trợ (cần .csv/.xlsx/.xls)")
      }

      if (totalRows === 0) throw new Error("File rỗng hoặc không đọc được")
      if (orders.size === 0) throw new Error("Không tìm thấy cột ID đơn hàng / Thời gian Click — kiểm tra header file")

      // Build records to send to /api/orders/import
      const records = Array.from(orders.values()).map((o) => ({
        orderId: o.orderId,
        subId1: o.subId1,
        subId2: o.subId2,
        subId3: o.subId3,
        subId4: o.subId4,
        subId5: o.subId5,
        clickTime: o.clickTime,
        purchaseTime: o.purchaseTime,
        completeTime: o.completeTime,
        clickDate: o.clickDate,
        status: normalizeStatus(o.statusRaw),
        commission: o.commission,
        orderValue: o.orderValue,
        shopName: o.shopName,
        shopId: o.shopId,
        productName: o.productName,
        itemCount: o.itemCount,
        channel: o.channel,
      }))

      // DIAGNOSTIC
      const totalParsed = records.reduce((s, r) => s + r.commission, 0)
      const totalNonCancelled = records.filter(r => r.status !== "cancelled").reduce((s, r) => s + r.commission, 0)
      const fmtMoney = (n: number) => Math.round(n).toLocaleString("vi-VN")
      const countByStatus: Record<string, number> = {}
      for (const r of records) countByStatus[r.status] = (countByStatus[r.status] || 0) + 1
      console.log(`[Affiliate Import V2 per-order] === BREAKDOWN ===`)
      console.log(`[Affiliate Import V2] Total CSV rows: ${totalRows}`)
      console.log(`[Affiliate Import V2] Unique orders: ${records.length}`)
      console.log(`[Affiliate Import V2] By status:`, countByStatus)
      console.log(`[Affiliate Import V2] Skipped no orderId: ${skippedNoOrderId}, no time: ${skippedNoTime}, bad date: ${skippedBadDate}`)
      console.log(`[Affiliate Import V2] Total commission (all): ${fmtMoney(totalParsed)}đ`)
      console.log(`[Affiliate Import V2] Total commission (non-cancelled): ${fmtMoney(totalNonCancelled)}đ`)

      const warns: string[] = []
      if (skippedNoTime > 0) warns.push(`${skippedNoTime} dòng thiếu giờ click`)
      if (skippedBadDate > 0) warns.push(`${skippedBadDate} dòng date lạ`)
      if (skippedNoOrderId > 0) warns.push(`${skippedNoOrderId} dòng thiếu orderID`)
      const warnTxt = warns.length > 0 ? ` ⚠ skip: ${warns.join(", ")}.` : ""
      setAffiliateMsg(`📤 Đọc ${totalRows.toLocaleString("vi-VN")} dòng → ${records.length.toLocaleString("vi-VN")} đơn (active ${fmtMoney(totalNonCancelled)}đ).${warnTxt} Đang import...`)

      const CHUNK = 2000
      let totalImported = 0
      let totalSkippedLocked = 0
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK)
        const res = await fetch("/api/orders/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: chunk, shopeeAccountId: selectedShopeeId || null }),
        })
        if (!res.ok) {
          const err = await res.text().catch(() => "")
          throw new Error(`Import lỗi (${res.status}): ${err.slice(0, 120)}`)
        }
        const data = await res.json().catch(() => ({}))
        totalImported += Number(data?.imported ?? 0)
        totalSkippedLocked += Number(data?.skippedLocked ?? 0)
        setAffiliateMsg(`📤 Đã import ${totalImported.toLocaleString("vi-VN")}/${records.length.toLocaleString("vi-VN")} đơn`)
      }
      setAffiliateMsg(`✅ Import ${totalImported.toLocaleString("vi-VN")} đơn. Đang tải lại...`)
      await fetchCampaigns()
      const lockMsg = totalSkippedLocked > 0
        ? ` 🔒 Skip ${totalSkippedLocked.toLocaleString("vi-VN")} đơn cũ hơn 30 ngày (data cũ được bảo vệ, không cho ghi đè).`
        : ""
      setAffiliateMsg(`✅ Đã cập nhật ${totalImported.toLocaleString("vi-VN")} đơn (active: ${fmtMoney(totalNonCancelled)}đ).${lockMsg}`)
      setTimeout(() => setAffiliateMsg(""), 5000)
    } catch (err: any) {
      setAffiliateMsg(`❌ ${err?.message || String(err)}`)
      setTimeout(() => setAffiliateMsg(""), 6000)
    } finally {
      setAffiliateImporting(false)
      try { e.target.value = "" } catch {}
    }
  }

  // Parse Shopee Website Click Report CSV/XLSX:
  // Cột "Sub_id" format giống utmContent (sub1-sub2-sub3-...) → lấy sub2.
  // Cột "Thời gian Click" → lấy ngày (giờ VN).
  // Count rows per (sub2, date) = clickCount.
  async function handleClickUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    // Cap file size 200MB
    const MAX_FILE_MB = 200
    if (f.size > MAX_FILE_MB * 1024 * 1024) {
      setAffiliateMsg(`❌ File quá lớn (${(f.size/1024/1024).toFixed(1)}MB > ${MAX_FILE_MB}MB). Tách file và upload riêng.`)
      setTimeout(() => setAffiliateMsg(""), 7000)
      try { e.target.value = "" } catch {}
      return
    }
    if (shopeeAccounts.length > 0 && !selectedShopeeId) {
      setAffiliateMsg("❌ Chọn TK Shopee trước khi upload")
      setTimeout(() => setAffiliateMsg(""), 4000)
      try { e.target.value = "" } catch {}
      return
    }
    setAffiliateImporting(true)
    setAffiliateMsg("📖 Đang đọc file click...")
    try {
      const name = f.name.toLowerCase()
      const agg = new Map<string, number>()
      let totalRows = 0

      // Parse date string thành "YYYY-MM-DD". Hỗ trợ nhiều format Excel có thể trả về:
      // - 2026-05-03 08:54:00 (Shopee CSV gốc)
      // - 5/3/2026 8:54 (Excel US locale auto-format)
      // - 3/5/2026 8:54 (Excel VN locale)
      // - Date object (XLSX với cellDates: true)
      const parseDate = (ct: any): string | null => {
        if (!ct) return null
        // Date object
        if (ct instanceof Date && !isNaN(ct.getTime())) {
          const y = ct.getFullYear(), m = ct.getMonth() + 1, d = ct.getDate()
          return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`
        }
        const s = String(ct).trim()
        // YYYY-MM-DD ở đầu
        const isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
        if (isoMatch) {
          return `${isoMatch[1]}-${String(isoMatch[2]).padStart(2, "0")}-${String(isoMatch[3]).padStart(2, "0")}`
        }
        // M/D/YYYY hoặc D/M/YYYY (Excel format) — cần đoán
        const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
        if (slashMatch) {
          let a = parseInt(slashMatch[1], 10)
          let b = parseInt(slashMatch[2], 10)
          const y = slashMatch[3]
          // Heuristic: nếu a > 12 → chắc chắn là D/M (vd 13/5/2026)
          // Nếu b > 12 → chắc chắn là M/D (vd 5/13/2026)
          // Còn lại (cả 2 ≤ 12) → Excel locale Mỹ thường M/D, ưu tiên M/D.
          let day, month
          if (a > 12) { day = a; month = b }
          else if (b > 12) { month = a; day = b }
          else { month = a; day = b } // ambiguous → assume M/D (Excel default)
          return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        }
        return null
      }

      const processRow = (row: Record<string, any>) => {
        totalRows++
        const subRaw = String(row["Sub_id"] ?? row["Sub_id2"] ?? "").trim()
        if (!subRaw) return
        // Parse sub2 từ format "sub1-sub2-sub3-sub4-sub5"
        let subId2 = subRaw
        if (subRaw.includes("-")) {
          const parts = subRaw.split("-")
          if (parts.length >= 2) subId2 = parts[1].trim()
        }
        if (!subId2) return
        const date = parseDate(row["Thời gian Click"])
        if (!date) return
        const key = subId2 + "|" + date
        agg.set(key, (agg.get(key) || 0) + 1)
      }

      if (name.endsWith(".csv")) {
        const Papa = (await import("papaparse")).default
        await new Promise<void>((resolve, reject) => {
          let lastTick = 0
          Papa.parse<Record<string, any>>(f, {
            header: true,
            skipEmptyLines: true,
            chunkSize: 5 * 1024 * 1024,
            chunk: (results) => {
              for (const row of results.data) processRow(row)
              const now = Date.now()
              if (now - lastTick > 250) {
                setAffiliateMsg(`📖 Đã đọc ${totalRows.toLocaleString("vi-VN")} click...`)
                lastTick = now
              }
            },
            complete: () => resolve(),
            error: (err) => reject(new Error(err.message || "Lỗi đọc CSV")),
          })
        })
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const XLSX = await import("xlsx")
        const buf = await f.arrayBuffer()
        // cellDates: true → cell ngày trả Date object thay vì Excel serial number
        const wb = XLSX.read(buf, { type: "array", cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const records = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { raw: true, defval: "" })
        for (const row of records) processRow(row)
      } else {
        throw new Error("Định dạng không hỗ trợ (cần .csv/.xlsx/.xls)")
      }

      if (totalRows === 0) throw new Error("File rỗng hoặc không đọc được")
      if (agg.size === 0) throw new Error("Không tìm thấy cột Sub_id / Thời gian Click — kiểm tra header file")

      const records = Array.from(agg.entries()).map(([k, count]) => {
        const [subId2, date] = k.split("|")
        return { subId2, date, clickCount: count }
      })

      // DIAGNOSTIC: thống kê date breakdown để user verify date có đúng không
      const dateStats = new Map<string, number>()
      for (const r of records) {
        dateStats.set(r.date, (dateStats.get(r.date) || 0) + r.clickCount)
      }
      const sortedDates = Array.from(dateStats.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)
      console.log(`[Click Upload] Sample subId2: ${records.slice(0, 5).map(r => `${r.subId2}=${r.clickCount}`).join(", ")}`)
      console.log(`[Click Upload] Top dates by click count:`, sortedDates.map(([d, c]) => `${d}: ${c}`).join(", "))
      const dateSummary = sortedDates.map(([d, c]) => `${d}: ${c.toLocaleString("vi-VN")}`).join(" · ")

      setAffiliateMsg(`📤 ${totalRows.toLocaleString("vi-VN")} click → ${records.length.toLocaleString("vi-VN")} record. Top dates: ${dateSummary}`)

      const CHUNK = 5000
      let totalImported = 0
      for (let i = 0; i < records.length; i += CHUNK) {
        const chunk = records.slice(i, i + CHUNK)
        const res = await fetch("/api/affiliate/import-clicks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: chunk, shopeeAccountId: selectedShopeeId || null }),
        })
        if (!res.ok) {
          const err = await res.text().catch(() => "")
          throw new Error(`Import lỗi (${res.status}): ${err.slice(0, 120)}`)
        }
        const data = await res.json().catch(() => ({}))
        totalImported += Number(data?.imported ?? 0)
        setAffiliateMsg(`📤 Đã import ${totalImported.toLocaleString("vi-VN")}/${records.length.toLocaleString("vi-VN")}`)
      }

      setAffiliateMsg(`✅ Import ${totalImported.toLocaleString("vi-VN")} dòng click. Top dates: ${dateSummary}. Đang tải lại...`)
      await fetchCampaigns()
      setAffiliateMsg(`✅ Đã cập nhật ${totalImported.toLocaleString("vi-VN")} dòng click. Top dates: ${dateSummary}`)
      setTimeout(() => setAffiliateMsg(""), 8000)
    } catch (err: any) {
      setAffiliateMsg(`❌ ${err?.message || String(err)}`)
      setTimeout(() => setAffiliateMsg(""), 6000)
    } finally {
      setAffiliateImporting(false)
      try { e.target.value = "" } catch {}
    }
  }

  const [adAccounts, setAdAccounts] = useState<any[]>([])
  const [selAccount, setSelAccount] = useState<string>("")
  // FB Insights chỉ trả data đáng tin sau khi ngày kết thúc, nên cap "Đến ngày" max = hôm qua.
  const yesterdayStr = (() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10) })()
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString().slice(0,10) })
  const [dateTo, setDateTo] = useState(yesterdayStr)
  const [syncing, setSyncing] = useState(false)
  const [syncingAccounts, setSyncingAccounts] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editItem, setEditItem] = useState<any>(null)
  const [tab, setTab] = useState("all")
  const [onlyDup, setOnlyDup] = useState(false) // chỉ hiện camp trùng tên ×2+
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastSelIdx, setLastSelIdx] = useState<number | null>(null)
  const [sortKey, setSortKey] = useState("")
  const [sortDir, setSortDir] = useState(1)
  const [showAdv, setShowAdv] = useState(false)
  const [editBudget, setEditBudget] = useState<string|null>(null)
  const [budgetVal, setBudgetVal] = useState("")
  const [sttF, setSttF] = useState("")
  const [sttT, setSttT] = useState("")
  const [page, setPage] = useState(1)
  const [advFilter, setAdvFilter] = useState({cpcMn:"",cpcMx:"",plMn:"",plMx:"",spMn:"",spMx:"",hhMn:"",hhMx:"",ahMn:"",ahMx:"",sfMn:"",sfMx:""})
  const [form, setForm] = useState({name:"",campId:"",status:"on",budget:100000,cpc:0,clicks:0,clickSP:0,spend:0,commission:0,adsHH:0,profitLoss:0})
  const [deletingCamps, setDeletingCamps] = useState(false)

  // Export camps đang chọn (hoặc filtered nếu không chọn) sang CSV.
  function exportToCsv() {
    const rows: any[] = selected.size > 0 ? filtered.filter((c: any) => selected.has(c.id)) : filtered
    if (rows.length === 0) {
      setSyncMsg("Không có camp nào để export")
      setTimeout(() => setSyncMsg(""), 3000)
      return
    }
    const headers = ["STT", "Tên Campaign", "Camp ID", "Trạng thái", "Budget", "CPC", "Click FB", "Click SP", "Chi phí", "Hoa hồng", "Ads/HH (%)", "SP/FB (%)", "Lãi/Lỗ"]
    const esc = (v: any) => {
      const s = String(v ?? "")
      return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const lines = [headers.join(",")]
    rows.forEach((c, i) => {
      const sp = c.clickSP || 0
      const fb = c.clicks || 0
      const spfb = fb > 0 ? Math.round((sp / fb) * 1000) / 10 : ""
      lines.push([
        i + 1,
        esc(c.name),
        esc(c.campId),
        c.status === "on" ? "Bật" : c.status === "err" ? "Lỗi" : "Tắt",
        c.budget || 0,
        c.cpc || 0,
        c.clicks || 0,
        c.clickSP || 0,
        c.spend || 0,
        c.commission ?? "",
        c.adsHH ?? "",
        spfb,
        c.profitLoss ?? "",
      ].join(","))
    })
    const csv = "﻿" + lines.join("\n") // BOM cho Excel mở đúng UTF-8
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `campaigns-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    setSyncMsg(`Đã export ${rows.length} camp ra CSV`)
    setTimeout(() => setSyncMsg(""), 3000)
  }

  async function deleteSelectedCampaigns() {
    if (selected.size === 0) return
    if (deletingCamps) return
    if (!await ask(`Xoá ${selected.size} campaign trên FB Ads Manager?\n\n⚠ Action không thể hoàn tác. Campaign sẽ bị xoá vĩnh viễn cả trên FB lẫn trong app.`, { title: "Xoá campaign", danger: true })) return
    setDeletingCamps(true)
    setSyncMsg(`Dang xoa ${selected.size} camp tren FB...`)
    try {
      const r = await fetch("/api/fb/delete-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignIds: Array.from(selected) }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      // Build message kèm chi tiết lỗi (tên camp + reason) nếu có failed → user biết ngay vì sao
      let msg = `Da xoa ${d.deleted}/${d.requested} camp`
      const failedList = (d.results || []).filter((x:any) => !x.ok)
      if (d.failed > 0) {
        const first = failedList[0]
        const reason = first?.error ? `: "${first.name}" → ${first.error}` : ""
        msg += ` · ${d.failed} lỗi${reason}`
        console.error("[delete-campaign] failed:", failedList)
      }
      setSyncMsg(msg)
      // Remove deleted from local state immediately
      const okIds = new Set(d.results.filter((x:any) => x.ok).map((x:any) => x.id))
      setCampaigns((cs:any) => cs.filter((c:any) => !okIds.has(c.id)))
      setSelected(new Set())
      try { localStorage.setItem("cam_lastCampaigns", JSON.stringify((campaigns as any).filter((c:any) => !okIds.has(c.id)))) } catch {}
      playBeep(d.failed === 0)
      setTimeout(() => setSyncMsg(""), d.failed > 0 ? 12000 : 4000)

      // Auto-fallback: nếu FB từ chối (Permissions / token / camp không tồn tại) → hỏi xoá chỉ trong DB
      if (failedList.length > 0) {
        const failedIds = failedList.map((x:any) => x.id)
        const firstErr = String(failedList[0]?.error || "").toLowerCase()
        const isPermLike = firstErr.includes("permission") || firstErr.includes("không có quyền") || firstErr.includes("oauth") || firstErr.includes("token") || firstErr.includes("(#200)") || firstErr.includes("(#10)")
        const reason = isPermLike ? "FB từ chối do quyền/token" : "FB không xoá được"
        if (await ask(`${reason} ${failedList.length} camp.\n\nXoá CHỈ trong app (không động FB)?\n\n⚠ Camp trên FB Ads Manager VẪN CÒN, nhưng record trong app sẽ bị dọn → tránh báo trùng/hoa hồng ảo.`, { title: "Xoá chỉ trong DB?", danger: true })) {
          try {
            const r2 = await fetch("/api/fb/delete-campaign", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ campaignIds: failedIds, skipFb: true }),
            })
            const d2 = await r2.json()
            if (!r2.ok) throw new Error(d2.error || `HTTP ${r2.status}`)
            const okIds2 = new Set((d2.results || []).filter((x:any) => x.ok).map((x:any) => x.id))
            setCampaigns((cs:any) => cs.filter((c:any) => !okIds2.has(c.id)))
            setSyncMsg(`Đã xoá ${d2.deleted}/${d2.requested} camp khỏi DB (FB không động)`)
            try { localStorage.setItem("cam_lastCampaigns", JSON.stringify((campaigns as any).filter((c:any) => !okIds2.has(c.id) && !okIds.has(c.id)))) } catch {}
            playBeep(true)
            setTimeout(() => setSyncMsg(""), 4000)
          } catch (e:any) {
            setSyncMsg("Lỗi xoá DB: " + (e?.message || "unknown"))
            playBeep(false)
            setTimeout(() => setSyncMsg(""), 6000)
          }
        }
      }
    } catch (e:any) {
      setSyncMsg("Loi: " + (e?.message || "unknown"))
      playBeep(false)
      setTimeout(() => setSyncMsg(""), 5000)
    } finally {
      setDeletingCamps(false)
    }
  }

  function playBeep(success: boolean = true){
    try{
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      if(!AC) return
      const ctx = new AC()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = "sine"
      osc.frequency.value = success ? 880 : 330
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18)
      osc.start(ctx.currentTime)
      osc.stop(ctx.currentTime + 0.2)
      setTimeout(()=>{ try{ ctx.close() }catch{} }, 300)
    }catch{}
  }

  useEffect(()=>{
    const saved = localStorage.getItem("cam_adAccounts")
    const savedSel = localStorage.getItem("cam_selAccount")
    if(saved) try{ setAdAccounts(JSON.parse(saved)); if(savedSel) setSelAccount(savedSel) }catch{}
    // Restore last loaded campaigns from cache so refresh shows correct data instantly,
    // sau đó refetch ngầm để cập nhật commission/profitLoss theo date range hiện tại.
    const cached = localStorage.getItem("cam_lastCampaigns")
    if(cached) try{ const arr = JSON.parse(cached); if(Array.isArray(arr)) setCampaigns(arr) }catch{}
    fetchCampaigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])

  // Refetch khi đổi date range để commission/profitLoss luôn khớp khoảng ngày đang chọn.
  useEffect(()=>{
    if(dateFrom && dateTo) fetchCampaigns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[dateFrom, dateTo])

  // Reset anchor shift+click khi đổi trang / search / filter để tránh chọn nhầm
  useEffect(()=>{ setLastSelIdx(null) },[page, search, tab, sortKey, sortDir, sttF, sttT, advFilter])

  // Silent cleanup camp legacy trùng tên — chạy tự động sau "Tải Campaigns" / "Tải tất cả TK".
  // Không hỏi confirm, không hiện toast trừ khi thực sự xoá gì → user không bị làm phiền.
  async function cleanupDupesSilent() {
    try {
      const r = await fetch("/api/campaigns/cleanup-legacy-dupes", { method: "POST", credentials: "include" })
      const d = await r.json()
      if (r.ok && d.removed > 0) {
        console.log(`[auto-cleanup-dupes] removed ${d.removed} legacy camps, reassigned ${d.reassignedPosts} posts + ${d.reassignedLogs} logs`)
      }
    } catch (e: any) {
      console.warn("[auto-cleanup-dupes] fail (non-blocking):", e?.message || e)
    }
  }

  async function fetchCampaigns(campIds?:string[]){
    setLoading(true)
    const dr = (dateFrom && dateTo) ? `&from=${dateFrom}&to=${dateTo}` : ""
    const url = campIds && campIds.length>0 ? `/api/campaigns?campIds=${encodeURIComponent(campIds.join(","))}${dr}` : `/api/campaigns?_=1${dr}`
    const res=await fetch(url)
    if(res.ok) {
      const data = await res.json()
      setCampaigns(data)
      try{ localStorage.setItem("cam_lastCampaigns", JSON.stringify(data)) }catch{}
    }
    else if(res.status===401) window.location.href="/login"
    setLoading(false)
    // Load orphan commission song song (chỉ khi có date range — endpoint require from/to)
    if (dateFrom && dateTo) {
      try {
        const oRes = await fetch(`/api/campaigns/orphan?from=${dateFrom}&to=${dateTo}`)
        if (oRes.ok) {
          const oData = await oRes.json()
          setOrphan(oData)
        }
      } catch {}
    } else {
      setOrphan(null)
    }
  }

  async function loadCampaigns(){
    if(syncing) return
    if(!selAccount){ setSyncMsg("Vui long chon tai khoan ADS truoc!"); setTimeout(()=>setSyncMsg(""),3000); return }
    setSyncMsg("")
    setSyncing(true)
    const myReqId = ((window as any).__loadReqId = ((window as any).__loadReqId || 0) + 1)
    try{
      const dr = (dateFrom && dateTo) ? `&from=${dateFrom}&to=${dateTo}` : ""
      const cachedIdsRaw = localStorage.getItem("cam_campIds_" + selAccount)
      if(cachedIdsRaw && cachedIdsRaw.length > 0){
        try{
          const cacheRes = await fetch("/api/campaigns?campIds=" + encodeURIComponent(cachedIdsRaw) + dr)
          if(cacheRes.ok && (window as any).__loadReqId === myReqId){
            const cacheData = await cacheRes.json()
            if(Array.isArray(cacheData)) setCampaigns(cacheData)
          }
        }catch{}
      }
      const syncRes = await fetch("/api/fb/sync-metrics", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ accountId: selAccount, dateFrom, dateTo }) })
      if((window as any).__loadReqId !== myReqId) return
      const syncData = await syncRes.json()
      if(!syncRes.ok) throw new Error(syncData.error || "Loi sync")
      // Auto-cleanup camp legacy trùng tên sau khi sync (silent)
      await cleanupDupesSilent()
      // Sau khi sync FB xong, fetch lại từ /api/campaigns để có commission/profitLoss/adsHH
      // overlay từ AffiliateCommissionDaily theo date range.
      const idsArr: string[] = syncData.syncedCampIds || []
      if(idsArr.length > 0){
        const finalRes = await fetch("/api/campaigns?campIds=" + encodeURIComponent(idsArr.join(",")) + dr)
        if((window as any).__loadReqId !== myReqId) return
        if(finalRes.ok){
          const finalData = await finalRes.json()
          if(Array.isArray(finalData)){
            setCampaigns(finalData)
            try{ localStorage.setItem("cam_lastCampaigns", JSON.stringify(finalData)) }catch{}
          }
        }
        localStorage.setItem("cam_campIds_" + selAccount, idsArr.join(","))
      } else {
        const fresh = Array.isArray(syncData.campaigns) ? syncData.campaigns : []
        setCampaigns(fresh)
        try{ localStorage.setItem("cam_lastCampaigns", JSON.stringify(fresh)) }catch{}
      }
      playBeep(true)
    }catch(e:any){
      if((window as any).__loadReqId === myReqId){
        setSyncMsg("Loi: " + e.message); setTimeout(()=>setSyncMsg(""),5000); playBeep(false)
      }
    } finally{
      if((window as any).__loadReqId === myReqId) setSyncing(false)
    }
  }

  // Tải Campaigns cho các TKQC user đã chọn trong picker (parallel cap 3).
  async function loadAllSelectedAccounts(idsOverride?: string[]){
    if(syncing) return
    const ids = idsOverride || Array.from(pickedTkIds)
    const accountsToSync = adAccounts.filter((a:any) => ids.includes(a.id))
    if (accountsToSync.length === 0) {
      setSyncMsg("Chưa chọn TKQC nào — bấm 'Tải tất cả TK' để chọn.")
      setTimeout(()=>setSyncMsg(""), 4000)
      return
    }
    setSyncing(true)
    const myReqId = ((window as any).__loadReqId = ((window as any).__loadReqId || 0) + 1)
    let okCount = 0, totalCamps = 0, failed = 0, doneCount = 0
    const total = accountsToSync.length
    setSyncMsg(`Đang sync 0/${total} TK...`)
    // Concurrency cap 3 — đủ nhanh, không vỡ FB rate limit, không exhaust DB pool
    const CONC = 3

    async function processOne(acc: any) {
      try {
        const r = await fetch("/api/fb/sync-metrics", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ accountId: acc.id, dateFrom, dateTo })
        })
        const d = await r.json()
        if (r.ok && d.ok) {
          okCount++
          totalCamps += d.totalUpdated || 0
        } else {
          failed++
        }
      } catch {
        failed++
      } finally {
        doneCount++
        if ((window as any).__loadReqId === myReqId) {
          setSyncMsg(`Đang sync ${doneCount}/${total} TK · ${totalCamps} camps · ✓ ${okCount}${failed ? ` ✗ ${failed}` : ""}`)
        }
      }
    }

    try {
      // Chia thành nhóm CONC để chạy song song
      for (let i = 0; i < accountsToSync.length; i += CONC) {
        if ((window as any).__loadReqId !== myReqId) return
        const group = accountsToSync.slice(i, i + CONC)
        await Promise.all(group.map(processOne))
      }
      if ((window as any).__loadReqId !== myReqId) return
      // Auto-cleanup camp legacy trùng tên sau khi sync tất cả TK (silent)
      await cleanupDupesSilent()
      await fetchCampaigns()
      setSyncMsg(`✅ Sync xong ${okCount}/${total} TK · ${totalCamps} camps` + (failed > 0 ? ` · ${failed} lỗi` : ""))
      playBeep(failed === 0)
      setTimeout(()=>setSyncMsg(""), 5000)
    } catch(e:any) {
      if ((window as any).__loadReqId === myReqId) {
        setSyncMsg("Lỗi: " + (e?.message || "unknown"))
        setTimeout(()=>setSyncMsg(""), 4000)
        playBeep(false)
      }
    } finally {
      if ((window as any).__loadReqId === myReqId) setSyncing(false)
    }
  }

  async function syncAccounts(){
    if(syncingAccounts) return
    setSyncingAccounts(true); setSyncMsg("Dang dong bo tai khoan FB...")
    try{
      // Lấy TK đã chọn từ DB (field isSelected) thay vì localStorage để sync cross-browser.
      // Fallback: nếu chưa migrate (record cũ chưa có isSelected) → vẫn đọc localStorage để tương thích.
      const res = await fetch("/api/accounts")
      if(!res.ok){ throw new Error("Khong tai duoc danh sach account") }
      const all = await res.json()
      let filtered = all.filter((a:any) => a.isSelected !== false)
      // Fallback localStorage nếu không có TK nào isSelected (data cũ chưa migrate)
      if (filtered.length === 0) {
        try {
          const savedIds:string[] = JSON.parse(localStorage.getItem("selected_accounts")||"[]")
          if (savedIds.length > 0) filtered = all.filter((a:any)=>savedIds.includes(String(a.id)))
        } catch {}
      }
      setAdAccounts(filtered)
      localStorage.setItem("cam_adAccounts", JSON.stringify(filtered))
      if(filtered.length>0){
        setSelAccount(String(filtered[0].id))
        localStorage.setItem("cam_selAccount", String(filtered[0].id))
      }
      setSyncMsg("Da dong bo " + filtered.length + " tai khoan!"); playBeep(true)
      setTimeout(()=>setSyncMsg(""),2500)
    }catch(e:any){
      setSyncMsg("Loi dong bo: " + (e?.message||"unknown")); playBeep(false)
      setTimeout(()=>setSyncMsg(""),4000)
    }finally{
      setSyncingAccounts(false)
    }
  }
  async function toggleCampaignStatus(c:any){
    if(c.status === "err") return
    const newStatus = c.status === "on" ? "off" : "on"
    // optimistic update
    setCampaigns(cs => cs.map(x => x.id===c.id ? {...x, status: newStatus, _toggling: true} : x))
    try{
      const res = await fetch("/api/fb/toggle-status", {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ campId: c.campId, status: newStatus })
      })
      const data = await res.json()
      if(!res.ok) throw new Error(data.error || "Loi cap nhat trang thai")
      setCampaigns(cs => cs.map(x => x.id===c.id ? {...x, status: newStatus, _toggling: false} : x))
      setSyncMsg(newStatus === "on" ? "Da bat camp tren FB" : "Da tat camp tren FB"); playBeep(true)
      setTimeout(()=>setSyncMsg(""), 2000)
    }catch(e:any){
      // rollback
      setCampaigns(cs => cs.map(x => x.id===c.id ? {...x, status: c.status, _toggling: false} : x))
      setSyncMsg("Loi: " + (e?.message||"unknown")); playBeep(false)
      setTimeout(()=>setSyncMsg(""), 4000)
    }
  }

  // Bulk bật/tắt nhiều camp đã chọn — gọi FB API song song.
  async function bulkToggleStatus(targetStatus: "on" | "off") {
    const camps = campaigns.filter((c:any) => selected.has(c.id) && c.status !== "err" && c.status !== targetStatus && c.campId && !c.campId.startsWith("new_"))
    if (camps.length === 0) {
      setSyncMsg(`Không có camp nào cần ${targetStatus === "on" ? "bật" : "tắt"}`)
      setTimeout(() => setSyncMsg(""), 2500)
      return
    }
    setSyncMsg(`Đang ${targetStatus === "on" ? "bật" : "tắt"} ${camps.length} camp trên FB...`)
    // Optimistic: update UI ngay
    setCampaigns(cs => cs.map(x => selected.has(x.id) && x.status !== "err" ? {...x, status: targetStatus, _toggling: true} : x))
    // Gọi parallel với concurrency cap 5 để không vỡ FB rate limit
    let ok = 0, fail = 0
    const failed: string[] = []
    const CONC = 5
    for (let i = 0; i < camps.length; i += CONC) {
      const batch = camps.slice(i, i + CONC)
      const results = await Promise.allSettled(batch.map(async (c:any) => {
        const res = await fetch("/api/fb/toggle-status", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ campId: c.campId, status: targetStatus })
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
        return c.id
      }))
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === "fulfilled") ok++
        else { fail++; failed.push(batch[j].name) }
      }
    }
    // Cập nhật cờ _toggling
    setCampaigns(cs => cs.map(x => selected.has(x.id) ? {...x, _toggling: false} : x))
    if (fail === 0) {
      setSyncMsg(`✅ Đã ${targetStatus === "on" ? "bật" : "tắt"} ${ok}/${camps.length} camp`)
      playBeep(true)
    } else {
      // Rollback các camp lỗi về status cũ
      setSyncMsg(`⚠ ${ok}/${camps.length} OK · ${fail} lỗi: ${failed.slice(0,2).join(", ")}`)
      playBeep(false)
      // Refetch để sync lại UI với DB
      fetchCampaigns()
    }
    setTimeout(() => setSyncMsg(""), 4000)
    setSelected(new Set())
  }

  // Bulk đổi budget cho nhiều camp đã chọn — gọi FB update-budget API parallel.
  async function bulkUpdateBudget(newBudget: number) {
    const camps = campaigns.filter((c:any) => selected.has(c.id) && c.status !== "err" && c.campId && !c.campId.startsWith("new_"))
    if (camps.length === 0) {
      setSyncMsg("Không có camp nào hợp lệ để đổi budget")
      setTimeout(() => setSyncMsg(""), 2500)
      return
    }
    setBulkBudgetSaving(true)
    setSyncMsg(`Đang đổi budget ${camps.length} camp → ${newBudget.toLocaleString("vi-VN")}đ...`)
    // Optimistic update UI
    setCampaigns(cs => cs.map(x => selected.has(x.id) ? {...x, budget: newBudget, _savingBudget: true} : x))
    let ok = 0, fail = 0
    const failed: string[] = []
    const CONC = 5
    for (let i = 0; i < camps.length; i += CONC) {
      const batch = camps.slice(i, i + CONC)
      const results = await Promise.allSettled(batch.map(async (c:any) => {
        const res = await fetch("/api/fb/update-budget", {
          method: "POST",
          headers: {"Content-Type":"application/json"},
          body: JSON.stringify({ campId: c.campId, dailyBudget: newBudget })
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
        return c.id
      }))
      for (let j = 0; j < results.length; j++) {
        const r = results[j]
        if (r.status === "fulfilled") ok++
        else { fail++; failed.push(batch[j].name) }
      }
    }
    setCampaigns(cs => cs.map(x => selected.has(x.id) ? {...x, _savingBudget: false} : x))
    if (fail === 0) {
      setSyncMsg(`✅ Đã đổi budget ${ok}/${camps.length} camp → ${newBudget.toLocaleString("vi-VN")}đ`)
      playBeep(true)
    } else {
      setSyncMsg(`⚠ ${ok}/${camps.length} OK · ${fail} lỗi: ${failed.slice(0,2).join(", ")}`)
      playBeep(false)
      fetchCampaigns()
    }
    setTimeout(() => setSyncMsg(""), 4000)
    setSelected(new Set())
    setShowBulkBudget(false)
    setBulkBudgetSaving(false)
  }

  function openAdd(){setEditItem(null);setForm({name:"",campId:"",status:"on",budget:100000,cpc:0,clicks:0,clickSP:0,spend:0,commission:0,adsHH:0,profitLoss:0});setShowModal(true)}
  function openEdit(c:any){setEditItem(c);setForm({name:c.name,campId:c.campId,status:c.status,budget:c.budget,cpc:c.cpc,clicks:c.clicks,clickSP:c.clickSP,spend:c.spend,commission:c.commission||0,adsHH:c.adsHH||0,profitLoss:c.profitLoss||0});setShowModal(true)}

  async function saveCampaign(){
    if(editItem) await fetch(`/api/campaigns/${editItem.id}`,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)})
    else await fetch("/api/campaigns",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(form)})
    setShowModal(false);fetchCampaigns()
  }

  async function deleteCampaign(id:string){
    if(!await ask("Xoá campaign này?", { danger: true })) return
    await fetch(`/api/campaigns/${id}`,{method:"DELETE"});fetchCampaigns()
  }

  function doSort(k:string){if(sortKey===k)setSortDir(d=>d*-1);else{setSortKey(k);setSortDir(1)}}
  async function saveBudget(id:string){
    const v=parseInt(budgetVal)
    if(!(v>0)){ setEditBudget(null); return }
    const camp = campaigns.find(c=>c.id===id)
    if(!camp){ setEditBudget(null); return }
    const oldBudget = camp.budget
    // Optimistic update
    setCampaigns(cs=>cs.map(c=>c.id===id?{...c,budget:v,_savingBudget:true}:c))
    setEditBudget(null)
    try{
      const res = await fetch("/api/fb/update-budget",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ campId: camp.campId, dailyBudget: v })
      })
      const data = await res.json()
      if(!res.ok) throw new Error(data.error || "Loi cap nhat budget")
      setCampaigns(cs=>cs.map(c=>c.id===id?{...c,budget:v,_savingBudget:false}:c))
      setSyncMsg(`Da cap nhat budget: ${v.toLocaleString("vi-VN")}đ`); playBeep(true)
      setTimeout(()=>setSyncMsg(""),2500)
    }catch(e:any){
      // Rollback
      setCampaigns(cs=>cs.map(c=>c.id===id?{...c,budget:oldBudget,_savingBudget:false}:c))
      setSyncMsg("Loi: "+(e?.message||"unknown")); playBeep(false)
      setTimeout(()=>setSyncMsg(""),4000)
    }
  }

  // Phát hiện campaign trùng tên: extract code dạng R1504N30 / 2912K20 / "R1504N30 - bản sao"
  // → key trùng. Nếu name không match pattern thì fallback normalize (lowercase, bỏ "bản sao",
  // bỏ "(n)", bỏ khoảng trắng).
  const codeRe = /[A-Za-z]?\d{4}[A-Za-z]\d{2,3}/i
  function dupKey(name: string): string {
    const m = (name || "").match(codeRe)
    if (m) return m[0].toUpperCase()
    return (name || "").toLowerCase()
      .replace(/[\s-]*(bản sao|ban sao|copy|sao chép|\(\d+\))[\s-]*/gi, "")
      .replace(/\s+/g, "")
      .trim()
  }
  // PERF (R2.B4): memoize legacyCount + dupCounts + filtered. 3000 camps × mỗi
  // re-render (search keystroke, page change) → trước recompute 3000 × 2 lần
  // (filter + dupKey regex per row). Sau: chỉ compute khi deps đổi.
  const legacyCount = useMemo(() => campaigns.filter(c => !c.adAccountId).length, [campaigns])
  const dupCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of campaigns) {
      if (!c.adAccountId) continue
      const k = dupKey(c.name || "")
      if (k) m[k] = (m[k] || 0) + 1
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns])

  const filtered = useMemo(() => campaigns.filter(c=>{
    // ẨN camp legacy
    if (!c.adAccountId) return false
    if(tab==="on"&&c.status!=="on") return false
    if(tab==="off"&&c.status==="on") return false
    // Filter "Chỉ camp ×2+": chỉ hiện camp có dupCount >= 2 (trùng tên trên 2+ TKQC).
    if(onlyDup) {
      const k = dupKey(c.name || "")
      if (!k || (dupCounts[k] || 0) < 2) return false
    }
    // Filter theo TKQC user đã pick trong modal "Tải tất cả TK".
    // pickedTkIds.size === 0 → chưa pick → hiện tất cả (trừ legacy đã ẩn ở trên).
    // Có pick → STRICT: chỉ hiện camp có adAccountId nằm trong list pick.
    if (pickedTkIds.size > 0 && !pickedTkIds.has(c.adAccountId)) return false
    if(search&&!c.name.toLowerCase().includes(search.toLowerCase())) return false
    if(advFilter.cpcMn&&c.cpc<Number(advFilter.cpcMn)) return false
    if(advFilter.cpcMx&&c.cpc>Number(advFilter.cpcMx)) return false
    if(advFilter.plMn&&(c.profitLoss==null||c.profitLoss/1000<Number(advFilter.plMn))) return false
    if(advFilter.plMx&&(c.profitLoss==null||c.profitLoss/1000>Number(advFilter.plMx))) return false
    if(advFilter.spMn&&(c.spend??0)<Number(advFilter.spMn)) return false
    if(advFilter.spMx&&(c.spend??0)>Number(advFilter.spMx)) return false
    if(advFilter.hhMn&&(c.commission==null||c.commission<Number(advFilter.hhMn))) return false
    if(advFilter.hhMx&&(c.commission==null||c.commission>Number(advFilter.hhMx))) return false
    if(advFilter.ahMn&&(c.adsHH==null||c.adsHH<Number(advFilter.ahMn))) return false
    if(advFilter.ahMx&&(c.adsHH==null||c.adsHH>Number(advFilter.ahMx))) return false
    if(advFilter.sfMn||advFilter.sfMx) {
      const sf = (c.clicks||0)>0 ? ((c.clickSP||0)/c.clicks)*100 : null
      if(advFilter.sfMn && (sf==null || sf<Number(advFilter.sfMn))) return false
      if(advFilter.sfMx && (sf==null || sf>Number(advFilter.sfMx))) return false
    }
    return true
  }).sort((a,b)=>{
    if(!sortKey) return 0
    // Virtual key: spfb = clickSP / clicks × 100. Camp có click=0 → -Infinity (xếp cuối).
    const valOf = (c: any) => {
      if (sortKey === "spfb") {
        const fb = c.clicks || 0
        if (fb === 0) return -Infinity
        return (c.clickSP || 0) / fb
      }
      return c[sortKey] ?? -Infinity
    }
    const va = valOf(a), vb = valOf(b)
    return (va<vb?-1:va>vb?1:0)*sortDir
  }), [campaigns, tab, onlyDup, pickedTkIds, search, advFilter, sortKey, sortDir, dupCounts])

  function applySTT(){
    const f=parseInt(sttF)||1,t=parseInt(sttT)||filtered.length
    setSelected(new Set(filtered.slice(f-1,t).map((c:any)=>c.id)))
  }

  const PER=50
  const tp=Math.max(1,Math.ceil(filtered.length/PER))
  const pageData=filtered.slice((page-1)*PER,page*PER)

  const stColor:Record<string,string>={on:"#2ecc8f",off:"#e84d4d",err:"#f5a623"}
  const stBg:Record<string,string>={on:"rgba(46,204,143,.18)",off:"rgba(232,77,45,.1)",err:"rgba(245,166,35,.1)"}
  const fmt=(n:number)=>"₫"+n.toLocaleString("vi-VN")
  const toggleSel=(id:string)=>setSelected(s=>{const n=new Set(s);n.has(id)?n.delete(id):n.add(id);return n})
  const handleRowClick = (idx: number, c: any, e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('input, button, select, textarea, a, [data-no-row-select]')) return
    if (e.shiftKey && lastSelIdx !== null) {
      e.preventDefault()
      try { window.getSelection()?.removeAllRanges() } catch {}
      const start = Math.min(lastSelIdx, idx)
      const end = Math.max(lastSelIdx, idx)
      const ids: string[] = []
      for (let k = start; k <= end; k++) { const row = pageData[k]; if (row) ids.push(row.id) }
      setSelected(new Set(ids))
    } else if (e.ctrlKey || e.metaKey) {
      toggleSel(c.id)
      setLastSelIdx(idx)
    } else {
      setSelected(new Set([c.id]))
      setLastSelIdx(idx)
    }
  }

  const SH={padding:"8px 12px",textAlign:"right" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".5px",borderBottom:"1px solid var(--border)",whiteSpace:"nowrap" as const,cursor:"pointer"}
  const SHL={...SH,textAlign:"left" as const}
  const TD={padding:"10px 12px",borderBottom:"1px solid var(--border)",verticalAlign:"middle" as const,textAlign:"right" as const}
  const TDL={...TD,textAlign:"left" as const}
  const inp={background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:12,fontFamily:"inherit",padding:"0 10px",outline:"none",height:34,width:"100%",boxSizing:"border-box"} as React.CSSProperties
  const lbl={fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase",letterSpacing:".5px",marginBottom:4,display:"block"} as React.CSSProperties
  const fields:[string,string,string][]=[["Tên Campaign","name","text"],["Camp ID","campId","text"],["Budget","budget","number"],["CPC","cpc","number"],["Clicks","clicks","number"],["Click SP","clickSP","number"],["Spend","spend","number"],["Commission","commission","number"],["Ads HH (%)","adsHH","number"],["Lãi/Lỗ","profitLoss","number"]]
  const SH2={height:28,fontSize:11,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,color:"var(--text)",padding:"0 8px",outline:"none"}

  return (
    <AppLayout>
      <style>{`@keyframes qlc-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div className="row-actions" style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap" as const,gap:6}}>
        <div className="page-title" style={{fontSize:16,fontWeight:600}}>Quản lý Campaign</div>
        <div className="row-actions" style={{display:"flex",gap:6}}>
          <button onClick={async()=>{
            if (!await ask(`Xoá toàn bộ ${campaigns.length} campaign khỏi DB?\n\n⚠ KHÔNG ảnh hưởng camp trên Facebook. Sau khi xoá, bấm "Tải Campaigns" để load lại từ FB.`,{title:"Xoá data Ads",danger:true})) return
            try {
              const r = await fetch("/api/campaigns/clear-all", { method:"POST", credentials:"include", headers: { "x-confirm": "yes" } })
              const d = await r.json()
              if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
              setSyncMsg(d.message || `Đã xoá ${d.deleted} camp`)
              setCampaigns([])
              try { localStorage.removeItem("cam_lastCampaigns") } catch {}
              setTimeout(()=>setSyncMsg(""), 3500)
            } catch(e:any) {
              setSyncMsg("❌ " + (e?.message||"Lỗi"))
              setTimeout(()=>setSyncMsg(""), 5000)
            }
          }} disabled={syncingAccounts||syncing} title="Xoá toàn bộ data Campaign khỏi DB (không động đến FB)" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:(syncingAccounts||syncing)?"not-allowed":"pointer",border:"1px solid rgba(232,77,45,.4)",fontFamily:"inherit",fontWeight:500,background:"rgba(232,77,45,.08)",color:"var(--danger)",height:30,whiteSpace:"nowrap" as const,opacity:(syncingAccounts||syncing)?0.6:1}}>
            🗑 Xoá data Ads
          </button>
          <button onClick={async()=>{
            if (!await ask(`Reset HOA HỒNG (commission + đơn) trong VÒNG 30 NGÀY GẦN ĐÂY về 0?\n\n✅ GIỮ NGUYÊN data Click SP.\n🔒 Đơn hàng cũ hơn 30 ngày được BẢO VỆ — không bị xoá.\n⚠ KHÔNG ảnh hưởng đến Shopee. Sau khi reset, upload CSV hoặc Sync TK để có data hoa hồng mới.`,{title:"Xoá data Hoa hồng (rolling 30d)",danger:true})) return
            try {
              const r = await fetch("/api/affiliate/clear-all", {
                method:"POST", credentials:"include",
                headers:{"Content-Type":"application/json","x-confirm":"yes"},
                body: JSON.stringify({ shopeeAccountId: selectedShopeeId || null, type: "commission" }),
              })
              const d = await r.json()
              if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
              setAffiliateMsg(d.message || `Đã reset ${d.updated} bản ghi`)
              await fetchCampaigns()
              setTimeout(()=>setAffiliateMsg(""), 4000)
            } catch(e:any) {
              setAffiliateMsg("❌ " + (e?.message||"Lỗi"))
              setTimeout(()=>setAffiliateMsg(""), 5000)
            }
          }} disabled={syncingAccounts||syncing||affiliateImporting} title={selectedShopeeId ? "Reset HOA HỒNG về 0 cho TK Shopee đã chọn (giữ Click SP)" : "Reset HOA HỒNG về 0 toàn bộ user (giữ Click SP)"} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:(syncingAccounts||syncing||affiliateImporting)?"not-allowed":"pointer",border:"1px solid rgba(238,77,45,.4)",fontFamily:"inherit",fontWeight:500,background:"rgba(238,77,45,.08)",color:"#ee4d2d",height:30,whiteSpace:"nowrap" as const,opacity:(syncingAccounts||syncing||affiliateImporting)?0.6:1}}>
            🗑 Xoá data Hoa hồng
          </button>
          <button onClick={async()=>{
            if (!await ask(`Reset CLICK SP trong VÒNG 30 NGÀY GẦN ĐÂY về 0?\n\n✅ GIỮ NGUYÊN data Hoa hồng + đơn.\n🔒 Click cũ hơn 30 ngày được BẢO VỆ — không bị xoá.\nSau khi reset, upload lại file Click để có data fresh.`,{title:"Xoá data Click SP (rolling 30d)",danger:true})) return
            try {
              const r = await fetch("/api/affiliate/clear-all", {
                method:"POST", credentials:"include",
                headers:{"Content-Type":"application/json","x-confirm":"yes"},
                body: JSON.stringify({ shopeeAccountId: selectedShopeeId || null, type: "click" }),
              })
              const d = await r.json()
              if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
              setAffiliateMsg(d.message || `Đã reset ${d.updated} bản ghi`)
              await fetchCampaigns()
              setTimeout(()=>setAffiliateMsg(""), 4000)
            } catch(e:any) {
              setAffiliateMsg("❌ " + (e?.message||"Lỗi"))
              setTimeout(()=>setAffiliateMsg(""), 5000)
            }
          }} disabled={syncingAccounts||syncing||affiliateImporting} title={selectedShopeeId ? "Reset CLICK SP về 0 cho TK Shopee đã chọn (giữ Hoa hồng)" : "Reset CLICK SP về 0 toàn bộ user (giữ Hoa hồng)"} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:(syncingAccounts||syncing||affiliateImporting)?"not-allowed":"pointer",border:"1px solid rgba(255,165,0,.4)",fontFamily:"inherit",fontWeight:500,background:"rgba(255,165,0,.08)",color:"#ffa500",height:30,whiteSpace:"nowrap" as const,opacity:(syncingAccounts||syncing||affiliateImporting)?0.6:1}}>
            🗑 Xoá data Click SP
          </button>
          <button onClick={syncAccounts} disabled={syncingAccounts} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 13px",borderRadius:6,fontSize:11,cursor:syncingAccounts?"not-allowed":"pointer",border:"1px solid rgba(79,126,248,.3)",fontFamily:"inherit",fontWeight:500,background:"rgba(79,126,248,.1)",color:"var(--pill-text)",height:30,whiteSpace:"nowrap" as const,opacity:syncingAccounts?0.65:1}}>
            {syncingAccounts ? "⏳ Đang đồng bộ..." : "🔄 Đồng bộ FB"}
          </button>
        </div>
      </div>

      {/* Config card */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
        <div className="row-config row-toolbar" style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-end",flexWrap:"wrap" as const}}>
          <div style={{display:"flex",flexDirection:"column" as const,gap:3,flex:1,minWidth:180}}>
            <div style={{fontSize:9,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".4px"}}>Tài khoản Ads</div>
            <select value={selAccount} onChange={e=>setSelAccount(e.target.value)} style={{...SH2,width:"100%"}}>{adAccounts.length===0?<option value="">-- Bấm Đồng bộ FB --</option>:adAccounts.map(a=><option key={a.id} value={String(a.id)}>{a.name} ({a.accountId})</option>)}</select>
          </div>
          <div style={{display:"flex",flexDirection:"column" as const,gap:3}}>
            <div style={{fontSize:9,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".4px"}}>Khoảng ngày</div>
            <DateRangePickerVN
              from={dateFrom}
              to={dateTo}
              max={yesterdayStr}
              min={DATA_LOCK_DATE}
              onChange={(f, t) => { setDateFrom(f); setDateTo(t > yesterdayStr ? yesterdayStr : t) }}
              align="left"
              width={290}
            />
          </div>
          <button onClick={loadCampaigns} disabled={syncing} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:syncing?"not-allowed":"pointer",border:"none",fontFamily:"inherit",fontWeight:500,background:"var(--success)",color:"#fff",height:28,whiteSpace:"nowrap" as const,opacity:syncing?0.7:1,transition:"opacity .15s"}}>
            {syncing ? (
              <span style={{display:"inline-block",width:11,height:11,border:"2px solid #fff",borderTopColor:"transparent",borderRadius:"50%",animation:"qlc-spin 0.7s linear infinite"}}/>
            ) : (
              <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 8A6 6 0 112 8"/><path d="M11 5l3 3-3 3"/></svg>
            )}
            {syncing?"Đang tải...":"Tải Campaigns"}
          </button>
          <button onClick={()=>{ setPickedTkIds(new Set(adAccounts.map((a:any)=>a.id))); setShowTkPicker(true) }} disabled={syncing} title="Chọn nhiều TKQC để tải Campaigns cùng lúc" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:syncing?"not-allowed":"pointer",border:"1px solid rgba(155,89,182,.4)",fontFamily:"inherit",fontWeight:500,background:"rgba(155,89,182,.12)",color:"#9b59b6",height:28,whiteSpace:"nowrap" as const,opacity:syncing?0.65:1}}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a8 8 0 010 12"/></svg>
            🌐 Tải tất cả TK
          </button>
          {selected.size > 0 && (
            <button onClick={deleteSelectedCampaigns} disabled={deletingCamps} title="Xoá những camp đã tick trên FB Ads Manager" style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:deletingCamps?"not-allowed":"pointer",border:"1px solid rgba(232,77,45,.4)",fontFamily:"inherit",fontWeight:600,background:"rgba(232,77,45,.12)",color:"var(--danger)",height:28,whiteSpace:"nowrap" as const,opacity:deletingCamps?0.65:1}}>
              {deletingCamps ? "⏳ Đang xoá..." : `🗑 Xoá ${selected.size} camp`}
            </button>
          )}
          <label style={{display:"inline-flex",alignItems:"center",gap:5,padding:"0 11px",borderRadius:6,fontSize:11,cursor:"pointer",border:"1px solid rgba(245,166,35,.3)",fontFamily:"inherit",fontWeight:500,background:"rgba(245,166,35,.1)",color:"var(--warn)",height:28,whiteSpace:"nowrap" as const}}>
            📤 Upload Click
            <input type="file" accept=".csv,.xlsx,.xls" disabled={affiliateImporting} onChange={handleClickUpload} style={{display:"none"}} />
          </label>
        </div>
        <div className="row-toolbar" style={{display:"flex",alignItems:"center",gap:8,padding:"8px 14px",background:"rgba(238,77,45,.05)",borderTop:"1px solid rgba(238,77,45,.12)",flexWrap:"wrap" as const}}>
          <div style={{width:24,height:24,borderRadius:5,background:"#ee4d2d",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:"#fff",flexShrink:0}}>S</div>
          <div style={{flex:1,minWidth:200}}>
            <div style={{fontSize:11,fontWeight:600}}>Shopee Affiliate</div>
            <div style={{fontSize:9.5,color:"var(--muted)",marginTop:1}}>
              {shopeeAccounts.length > 0
                ? `${shopeeAccounts.length} account: ${shopeeAccounts.map(a=>a.name).join(", ")}`
                : "Import CSV/XLSX để tổng hợp commission"}
            </div>
          </div>
          {affiliateMsg ? <span style={{fontSize:10,color:"var(--muted)",marginRight:8}}>{affiliateMsg}</span> : null}
          {shopeeAccounts.length > 0 && (
            <select value={selectedShopeeId} onChange={e => setSelectedShopeeId(e.target.value)} title="Chọn TK Shopee để gán cho file upload" style={{height:24,fontSize:10,background:"var(--bg3)",border:"1px solid rgba(238,77,45,.3)",borderRadius:4,color:"var(--text)",padding:"0 6px",outline:"none",maxWidth:140}}>
              <option value="">-- Chọn TK Shopee --</option>
              {shopeeAccounts.map((a:any)=>(<option key={a.id} value={a.id}>{a.name}</option>))}
            </select>
          )}
          <button onClick={()=>{setShopeeForm({id:"",name:"",appId:"",apiKey:""});setShopeeCfgErr("");setShowShopeeCfg(true)}} style={{display:"inline-flex",alignItems:"center",gap:4,border:"1px solid rgba(238,77,45,.35)",borderRadius:4,padding:"3px 9px",fontSize:10,color:"#ee4d2d",cursor:"pointer",background:"transparent"}}>
            ⚙ Quản lý API ({shopeeAccounts.length})
          </button>
          {shopeeAccounts.length > 0 && (
            <button
              onClick={async () => {
                if (shopeeApiSyncing) return
                setShopeeApiSyncing(true)
                toast.show("⏳ Đang sync Shopee Open API (1-2 phút)...", "info" as any)
                try {
                  const r = await fetch("/api/shopee-aff/sync-from-api", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ daysBack: 7 }),
                  })
                  const d = await r.json()
                  if (!r.ok) throw new Error(d?.error || "HTTP " + r.status)
                  const s = d.summary
                  const failed = s.failedTokens
                  const msg = `✅ Sync ${s.totalOrdersUpserted} đơn (${s.totalConversions} fetched) từ ${s.totalTokens - failed}/${s.totalTokens} TK`
                  toast.show(msg, failed > 0 ? "warn" as any : "success" as any)
                  if (failed > 0) {
                    const errs = (d.results || []).filter((x: any) => !x.ok).map((x: any) => `${x.tokenName}: ${x.error}`)
                    console.warn("[Shopee API sync] errors:", errs)
                  }
                  loadCampaigns()
                } catch (e: any) {
                  toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
                } finally { setShopeeApiSyncing(false) }
              }}
              disabled={shopeeApiSyncing}
              title="Sync hoa hồng + đơn từ Shopee Open API (7 ngày gần đây). Chạy auto 7:30 sáng mỗi ngày."
              style={{display:"inline-flex",alignItems:"center",gap:4,border:"1px solid rgba(46,204,143,.4)",borderRadius:4,padding:"3px 9px",fontSize:10,color:"var(--success)",cursor:shopeeApiSyncing?"wait":"pointer",background:"transparent",opacity:shopeeApiSyncing?0.6:1}}
            >
              {shopeeApiSyncing ? "⏳" : "🔄"} Sync API
            </button>
          )}
          {shopeeAccounts.length > 0 && (
            <button
              onClick={clearManualForSelectedShopee}
              disabled={!selectedShopeeId}
              title={!selectedShopeeId ? "Chọn TK Shopee trước" : "Xoá data CSV upload cho TK đã chọn"}
              style={{display:"inline-flex",alignItems:"center",gap:4,border:"1px solid rgba(232,77,45,.4)",borderRadius:4,padding:"3px 9px",fontSize:10,color:"var(--danger)",cursor:!selectedShopeeId?"not-allowed":"pointer",background:"transparent",opacity:!selectedShopeeId?0.4:1}}
            >
              🧹 Xoá CSV upload
            </button>
          )}
          <label style={{display:"flex",alignItems:"center",gap:4,border:"1px dashed rgba(238,77,45,.35)",borderRadius:4,padding:"3px 9px",fontSize:10,color:"#ee4d2d",cursor:"pointer"}}>
            <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v8M4 8l4-4 4 4M2 13h12"/></svg>
            Chọn file
            <input type="file" accept=".csv,.xlsx,.xls" disabled={affiliateImporting} onChange={handleAffiliateUpload} style={{display:"none"}} />
          </label>
        </div>
      </div>

      {/* Table card */}
      <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"}}>
        {/* Filter row */}
        <div style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",display:"flex",gap:8,alignItems:"center",flexWrap:"wrap" as const}}>
          <span style={{fontSize:13,fontWeight:700}}>⚡ {campaigns.length} Campaigns</span>
          <div style={{display:"flex",background:"var(--bg3)",borderRadius:5,padding:2,gap:1}}>
            {(["all","on","off"] as const).map(v=>{
              const label = v==="all"?"Tất cả":v==="on"?"Bật":"Tắt"
              return (
                <button key={v} onClick={()=>{setTab(v);setPage(1)}} style={{padding:"3px 10px",borderRadius:3,fontSize:11,color:tab===v?"var(--text)":"var(--muted)",cursor:"pointer",border:"none",background:tab===v?"var(--bg2)":"transparent",fontFamily:"inherit",fontWeight:tab===v?500:400}}>{label}</button>
              )
            })}
          </div>
          {/* Filter camp trùng tên trên 2+ TKQC (có badge ×2 trở lên) */}
          {(() => {
            const dupCampCount = Object.values(dupCounts).filter(n => n >= 2).reduce((s, n) => s + n, 0)
            if (dupCampCount === 0 && !onlyDup) return null
            return (
              <button
                onClick={()=>{setOnlyDup(v=>!v);setPage(1)}}
                title="Hiện chỉ những camp bị trùng tên trên 2+ TKQC (badge ×N). Click lần nữa để bỏ filter."
                style={{padding:"3px 10px",borderRadius:5,fontSize:11,color:onlyDup?"#fff":"#e84d4d",cursor:"pointer",border:`1px solid ${onlyDup?"#e84d4d":"rgba(232,77,45,.4)"}`,background:onlyDup?"#e84d4d":"rgba(232,77,45,.08)",fontFamily:"inherit",fontWeight:600}}
              >
                {onlyDup ? "✓ " : ""}Camp ×2+ ({dupCampCount})
              </button>
            )
          })()}
          <div style={{position:"relative" as const,maxWidth:160}}>
            <svg style={{position:"absolute",left:7,top:"50%",transform:"translateY(-50%)",pointerEvents:"none" as const}} width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--muted)" strokeWidth="1.5"><circle cx="6.5" cy="6.5" r="4"/><path d="M11 11l3 3"/></svg>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Lọc tên..." style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,color:"var(--text)",fontSize:11,fontFamily:"inherit",padding:"5px 8px 5px 24px",outline:"none",width:"100%",height:28}} />
          </div>
          <span style={{fontSize:10,color:"var(--muted)"}}>{filtered.length} kết quả</span>
          {legacyCount > 0 && (
            <span title="Camp legacy chưa có TKQC track. Đã được auto cleanup sau Tải Campaigns." style={{fontSize:10,color:"#9b59b6",background:"rgba(155,89,182,.1)",padding:"2px 6px",borderRadius:3,fontWeight:500}}>
              🧹 Đã ẩn {legacyCount} camp legacy
            </span>
          )}
          {orphan && orphan.total > 0 && (
            <span onClick={()=>setShowOrphan(true)} title="HH có subId2 không match camp nào đang hiển thị (camp legacy ẩn hoặc đã xoá). Click xem chi tiết." style={{fontSize:10,color:"#f5a623",background:"rgba(245,166,35,.12)",padding:"2px 7px",borderRadius:3,fontWeight:600,cursor:"pointer",border:"1px solid rgba(245,166,35,.4)"}}>
              📌 {orphan.total.toLocaleString("vi-VN")}đ HH chưa gán camp ({orphan.items.length} mã)
            </span>
          )}
          <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:5,fontSize:11,color:"var(--muted)"}}>
            Từ STT
            <input type="number" value={sttF} onChange={e=>setSttF(e.target.value)} placeholder="1" style={{width:46,height:24,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,color:"var(--text)",fontSize:11,textAlign:"center" as const,outline:"none",padding:"0 4px"}} />
            –
            <input type="number" value={sttT} onChange={e=>setSttT(e.target.value)} placeholder="10" style={{width:46,height:24,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:4,color:"var(--text)",fontSize:11,textAlign:"center" as const,outline:"none",padding:"0 4px"}} />
            <button onClick={applySTT} style={{display:"inline-flex",alignItems:"center",padding:"0 7px",borderRadius:4,fontSize:10,cursor:"pointer",border:"none",background:"var(--accent)",color:"#fff",fontFamily:"inherit",height:22}}>Chọn</button>
            <button onClick={()=>setSelected(new Set())} style={{display:"inline-flex",alignItems:"center",padding:"0 7px",borderRadius:4,fontSize:10,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit",height:22}}>Bỏ</button>
          </div>
        </div>

        {/* Advanced filter toggle */}
        <div onClick={()=>setShowAdv(v=>!v)} style={{padding:"6px 12px",borderBottom:"1px solid var(--border)",fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".5px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,userSelect:"none" as const}}>
          ⚡ Lọc nâng cao <span>{showAdv?"▾":"▸"}</span>
        </div>
        {showAdv&&(
          <div style={{padding:"8px 12px 10px",borderBottom:"1px solid var(--border)",display:"flex",gap:12,flexWrap:"wrap" as const,alignItems:"flex-end"}}>
            {(() => {
              // Format số có dấu chấm khi gõ. Cho phép '-' để filter Lãi/Lỗ âm.
              const fmtInput = (raw: string): string => {
                if (!raw) return ""
                const isNeg = raw.startsWith("-")
                const digits = raw.replace(/[^0-9]/g, "")
                if (!digits) return isNeg ? "-" : ""
                return (isNeg ? "-" : "") + Number(digits).toLocaleString("vi-VN")
              }
              const parseInput = (s: string): string => {
                // Cho phép '-' đầu (số âm), strip mọi ký tự khác trừ digits
                const isNeg = s.startsWith("-")
                const digits = s.replace(/[^0-9]/g, "")
                if (!digits) return isNeg && s === "-" ? "-" : ""
                return (isNeg ? "-" : "") + digits
              }
              const inpStyle = {width:74,height:28,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:5,color:"var(--text)",fontSize:11,padding:"0 7px",outline:"none",fontFamily:"inherit"} as React.CSSProperties
              return [["CPC (đ)","cpcMn","cpcMx"],["Chi phí (đ)","spMn","spMx"],["Hoa hồng (đ)","hhMn","hhMx"],["ADS/HH (%)","ahMn","ahMx"],["SP/FB (%)","sfMn","sfMx"],["Lãi/Lỗ (K)","plMn","plMx"]].map(([l,mn,mx])=>(
                <div key={l} style={{display:"flex",flexDirection:"column" as const,gap:3}}>
                  <div style={{fontSize:9.5,color:"var(--muted)"}}>{l}</div>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Min"
                      value={fmtInput((advFilter as any)[mn])}
                      onChange={e=>setAdvFilter(f=>({...f,[mn]:parseInput(e.target.value)}))}
                      style={inpStyle}
                    />
                    <span style={{fontSize:10,color:"var(--muted)"}}>—</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Max"
                      value={fmtInput((advFilter as any)[mx])}
                      onChange={e=>setAdvFilter(f=>({...f,[mx]:parseInput(e.target.value)}))}
                      style={inpStyle}
                    />
                  </div>
                </div>
              ))
            })()}
            <button onClick={()=>setAdvFilter({cpcMn:"",cpcMx:"",plMn:"",plMx:"",spMn:"",spMx:"",hhMn:"",hhMx:"",ahMn:"",ahMx:"",sfMn:"",sfMx:""})} style={{display:"inline-flex",alignItems:"center",padding:"0 7px",borderRadius:4,fontSize:10,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit",height:22,alignSelf:"flex-end" as const}}>✕ Xoá</button>
          </div>
        )}

        {/* Toolbar — BỎ NÚT THÊM */}
        <div style={{padding:"6px 12px",borderBottom:"1px solid var(--border)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div style={{display:"flex",alignItems:"center",gap:7,fontSize:11,color:"var(--muted)"}}>
            <input type="checkbox" checked={filtered.length>0 && filtered.every((c:any)=>selected.has(c.id))} onChange={e=>setSelected(s=>{const n=new Set(s); if(e.target.checked) filtered.forEach((c:any)=>n.add(c.id)); else filtered.forEach((c:any)=>n.delete(c.id)); return n})} style={{width:20,height:20,accentColor:"var(--accent)",cursor:"pointer"}} />
            <span onClick={()=>setSelected(s=>{const n=new Set(s); filtered.forEach((c:any)=>n.add(c.id)); return n})} style={{cursor:"pointer",color:"var(--accent)"}}>Tất cả</span>
            <span onClick={()=>setSelected(s=>{const n=new Set(s); filtered.forEach((c:any)=>n.delete(c.id)); return n})} style={{cursor:"pointer",color:"var(--accent)"}}>Bỏ chọn</span>
          </div>
          <button onClick={exportToCsv} title={selected.size > 0 ? `Export ${selected.size} camp đã chọn ra CSV` : `Export ${filtered.length} camp đang lọc ra CSV`} style={{display:"inline-flex",alignItems:"center",gap:4,padding:"5px 10px",borderRadius:5,fontSize:11,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit",height:28}}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v8M5 8l3 3 3-3M2 13h12"/></svg>
            Export {selected.size > 0 ? `(${selected.size})` : ""}
          </button>
        </div>

        {selected.size>0&&(
          <div style={{padding:"5px 12px",background:"rgba(79,126,248,.07)",borderBottom:"1px solid rgba(79,126,248,.13)",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontSize:11,color:"var(--pill-text)",fontWeight:500}}>{selected.size} đã chọn</span>
            <div style={{display:"flex",gap:5}}>
              <button onClick={()=>bulkToggleStatus("on")} title="Bật trên FB tất cả camp đã chọn" style={{padding:"2px 9px",borderRadius:4,fontSize:11,cursor:"pointer",border:"1px solid rgba(46,204,143,.3)",background:"rgba(46,204,143,.08)",color:"var(--success)",fontFamily:"inherit",fontWeight:500}}>▶ Bật</button>
              <button onClick={()=>bulkToggleStatus("off")} title="Tắt trên FB tất cả camp đã chọn" style={{padding:"2px 9px",borderRadius:4,fontSize:11,cursor:"pointer",border:"1px solid rgba(245,166,35,.3)",background:"rgba(245,166,35,.08)",color:"var(--warn)",fontFamily:"inherit",fontWeight:500}}>⏸ Tắt</button>
              <button onClick={()=>{
                // Lấy budget của camp đầu tiên đã chọn làm mặc định
                const firstCamp = campaigns.find((c:any) => selected.has(c.id))
                if (firstCamp) setBulkBudgetValue(firstCamp.budget || 100000)
                setShowBulkBudget(true)
              }} title="Đổi budget tất cả camp đã chọn" style={{padding:"2px 9px",borderRadius:4,fontSize:11,cursor:"pointer",border:"1px solid rgba(79,126,248,.3)",background:"rgba(79,126,248,.08)",color:"var(--accent)",fontFamily:"inherit",fontWeight:500}}>💰 Đổi budget</button>
            </div>
          </div>
        )}

        <div className="tbl-wrap" style={{overflowX:"auto" as const, WebkitOverflowScrolling: "touch" as const}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12, minWidth: 1100}}>
            <colgroup>
              <col style={{width:28}}/><col style={{width:32}}/><col style={{width:150}}/><col style={{width:60}}/><col style={{width:92}}/><col style={{width:100}}/><col style={{width:58}}/><col style={{width:58}}/><col style={{width:52}}/><col style={{width:88}}/><col style={{width:78}}/><col style={{width:65}}/><col style={{width:65}}/><col style={{width:78}}/>
            </colgroup>
            <thead>
              <tr style={{background:"var(--bg3)"}}>
                <th style={SHL}><input type="checkbox" checked={pageData.length>0 && pageData.every((c:any)=>selected.has(c.id))} onChange={e=>setSelected(s=>{const n=new Set(s); if(e.target.checked) pageData.forEach((c:any)=>n.add(c.id)); else pageData.forEach((c:any)=>n.delete(c.id)); return n})} style={{width:20,height:20,accentColor:"var(--accent)",cursor:"pointer"}} /></th>
                <th style={{...SHL,cursor:"pointer"}} onClick={()=>doSort("id")}>STT {sortKey==="id"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SHL,cursor:"pointer"}} onClick={()=>doSort("name")}>CAMPAIGN {sortKey==="name"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={SHL}>TRẠNG THÁI</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("budget")}>NS/NGÀY {sortKey==="budget"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={SH}>ĐỔI BUDGET</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("cpc")}>CPC {sortKey==="cpc"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("clicks")}>CLICK FB {sortKey==="clicks"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("clickSP")}>CLICK SP {sortKey==="clickSP"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("spend")}>CHI PHÍ {sortKey==="spend"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("commission")}>HOA HỒNG {sortKey==="commission"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("adsHH")}>ADS/HH {sortKey==="adsHH"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} title="Click SP / Click FB × 100% — tỉ lệ chuyển đổi click sang Shopee" onClick={()=>doSort("spfb")}>SP/FB {sortKey==="spfb"?sortDir>0?"↑":"↓":"↕"}</th>
                <th style={{...SH,cursor:"pointer"}} onClick={()=>doSort("profitLoss")}>LÃI/LỖ {sortKey==="profitLoss"?sortDir>0?"↑":"↓":"↕"}</th>
              </tr>
            </thead>
            <tbody>
              {loading?(
                <tr><td colSpan={14} style={{padding:32,textAlign:"center",color:"var(--muted)"}}>Đang tải...</td></tr>
              ):pageData.length===0?(
                <tr><td colSpan={14} style={{padding:32,textAlign:"center",color:"var(--muted)"}}>Chưa có campaign nào</td></tr>
              ):pageData.map((c,i)=>(
                <tr key={c.id} onClick={(e)=>handleRowClick(i, c, e)} onMouseDown={(e)=>{ if(e.shiftKey) e.preventDefault() }} style={{background:selected.has(c.id)?"rgba(79,126,248,.05)":"transparent",cursor:"pointer",userSelect:"none" as const}}>
                  <td style={TDL}><input type="checkbox" checked={selected.has(c.id)} onChange={()=>toggleSel(c.id)} onClick={(e)=>e.stopPropagation()} style={{width:20,height:20,accentColor:"var(--accent)",cursor:"pointer"}} /></td>
                  <td style={{...TDL,color:"var(--muted)"}}>{(page-1)*PER+i+1}</td>
                  <td style={TDL} data-no-row-select="true">
                    <div style={{display:"flex",alignItems:"center",gap:5,overflow:"hidden"}}>
                      <div style={{fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:11,cursor:"pointer",flex:1,minWidth:0}} title={c.name} onClick={()=>{navigator.clipboard.writeText(c.name);setSyncMsg("Đã copy: "+c.name.substring(0,30));setTimeout(()=>setSyncMsg(""),2000)}}>{c.name}</div>
                      {(() => { const k = dupKey(c.name||""); const n = k ? (dupCounts[k]||0) : 0; return n > 1 ? (
                        <span title={`Trùng tên với ${n-1} campaign khác`} style={{flexShrink:0,fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:3,background:"rgba(245,166,35,.18)",color:"var(--warn)",border:"1px solid rgba(245,166,35,.35)"}}>×{n}</span>
                      ) : null })()}
                    </div>
                    <div style={{fontSize:9,color:"var(--muted)",fontFamily:"monospace",marginTop:2}}>{c.campId}</div>
                    {(c as any).adAccountName && (
                      <div style={{fontSize:9,color:"var(--muted)",marginTop:1}} title="Tài khoản quảng cáo">📊 {(c as any).adAccountName}</div>
                    )}
                  </td>
                  <td style={TDL} data-no-row-select="true">
                    <div onClick={()=>toggleCampaignStatus(c)} style={{position:"relative",width:40,height:20,cursor:"pointer",display:"inline-block"}}>
                      <div style={{position:"absolute",inset:0,borderRadius:10,background:stBg[c.status]||stBg.off,border:`1px solid ${stColor[c.status]||"#888"}60`}} />
                      <div style={{position:"absolute",top:"50%",transform:"translateY(-50%)",fontSize:8.5,fontWeight:700,color:stColor[c.status]||"#888",...(c.status==="on"?{right:4}:{left:4})}}>
                        {c.status==="on"?"Bật":c.status==="err"?"Lỗi":"Tắt"}
                      </div>
                    </div>
                  </td>
                  <td style={TD}>{fmt(c.budget||0)}</td>
                  <td style={TD} data-no-row-select="true">
                    {editBudget===c.id?(
                      <div style={{display:"flex",alignItems:"center",gap:3,justifyContent:"flex-end"}}>
                        <input autoFocus type="text" inputMode="numeric" value={budgetVal ? Number(budgetVal).toLocaleString("vi-VN") : ""} onChange={e=>setBudgetVal(e.target.value.replace(/\D/g, ""))} onKeyDown={e=>{if(e.key==="Enter")saveBudget(c.id);else if(e.key==="Escape")setEditBudget(null)}} onBlur={()=>setEditBudget(null)} style={{width:84,textAlign:"right" as const,height:22,fontSize:11,background:"var(--bg3)",border:"1px solid var(--accent)",borderRadius:4,color:"var(--text)",padding:"0 6px",outline:"none"}} />
                        <button onMouseDown={e=>e.preventDefault()} onClick={()=>saveBudget(c.id)} style={{height:22,padding:"0 7px",fontSize:10,background:"var(--accent)",color:"#fff",border:"none",borderRadius:3,cursor:"pointer",fontWeight:500}}>Lưu</button>
                      </div>
                    ):(
                      <span onClick={()=>{setEditBudget(c.id);setBudgetVal("100000")}} style={{cursor:"pointer",color:"var(--accent)",fontSize:11}} title="Click để sửa">100.000</span>
                    )}
                  </td>
                  <td style={TD}>{c.cpc||0}đ</td>
                  <td style={TD}>{(c.clicks||0).toLocaleString("vi-VN")}</td>
                  <td style={{...TD,color:"var(--muted)"}}>{c.clickSP||0}</td>
                  <td style={{...TD,color:"var(--danger)",fontWeight:500}}>{fmt(c.spend||0)}</td>
                  <td style={{...TD,color:"#ee4d2d",fontWeight:500}}>{c.commission?fmt(c.commission):<span style={{color:"var(--muted)"}}>—</span>}</td>
                  <td style={TD}>{c.adsHH?<span style={{color:c.adsHH>110?"var(--danger)":c.adsHH>=66?"var(--warn)":"var(--success)",fontWeight:500}}>{c.adsHH>999?">999":c.adsHH}%</span>:<span style={{color:"var(--muted)"}}>—</span>}</td>
                  <td style={TD}>{(()=>{
                    const fb = c.clicks||0
                    const sp = c.clickSP||0
                    if (fb === 0) return <span style={{color:"var(--muted)"}}>—</span>
                    const pct = Math.round((sp/fb)*1000)/10
                    // ≥100% xanh (tốt), <100% đỏ (kém)
                    const color = pct >= 100 ? "var(--success)" : "var(--danger)"
                    return <span style={{color, fontWeight: 500}}>{pct > 999 ? ">999" : pct}%</span>
                  })()}</td>
                  <td style={TD}>{c.profitLoss!=null?<span style={{color:c.profitLoss>=0?"var(--success)":"var(--danger)",fontWeight:500}}>{fmt(c.profitLoss)}</span>:<span style={{color:"var(--muted)"}}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--muted)",flexWrap:"wrap" as const,gap:8}}>
          <span>Hiển thị {filtered.length?((page-1)*PER+1):0}–{Math.min(page*PER,filtered.length)} / {filtered.length}</span>
          <div style={{display:"flex",gap:3,alignItems:"center"}}>
            {/* Mũi tên TRÁI: về trang trước */}
            <button
              onClick={()=>setPage(Math.max(1, page-1))}
              disabled={page<=1}
              title="Trang trước"
              style={{width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:page<=1?"var(--border2)":"var(--muted)",fontSize:13,cursor:page<=1?"not-allowed":"pointer",fontFamily:"inherit",lineHeight:1,padding:0,opacity:page<=1?0.4:1}}
            >‹</button>
            {/* Trang số: hiện 5 trang quanh trang hiện tại (smart window) */}
            {(() => {
              if (tp <= 7) {
                // Ít trang → hiện hết
                return Array.from({length:tp},(_,i)=>i+1)
              }
              // Nhiều trang → hiện cửa sổ 5 trang quanh page hiện tại
              let start = Math.max(1, page-2)
              let end = Math.min(tp, start+4)
              if (end-start<4) start = Math.max(1, end-4)
              return Array.from({length:end-start+1},(_,i)=>start+i)
            })().map(n=>(
              <button key={n} onClick={()=>setPage(n)} style={{minWidth:24,height:24,padding:"0 5px",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:`1px solid ${n===page?"var(--accent)":"var(--border)"}`,background:n===page?"var(--accent)":"transparent",color:n===page?"#fff":"var(--muted)",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{n}</button>
            ))}
            {/* Trang cuối nếu chưa nằm trong cửa sổ */}
            {tp>7 && page<tp-2 && (
              <>
                <span style={{color:"var(--muted)",padding:"0 2px"}}>…</span>
                <button onClick={()=>setPage(tp)} style={{minWidth:28,height:24,padding:"0 5px",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>{tp}</button>
              </>
            )}
            {/* Mũi tên PHẢI: trang sau */}
            <button
              onClick={()=>setPage(Math.min(tp, page+1))}
              disabled={page>=tp}
              title="Trang sau"
              style={{width:24,height:24,borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",border:"1px solid var(--border)",background:"transparent",color:page>=tp?"var(--border2)":"var(--muted)",fontSize:13,cursor:page>=tp?"not-allowed":"pointer",fontFamily:"inherit",lineHeight:1,padding:0,opacity:page>=tp?0.4:1}}
            >›</button>
          </div>
        </div>
      </div>

      
      {syncMsg && <div style={{position:"fixed",bottom:20,right:20,background:syncMsg.startsWith("Loi")?"var(--error)":"var(--success)",color:"#fff",padding:"10px 18px",borderRadius:8,fontSize:12,zIndex:9999,fontWeight:500}}>{syncMsg}</div>}

      {showShopeeCfg && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:560,padding:22,maxHeight:"90vh",overflowY:"auto",display:"flex",flexDirection:"column" as const,gap:14,position:"relative" as const}}>
            <button onClick={()=>setShowShopeeCfg(false)} style={{position:"absolute",top:16,right:16,background:"transparent",border:"none",color:"var(--muted)",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
            <div style={{fontSize:15,fontWeight:600}}>Quản lý Shopee Affiliate API</div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Lấy AppID + API Key từ <a href="https://affiliate.shopee.vn/open_api/home" target="_blank" rel="noreferrer" style={{color:"#ee4d2d"}}>affiliate.shopee.vn/open_api/home</a></div>

            {shopeeAccounts.length > 0 && (
              <>
                <div style={{height:1,background:"var(--border)"}} />
                <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".5px"}}>Account đã có ({shopeeAccounts.length})</div>
                <div style={{display:"flex",flexDirection:"column" as const,gap:6}}>
                  {shopeeAccounts.map((a:any)=>(
                    <div key={a.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6}}>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:500,display:"flex",alignItems:"center",gap:6}}>
                          {a.name}
                          {!a.hasApi && <span style={{fontSize:9,padding:"1px 6px",borderRadius:3,background:"rgba(107,120,148,.15)",color:"var(--muted)",fontWeight:500}}>Chưa có API</span>}
                        </div>
                        {a.hasApi
                          ? <div style={{fontSize:10,color:"var(--muted)",fontFamily:"monospace"}}>App {a.appId} · Key {a.apiKeyPreview}</div>
                          : <div style={{fontSize:10,color:"var(--muted)"}}>Chỉ lưu tên — sync API bị bỏ qua</div>}
                        {a.lastSyncAt && <div style={{fontSize:9,color:"var(--muted)",marginTop:2}}>Sync gần nhất: {new Date(a.lastSyncAt).toLocaleString("vi-VN")}</div>}
                      </div>
                      <button onClick={()=>setShopeeForm({id:a.id,name:a.name,appId:a.appId,apiKey:""})} style={{padding:"3px 9px",borderRadius:4,fontSize:10,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--text)"}}>Sửa</button>
                      <button onClick={()=>deleteShopeeAccount(a.id)} style={{padding:"3px 9px",borderRadius:4,fontSize:10,cursor:"pointer",border:"1px solid rgba(232,77,45,.3)",background:"transparent",color:"var(--danger)"}}>Xoá</button>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div style={{height:1,background:"var(--border)"}} />
            <div style={{fontSize:11,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".5px"}}>{shopeeForm.id ? "Sửa account" : "Thêm account mới"}</div>
            <div>
              <label style={lbl}>Tên (gợi nhớ)</label>
              <input value={shopeeForm.name} onChange={e=>setShopeeForm(f=>({...f,name:e.target.value}))} placeholder="Shop A / Shop TT 1..." style={inp} />
            </div>
            <div style={{fontSize:10,color:"var(--muted)",marginTop:-4,marginBottom:2}}>App ID + API Key có thể bỏ trống nếu TK Shopee không có API.</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={lbl}>App ID</label>
                <input value={shopeeForm.appId} onChange={e=>setShopeeForm(f=>({...f,appId:e.target.value}))} placeholder="17xxxx (tuỳ chọn)" style={inp} />
              </div>
              <div>
                <label style={lbl}>API Key{shopeeForm.id ? " (nhập lại nếu đổi)" : ""}</label>
                <input value={shopeeForm.apiKey} onChange={e=>setShopeeForm(f=>({...f,apiKey:e.target.value}))} placeholder="Q2PP70... (tuỳ chọn)" style={inp} />
              </div>
            </div>
            {shopeeCfgErr && (
              <div style={{padding:"8px 10px",borderRadius:5,background:"rgba(232,77,45,.08)",border:"1px solid rgba(232,77,45,.25)",color:"var(--danger)",fontSize:11}}>
                ❌ {shopeeCfgErr}
              </div>
            )}
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:4}}>
              {shopeeForm.id && (
                <button onClick={()=>setShopeeForm({id:"",name:"",appId:"",apiKey:""})} style={{padding:"6px 13px",borderRadius:6,fontSize:12,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Huỷ sửa</button>
              )}
              <button onClick={()=>setShowShopeeCfg(false)} style={{padding:"6px 13px",borderRadius:6,fontSize:12,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Đóng</button>
              <button onClick={saveShopeeToken} disabled={shopeeSaving||!shopeeForm.name.trim()} style={{padding:"6px 13px",borderRadius:6,fontSize:12,cursor:"pointer",border:"none",background:"#ee4d2d",color:"#fff",fontFamily:"inherit",fontWeight:500,opacity:(shopeeSaving||!shopeeForm.name.trim())?0.5:1}}>{shopeeSaving?"Đang lưu...":(shopeeForm.id?"Cập nhật":"Thêm account")}</button>
            </div>
          </div>
        </div>
      )}

      {showModal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)"}}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:480,padding:22,maxHeight:"90vh",overflowY:"auto",display:"flex",flexDirection:"column" as const,gap:14,position:"relative" as const}}>
            <button onClick={()=>setShowModal(false)} style={{position:"absolute",top:16,right:16,background:"transparent",border:"none",color:"var(--muted)",fontSize:20,cursor:"pointer",lineHeight:1}}>×</button>
            <div style={{fontSize:15,fontWeight:600}}>{editItem?"Sửa Campaign":"Thêm Campaign"}</div>
            <div style={{height:1,background:"var(--border)"}} />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              {fields.map(([label,key,type])=>(
                <div key={key}>
                  <label style={lbl}>{label}</label>
                  <input type={type} value={(form as any)[key]} onChange={e=>setForm({...form,[key]:type==="number"?Number(e.target.value):e.target.value})} style={inp} />
                </div>
              ))}
              <div>
                <label style={lbl}>Trạng thái</label>
                <select value={form.status} onChange={e=>setForm({...form,status:e.target.value})} style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:12,fontFamily:"inherit",padding:"0 10px",height:34,width:"100%",outline:"none"}}>
                  <option value="on">ON — Đang chạy</option>
                  <option value="off">OFF — Tắt</option>
                  <option value="err">ERROR</option>
                </select>
              </div>
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:4}}>
              <button onClick={()=>setShowModal(false)} style={{display:"inline-flex",alignItems:"center",padding:"6px 13px",borderRadius:6,fontSize:12,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit",height:32}}>Huỷ</button>
              <button onClick={saveCampaign} style={{display:"inline-flex",alignItems:"center",padding:"6px 13px",borderRadius:6,fontSize:12,cursor:"pointer",border:"none",background:"var(--accent)",color:"#fff",fontFamily:"inherit",fontWeight:500,height:32}}>{editItem?"Cập nhật":"Thêm"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal đổi budget hàng loạt */}
      {showBulkBudget && (
        <div onClick={(e) => { if (e.target === e.currentTarget && !bulkBudgetSaving) setShowBulkBudget(false) }}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",padding:12}}>
          <div className="app-modal" style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:420,maxWidth:"100%",padding:20,display:"flex",flexDirection:"column" as const,gap:14}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:15,fontWeight:600}}>💰 Đổi budget {selected.size} camp</div>
              {!bulkBudgetSaving && <button onClick={()=>setShowBulkBudget(false)} style={{background:"transparent",border:"none",color:"var(--muted)",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>}
            </div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Budget áp dụng cho <strong style={{color:"var(--text)"}}>{selected.size} camp đã chọn</strong> trên FB Ads Manager. Đơn vị VND/ngày.</div>
            <div>
              <label style={{fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,letterSpacing:".5px",marginBottom:4,display:"block"}}>Budget mới (VND/ngày)</label>
              <input
                type="text"
                inputMode="numeric"
                value={bulkBudgetValue === 0 ? "" : bulkBudgetValue.toLocaleString("vi-VN")}
                onChange={e => {
                  const v = e.target.value.replace(/[.,\s]/g, "")
                  const n = v === "" ? 0 : Number(v)
                  if (Number.isFinite(n)) setBulkBudgetValue(Math.max(0, n))
                }}
                disabled={bulkBudgetSaving}
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && bulkBudgetValue >= 1000) bulkUpdateBudget(bulkBudgetValue) }}
                style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:6,color:"var(--text)",fontSize:14,padding:"0 12px",height:42,width:"100%",outline:"none",boxSizing:"border-box" as const,fontWeight:600}}
              />
              <div style={{fontSize:10,color:"var(--muted)",marginTop:4}}>= <strong style={{color:"var(--text)"}}>{bulkBudgetValue.toLocaleString("vi-VN")}đ</strong> / ngày</div>
            </div>
            {/* Quick presets */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap" as const}}>
              {[30000, 50000, 100000, 200000, 500000, 1000000].map(v => (
                <button key={v} onClick={()=>setBulkBudgetValue(v)} disabled={bulkBudgetSaving} style={{padding:"4px 10px",borderRadius:5,fontSize:10,cursor:bulkBudgetSaving?"not-allowed":"pointer",border:"1px solid var(--border)",background:bulkBudgetValue===v?"var(--pill-bg)":"transparent",color:bulkBudgetValue===v?"var(--pill-text)":"var(--muted)",fontFamily:"inherit"}}>
                  {(v/1000)}k
                </button>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:4}}>
              <button onClick={()=>setShowBulkBudget(false)} disabled={bulkBudgetSaving} style={{padding:"8px 14px",borderRadius:6,fontSize:12,cursor:bulkBudgetSaving?"not-allowed":"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Huỷ</button>
              <button onClick={()=>bulkUpdateBudget(bulkBudgetValue)} disabled={bulkBudgetSaving || bulkBudgetValue < 1000} style={{padding:"8px 18px",borderRadius:6,fontSize:12,cursor:(bulkBudgetSaving||bulkBudgetValue<1000)?"not-allowed":"pointer",border:"none",background:"var(--accent)",color:"#fff",fontFamily:"inherit",fontWeight:600,opacity:(bulkBudgetSaving||bulkBudgetValue<1000)?0.5:1}}>
                {bulkBudgetSaving ? "Đang lưu..." : `💰 Đổi ${selected.size} camp`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal HH chưa gán camp (orphan commission) */}
      {showOrphan && orphan && (
        <div onClick={(e) => { if (e.target === e.currentTarget) setShowOrphan(false) }}
          style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",padding:12}}>
          <div className="app-modal" style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:640,maxWidth:"100%",maxHeight:"85vh",padding:18,display:"flex",flexDirection:"column" as const,gap:10}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:15,fontWeight:600}}>📌 HH chưa gán camp</div>
                <div style={{fontSize:11,color:"var(--muted)",marginTop:3}}>
                  Tổng <strong style={{color:"var(--warn)"}}>{orphan.total.toLocaleString("vi-VN")}đ</strong> từ <strong>{orphan.orderCount}</strong> đơn · {orphan.items.length} mã subId2
                </div>
              </div>
              <button onClick={()=>setShowOrphan(false)} style={{background:"transparent",border:"none",color:"var(--muted)",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:11,color:"var(--muted)",padding:"8px 10px",background:"rgba(245,166,35,.08)",borderRadius:5,border:"1px solid rgba(245,166,35,.2)",lineHeight:1.5}}>
              💡 Đây là HH từ Shopee có <strong>subId2 (tên camp)</strong> không match camp nào trong list. 2 trường hợp:
              <br/>• <strong>Camp legacy</strong> (đã ẩn do chưa gán TKQC): cleanup hoặc gộp.
              <br/>• <strong>Camp đã xoá</strong> hoàn toàn: HH cũ còn trong DB.
            </div>
            <div style={{flex:1,overflowY:"auto" as const,border:"1px solid var(--border)",borderRadius:6}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
                <thead style={{position:"sticky" as const,top:0,background:"var(--bg3)",zIndex:1}}>
                  <tr>
                    <th style={{padding:"7px 10px",textAlign:"left" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>SUBID2 (TÊN CAMP)</th>
                    <th style={{padding:"7px 10px",textAlign:"right" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>HH</th>
                    <th style={{padding:"7px 10px",textAlign:"right" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>SỐ ĐƠN</th>
                    <th style={{padding:"7px 10px",textAlign:"left" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>TRẠNG THÁI</th>
                    <th style={{padding:"7px 10px",textAlign:"left" as const,fontSize:10,fontWeight:600,color:"var(--muted)",textTransform:"uppercase" as const,borderBottom:"1px solid var(--border)"}}>POST</th>
                  </tr>
                </thead>
                <tbody>
                  {orphan.items.map(it => {
                    const result = orphanPosts.get(it.subId2)
                    const posts = result?.posts
                    const isLoading = orphanLoadingSub === it.subId2
                    const expanded = result !== undefined
                    return (
                      <>
                        <tr key={it.subId2} style={{borderBottom: expanded ? "none" : "1px solid var(--border)"}}>
                          <td style={{padding:"8px 10px",fontWeight:500,fontFamily:"monospace"}}>{it.subId2}</td>
                          <td style={{padding:"8px 10px",textAlign:"right" as const,color:"#ee4d2d",fontWeight:500}}>₫{it.commission.toLocaleString("vi-VN")}</td>
                          <td style={{padding:"8px 10px",textAlign:"right" as const,color:"var(--muted)"}}>{it.orderCount}</td>
                          <td style={{padding:"8px 10px"}}>
                            {it.legacyCamp ? (
                              <span title={`Camp legacy id=${it.legacyCamp.id}, campId=${it.legacyCamp.campId}`} style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(155,89,182,.15)",color:"#9b59b6",border:"1px solid rgba(155,89,182,.3)"}}>🧹 Camp legacy (ẩn)</span>
                            ) : (
                              <span style={{fontSize:10,padding:"2px 6px",borderRadius:3,background:"rgba(232,77,45,.1)",color:"var(--danger)",border:"1px solid rgba(232,77,45,.25)"}}>🗑 Camp đã xoá</span>
                            )}
                          </td>
                          <td style={{padding:"8px 10px"}}>
                            <button onClick={() => searchPostsBySubId(it.subId2)} disabled={isLoading} style={{padding:"3px 9px",borderRadius:4,fontSize:10,cursor:isLoading?"wait":"pointer",border:"1px solid rgba(79,126,248,.35)",background:expanded?"rgba(79,126,248,.18)":"rgba(79,126,248,.08)",color:"var(--pill-text)",fontFamily:"inherit",fontWeight:500}}>
                              {isLoading ? "⏳" : expanded ? "▼ Ẩn" : "🔍 Tìm Post"}
                            </button>
                          </td>
                        </tr>
                        {expanded && (
                          <tr style={{borderBottom:"1px solid var(--border)"}}>
                            <td colSpan={5} style={{padding:"0 10px 8px 10px",background:"rgba(79,126,248,.04)"}}>
                              {!posts || posts.length === 0 ? (
                                <div style={{fontSize:10,color:"var(--muted)",padding:"8px 4px",fontStyle:"italic"}}>{result?.note || `Không tìm thấy Post nào ứng với "${it.subId2}" trong Sheet Mapping.`}</div>
                              ) : (
                                <div style={{padding:"6px 4px",fontSize:10}}>
                                  <div style={{color:"var(--muted)",marginBottom:5,fontStyle:"italic"}}>📑 {posts.length} Post match (CampLog + Sheet Mapping):</div>
                                  {posts.map((p:any) => {
                                    const noAcc = !p.page?.accountId
                                    const isRecreating = recreatingPostId === p.id
                                    return (
                                      <div key={p.id} style={{padding:"6px 0",borderTop:"1px dashed var(--border)",display:"flex",alignItems:"flex-start",gap:8,flexWrap:"wrap" as const}}>
                                        <div style={{flex:1,minWidth:0}}>
                                          <a href={`https://facebook.com/${p.fbId}`} target="_blank" rel="noreferrer" style={{color:"var(--pill-text)",textDecoration:"none",fontWeight:500}}>📘 {p.fbId}</a>
                                          {p.page?.name && <span style={{color:"var(--muted)",marginLeft:6}}>· {p.page.name}</span>}
                                          {p.postedAt && <span style={{color:"var(--muted)",marginLeft:6}}>· {new Date(p.postedAt).toLocaleString("vi-VN")}</span>}
                                          {p.adCreated && <span style={{marginLeft:6,padding:"1px 5px",borderRadius:3,background:"rgba(46,204,143,.15)",color:"var(--success)",fontSize:9}}>✓ Đã tạo camp</span>}
                                          {Array.isArray(p._sources) && p._sources.includes("camplog") && <span title="Tìm thấy trong CampLog (log lịch sử tạo camp)" style={{marginLeft:6,padding:"1px 5px",borderRadius:3,background:"rgba(155,89,182,.15)",color:"#9b59b6",fontSize:9}}>📋 CampLog</span>}
                                          {Array.isArray(p._sources) && p._sources.includes("sheet") && <span title="Tìm thấy trong Google Sheet Mapping" style={{marginLeft:6,padding:"1px 5px",borderRadius:3,background:"rgba(79,126,248,.15)",color:"var(--pill-text)",fontSize:9}}>📑 Sheet</span>}
                                          {noAcc && <span title="Page chưa gán TKQC - vào /fanpage-posts cấu hình trước" style={{marginLeft:6,padding:"1px 5px",borderRadius:3,background:"rgba(232,77,45,.15)",color:"var(--danger)",fontSize:9}}>⚠ Chưa gán TKQC</span>}
                                          <div style={{color:"var(--text)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",display:"-webkit-box",WebkitLineClamp:2,WebkitBoxOrient:"vertical" as const,whiteSpace:"pre-wrap"}}>{p.name}</div>
                                        </div>
                                        <button
                                          onClick={() => recreateCampForPost(p.id, it.subId2)}
                                          disabled={isRecreating || !!recreatingPostId || noAcc}
                                          title={noAcc ? "Page chưa gán TKQC - không tạo lại được" : `Tạo lại camp "${it.subId2}" trên FB`}
                                          style={{padding:"4px 10px",borderRadius:5,fontSize:10,cursor:(isRecreating||!!recreatingPostId||noAcc)?"not-allowed":"pointer",border:"1px solid rgba(46,204,143,.4)",background:isRecreating?"rgba(46,204,143,.25)":"rgba(46,204,143,.1)",color:"var(--success)",fontFamily:"inherit",fontWeight:500,opacity:(noAcc||(!!recreatingPostId&&!isRecreating))?0.4:1,whiteSpace:"nowrap" as const,flexShrink:0}}
                                        >
                                          {isRecreating ? "⏳ Đang tạo..." : "🎯 Tạo lại camp"}
                                        </button>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{display:"flex",justifyContent:"flex-end"}}>
              <button onClick={()=>setShowOrphan(false)} style={{padding:"6px 14px",borderRadius:5,fontSize:11,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Đóng</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal chọn TKQC để Tải tất cả */}
      {showTkPicker && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(4px)",padding:12}}>
          <div className="app-modal" style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,width:480,maxWidth:"100%",maxHeight:"80vh",padding:18,display:"flex",flexDirection:"column" as const,gap:12,position:"relative" as const}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{fontSize:15,fontWeight:600}}>🌐 Chọn TKQC để tải Campaigns</div>
              <button onClick={()=>setShowTkPicker(false)} style={{background:"transparent",border:"none",color:"var(--muted)",fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
            </div>
            <div style={{fontSize:11,color:"var(--muted)"}}>Chọn các TKQC muốn sync. Date range: <strong style={{color:"var(--text)"}}>{dateFrom} → {dateTo}</strong></div>
            <div style={{display:"flex",gap:6,fontSize:11}}>
              <button onClick={()=>setPickedTkIds(new Set(adAccounts.map((a:any)=>a.id)))} style={{padding:"3px 10px",borderRadius:5,border:"1px solid var(--border)",background:"transparent",color:"var(--accent)",cursor:"pointer",fontFamily:"inherit"}}>Chọn tất cả</button>
              <button onClick={()=>setPickedTkIds(new Set())} style={{padding:"3px 10px",borderRadius:5,border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",cursor:"pointer",fontFamily:"inherit"}}>Bỏ chọn</button>
            </div>
            <div style={{flex:1,overflowY:"auto" as const,border:"1px solid var(--border)",borderRadius:6,maxHeight:"50vh"}}>
              {adAccounts.length === 0 ? (
                <div style={{padding:24,textAlign:"center" as const,color:"var(--muted)",fontSize:11}}>Chưa có TKQC nào — bấm "Đồng bộ FB" trước</div>
              ) : adAccounts.map((a:any)=>{
                const checked = pickedTkIds.has(a.id)
                return (
                  <label key={a.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderBottom:"1px solid var(--border)",cursor:"pointer",background:checked?"rgba(79,126,248,.06)":"transparent"}}>
                    <input type="checkbox" checked={checked} onChange={()=>{
                      setPickedTkIds(s=>{ const n=new Set(s); if(n.has(a.id)) n.delete(a.id); else n.add(a.id); return n })
                    }} style={{width:14,height:14,accentColor:"var(--accent)",cursor:"pointer"}} />
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:500,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.name}</div>
                      <div style={{fontSize:10,color:"var(--muted)",fontFamily:"monospace"}}>{a.actId || a.accountId}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,color:"var(--muted)"}}>Đã chọn <strong style={{color:"var(--text)"}}>{pickedTkIds.size}</strong> / {adAccounts.length} TKQC</span>
              <div style={{display:"flex",gap:8}}>
                <button onClick={()=>setShowTkPicker(false)} style={{padding:"7px 14px",borderRadius:6,fontSize:12,cursor:"pointer",border:"1px solid var(--border)",background:"transparent",color:"var(--muted)",fontFamily:"inherit"}}>Huỷ</button>
                <button onClick={()=>{ setShowTkPicker(false); loadAllSelectedAccounts() }} disabled={pickedTkIds.size===0} style={{padding:"7px 16px",borderRadius:6,fontSize:12,cursor:pickedTkIds.size===0?"not-allowed":"pointer",border:"none",background:"var(--accent)",color:"#fff",fontFamily:"inherit",fontWeight:500,opacity:pickedTkIds.size===0?0.5:1}}>🚀 Sync {pickedTkIds.size} TK</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
          }
