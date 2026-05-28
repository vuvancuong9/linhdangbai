"use client"
import { useState, useEffect, useRef } from "react"
import AppLayout from "@/components/layout/AppLayout"
import DateInputVN from "@/components/DateInputVN"
import { useToast } from "@/components/Toast"
import { useConfirm } from "@/components/Confirm"
import { useAuthStore } from "@/store/auth"

export default function FanpagePostsPage() {
  const toast = useToast()
  const { ask } = useConfirm()
  const { user: currentUser } = useAuthStore()
  const isAdmin = currentUser?.role === "ADMIN" || currentUser?.role === "SUPER_ADMIN"
  const [rangeFrom, setRangeFrom] = useState("")
  const [rangeTo, setRangeTo] = useState("")
  const [rangeLoading, setRangeLoading] = useState(false)
  const [posts, setPosts] = useState<any[]>([])
  const [totalPosts, setTotalPosts] = useState(0)
  const [loading, setLoading] = useState(false)
  const [tabCamp, setTabCamp] = useState("all")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [lastSelIdx, setLastSelIdx] = useState<number | null>(null)
  const [deletingPosts, setDeletingPosts] = useState(false)
  // Reset anchor shift+click khi posts mới load
  useEffect(() => { setLastSelIdx(null) }, [posts])
  const [showMapping, setShowMapping] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  // SECURITY (P5): export config defaults moved to server (/api/user/camp-defaults).
  // Khởi tạo bằng {} blank; fetch từ server khi mount.
  const [exportConfig, setExportConfig] = useState<any>({
    // Chỉ giữ field placeholder non-sensitive để form không crash trước khi load.
    objective: "Traffic", buyType: "AUCTION", status: "ACTIVE",
    bidStrategy: "Cost per result goal", budget: 0,
    optimizationGoal: "LINK_CLICKS", billingEvent: "IMPRESSIONS",
    bid: 0, ageMin: 18, ageMax: 65, country: "", startDate: "", pageId: "",
  })
  const [currentPage, setCurrentPage] = useState(1)
  const PER_PAGE = 20
  const [mappings, setMappings] = useState<any[]>([])
  const [mapForm, setMapForm] = useState({ sheetUrl: "", sheetName: "Sheet1" })
  // Bulk: textarea chứa nhiều URL (mỗi dòng 1 URL).
  // Lưu vào localStorage để paste 1 lần, lần sau mở modal vẫn còn.
  const BULK_URLS_KEY = "mapping_bulk_urls_draft"
  const [bulkUrls, setBulkUrls] = useState<string>(() => {
    if (typeof window === "undefined") return ""
    try { return localStorage.getItem(BULK_URLS_KEY) || "" } catch { return "" }
  })
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; success: number; failed: number } | null>(null)
  // Auto-save mỗi lần bulkUrls đổi
  useEffect(() => {
    try { localStorage.setItem(BULK_URLS_KEY, bulkUrls) } catch {}
  }, [bulkUrls])
  const [mapLoading, setMapLoading] = useState(false)
  const [mapMsg, setMapMsg] = useState<{type:"success"|"error", text:string}|null>(null)
  const [accounts, setAccounts] = useState<any[]>([])
  const [pages, setPages] = useState<any[]>([])
  const [campaigns, setCampaigns] = useState<any[]>([])
  const [selectedAccId, setSelectedAccId] = useState("")
  // Multi-select fanpage: Set rỗng = tất cả; có item = chỉ lọc theo những page đó.
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set())
  const [showPageDropdown, setShowPageDropdown] = useState(false)
  const [pageFilterSearch, setPageFilterSearch] = useState("")
  const pageDropdownRef = useRef<HTMLDivElement>(null)
  // Sort theo tên Fanpage: "" = mặc định (theo thời gian), "asc" = A→Z, "desc" = Z→A.
  const [sortPage, setSortPage] = useState<"" | "asc" | "desc">("")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [showCreateCamp, setShowCreateCamp] = useState(false)
  const [creatingCamp, setCreatingCamp] = useState(false)
  const [createCampMsg, setCreateCampMsg] = useState<{type:"success"|"error", text:string}|null>(null)
  const [createProgress, setCreateProgress] = useState<{ total: number; done: number; success: number; failed: number; running: boolean } | null>(null)
  const CAMP_CONFIG_KEY = "fb_camp_config_v1"
  // SECURITY (P5): defaults moved to server. Init bằng placeholder neutral
  // (không lộ target thật). Sau khi mount → fetch /api/user/camp-defaults.
  // localStorage cache override cho user tự tinh chỉnh (chỉ trên máy user).
  const PLACEHOLDER_CAMP_CONFIG = {
    objective: "OUTCOME_TRAFFIC",
    budget: 0,
    bidStrategy: "LOWEST_COST_WITHOUT_CAP",
    bidAmount: 0,
    ageMin: 18,
    ageMax: 65,
    gender: "all" as "all"|"male"|"female",
    country: "",
    optimizationGoal: "LINK_CLICKS",
    billingEvent: "IMPRESSIONS",
  }
  const [campConfig, setCampConfig] = useState<any>(() => {
    if (typeof window === "undefined") return PLACEHOLDER_CAMP_CONFIG
    try {
      const saved = localStorage.getItem(CAMP_CONFIG_KEY)
      if (saved) return { ...PLACEHOLDER_CAMP_CONFIG, ...JSON.parse(saved) }
    } catch {}
    return PLACEHOLDER_CAMP_CONFIG
  })
  // Auto-save mỗi khi campConfig đổi.
  useEffect(() => {
    try { localStorage.setItem(CAMP_CONFIG_KEY, JSON.stringify(campConfig)) } catch {}
  }, [campConfig])
  // Fetch defaults từ server khi mount. Chỉ apply nếu user chưa có config save
  // (tránh ghi đè customization).
  useEffect(() => {
    let mounted = true
    fetch("/api/user/camp-defaults").then(r => r.json()).then(d => {
      if (!mounted || !d?.campConfig) return
      const hasSaved = (() => {
        try { return !!localStorage.getItem(CAMP_CONFIG_KEY) } catch { return false }
      })()
      // Chỉ apply server defaults nếu localStorage trống (lần đầu dùng).
      if (!hasSaved) {
        setCampConfig({ ...PLACEHOLDER_CAMP_CONFIG, ...d.campConfig })
      }
      if (d.exportConfig) {
        setExportConfig((prev: any) => ({ ...prev, ...d.exportConfig }))
      }
    }).catch(() => {})
    return () => { mounted = false }
  }, [])

  // ===== Cau hinh Page → TKQC =====
  // Modal cho admin gan moi page voi 1 ad account. Khi user chon posts → app
  // auto-switch dropdown TKQC ve acc cua page do va lock dropdown lai.
  const [showAccConfig, setShowAccConfig] = useState(false)
  const [accConfigSavingId, setAccConfigSavingId] = useState<string>("")
  const [accConfigSearch, setAccConfigSearch] = useState("")

  // Diagnose modal: hiện vì sao posts không được cron auto tạo
  const [showDiagnose, setShowDiagnose] = useState(false)
  const [diagnoseLoading, setDiagnoseLoading] = useState(false)
  const [diagnoseData, setDiagnoseData] = useState<any>(null)
  const [triggering, setTriggering] = useState(false)
  const [triggerLog, setTriggerLog] = useState<any>(null)

  async function openDiagnose() {
    setShowDiagnose(true)
    setDiagnoseLoading(true)
    setTriggerLog(null)
    try {
      const r = await fetch("/api/posts/auto-camp-diagnose", { credentials: "include" })
      const d = await r.json()
      setDiagnoseData(d)
    } catch (e: any) {
      setDiagnoseData({ error: e?.message || "Lỗi" })
    } finally {
      setDiagnoseLoading(false)
    }
  }

  async function triggerAutoCampNow() {
    if (triggering) return
    if (!confirm("Trigger Auto-camp NGAY cho user của mày?\n\nCron sẽ chạy ngay, tạo camp cho tất cả posts đủ điều kiện (max 50 posts/lần). Xem log chi tiết sau khi xong.")) return
    setTriggering(true)
    setTriggerLog(null)
    toast.show("⏳ Đang chạy Auto-camp... có thể mất 10-60s tùy số posts", "info" as any)
    try {
      const r = await fetch("/api/posts/auto-camp-trigger", {
        method: "POST", credentials: "include",
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`)
      setTriggerLog(d.log)
      const s = d.log?.totalSuccess || 0
      const f = d.log?.totalFailed || 0
      const sk = d.log?.totalSkipped || 0
      const tone = f === 0 && s > 0 ? "success" : (s > 0 ? "warn" : "error")
      toast.show(`✅ Xong: ${s} thành công · ${f} lỗi · ${sk} skip (page chưa TKQC)`, tone as any)
      // Reload diagnose data sau khi trigger
      const r2 = await fetch("/api/posts/auto-camp-diagnose", { credentials: "include" })
      const d2 = await r2.json()
      setDiagnoseData(d2)
    } catch (e: any) {
      setTriggerLog({ error: e?.message || String(e) })
      toast.show("❌ Lỗi trigger: " + (e?.message || String(e)), "error" as any)
    } finally {
      setTriggering(false)
    }
  }

  // Tinh required acc tu posts da chon. Tra ve:
  //  - { lockedAccId: string }      : tat ca posts cung 1 acc → auto-switch + lock
  //  - { unassigned: string[] }     : co page chua chi dinh → block tao camp
  //  - { conflict: Map<accId,name>} : posts thuoc nhieu page voi acc khac nhau → block
  //  - {}                           : khong co post nao chon → free
  function computeAssignmentState() {
    if (selected.size === 0) return {} as { lockedAccId?: string; unassigned?: string[]; conflict?: Map<string,string> }
    // Build map pageId → accountId tu state pages
    const pageAcc = new Map<string, string | null>()
    for (const pg of pages) pageAcc.set(pg.id, pg.accountId || null)
    const accSet = new Set<string>()
    const unassignedSet = new Set<string>()
    for (const p of posts) {
      if (!selected.has(p.id)) continue
      const pgId = p.pageId || p.page?.id
      if (!pgId) continue
      const accId = pageAcc.get(pgId)
      if (!accId) {
        unassignedSet.add(p.page?.name || pgId)
      } else {
        accSet.add(accId)
      }
    }
    if (unassignedSet.size > 0) return { unassigned: Array.from(unassignedSet) }
    if (accSet.size === 0) return {}
    if (accSet.size === 1) return { lockedAccId: Array.from(accSet)[0] }
    const conflict = new Map<string,string>()
    Array.from(accSet).forEach(aid => {
      const a = accounts.find((x:any) => x.id === aid)
      conflict.set(aid, a?.name || aid)
    })
    return { conflict }
  }
  const assignmentState = computeAssignmentState()
  const lockedAccId = assignmentState.lockedAccId
  const assignmentBlock: string | null =
    assignmentState.unassigned ? `Page chua chi dinh TKQC: ${assignmentState.unassigned.join(", ")}. Mo "Cau hinh Page → TKQC" de gan.` :
    assignmentState.conflict ? `Posts chon thuoc nhieu page voi TKQC khac nhau (${Array.from(assignmentState.conflict.values()).join(", ")}). Tach lam nhieu lan tao camp.` :
    null

  // Khi co lockedAccId va selectedAccId chua khop → auto-switch.
  useEffect(() => {
    if (lockedAccId && selectedAccId !== lockedAccId) {
      setSelectedAccId(lockedAccId)
    }
    // Khi bo chon het posts (lockedAccId undefined) → giu nguyen selectedAccId,
    // khong reset de user khong mat trang thai filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedAccId])

  async function savePageAccount(pageId: string, accountId: string | null) {
    setAccConfigSavingId(pageId)
    try {
      const r = await fetch(`/api/pages/${pageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ accountId }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        throw new Error(d?.error || `HTTP ${r.status}`)
      }
      // Cap nhat local state pages
      setPages(prev => prev.map((p: any) => p.id === pageId ? { ...p, accountId: accountId || null } : p))
      toast.show("✅ Da luu", "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Loi luu"), "error" as any)
    } finally {
      setAccConfigSavingId("")
    }
  }

  // ===== Auto-create campaign (cron moi dau gio) =====
  // State load tu /api/user/auto-campaign. config lay tu server (auto-sync khi user
  // manual click "Tao Campaign"), enabled la flag bat/tat.
  const [autoCamp, setAutoCamp] = useState<{
    enabled: boolean
    config: any
    lastRunAt: string | null
    lastSuccess: number
    lastFailed: number
  } | null>(null)
  const [autoCampToggling, setAutoCampToggling] = useState(false)
  // Danh sách page bị lỗi permission #10 từ lần sync gần nhất → banner đề xuất bỏ tích.
  const [failingPermPages, setFailingPermPages] = useState<string[]>([])
  const [untickBusy, setUntickBusy] = useState(false)

  async function fetchAutoCamp() {
    try {
      const r = await fetch("/api/user/auto-campaign", { credentials: "include", cache: "no-store" })
      if (r.ok) setAutoCamp(await r.json())
    } catch {}
  }

  async function toggleAutoCamp() {
    if (autoCampToggling) return
    const next = !(autoCamp?.enabled)
    if (next && !autoCamp?.config) {
      toast.show("Chua co cau hinh target. Click 'Tao Campaign' thu cong 1 lan de luu config truoc.", "error" as any)
      return
    }
    // Confirm dialog tránh accidental toggle (user complain tắt mà vẫn chạy).
    const ok = await ask(
      next
        ? "Bật Auto-camp?\n\nCron sẽ tự động tạo camp mỗi đầu giờ (24/7) cho mọi post có campaignId + page đã gán TKQC."
        : "Tắt Auto-camp?\n\nCron sẽ KHÔNG tự tạo camp nữa. Anh phải tự bấm 'Tạo Campaign' thủ công.",
      { title: next ? "Xác nhận BẬT" : "Xác nhận TẮT", warn: !next }
    )
    if (!ok) return
    setAutoCampToggling(true)
    try {
      const r = await fetch("/api/user/auto-campaign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled: next }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d?.error || "HTTP " + r.status)
      // Refetch để chắc chắn server đã save (tránh stale state).
      await fetchAutoCamp()
      toast.show(next ? "🤖 Auto-camp ĐÃ BẬT — chạy mỗi đầu giờ" : "✅ Auto-camp ĐÃ TẮT — cron sẽ skip user này", "success" as any)
    } catch (e: any) {
      toast.show("❌ Lỗi toggle: " + (e?.message || "unknown") + " — thử lại", "error" as any)
      // Refetch để revert UI nếu PATCH fail.
      await fetchAutoCamp()
    } finally {
      setAutoCampToggling(false)
    }
  }

  async function createCampaigns() {
    if (!selectedAccId) { setCreateCampMsg({type:"error", text:"Chọn Tài khoản Ads trước"}); return }
    if (selected.size === 0) { setCreateCampMsg({type:"error", text:"Chọn ít nhất 1 post"}); return }
    if (assignmentBlock) { setCreateCampMsg({type:"error", text: assignmentBlock}); return }
    setCreatingCamp(true); setCreateCampMsg(null)

    // Auto-sync campConfig len server (fire-and-forget) de cron auto-camp dung lai config nay.
    fetch("/api/user/auto-campaign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ config: campConfig }),
    }).then(() => setAutoCamp(prev => prev ? { ...prev, config: campConfig } : prev)).catch(() => {})
    const allIds = Array.from(selected)
    const total = allIds.length
    // CHUNK_SIZE 5 + CHUNK_PARALLEL 2 = 10 posts trong flight (giảm từ 20 để tránh
    // exhaust DB connection pool). Server xử lý 5 song song mỗi chunk.
    const CHUNK_SIZE = 5
    const CHUNK_PARALLEL = 2
    setCreateProgress({ total, done: 0, success: 0, failed: 0, running: true })
    setShowCreateCamp(false)

    let totalSuccess = 0
    let totalFailed = 0
    let totalDone = 0

    // Chia thành các chunk
    const chunks: string[][] = []
    for (let i = 0; i < allIds.length; i += CHUNK_SIZE) {
      chunks.push(allIds.slice(i, i + CHUNK_SIZE))
    }

    async function runOneChunk(chunk: string[]) {
      try {
        const res = await fetch("/api/fb/create-campaign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            accountId: selectedAccId,
            postIds: chunk,
            config: campConfig,
          }),
        })
        const data = await res.json().catch(() => ({} as any))
        if (!res.ok) {
          totalFailed += chunk.length
        } else {
          totalSuccess += data.success || 0
          totalFailed += data.failed || 0
        }
      } catch {
        totalFailed += chunk.length
      } finally {
        totalDone += chunk.length
        setCreateProgress({ total, done: totalDone, success: totalSuccess, failed: totalFailed, running: totalDone < total })
      }
    }

    try {
      // Chạy chunks theo nhóm CHUNK_PARALLEL
      for (let i = 0; i < chunks.length; i += CHUNK_PARALLEL) {
        const group = chunks.slice(i, i + CHUNK_PARALLEL)
        await Promise.all(group.map(runOneChunk))
      }
      const summaryText = `✅ Tạo ${totalSuccess}/${total}` + (totalFailed > 0 ? ` · ❌ ${totalFailed} lỗi` : "")
      toast.show(summaryText, totalFailed === 0 ? "success" as any : (totalSuccess > 0 ? "warn" as any : "error" as any))
      if (totalSuccess > 0) {
        setSelected(new Set())
        invalidatePageCache()
        fetchPosts(currentPage)
        fetchCampaigns()
      }
      setCreateProgress(p => p ? { ...p, running: false } : null)
      setTimeout(() => setCreateProgress(null), 3500)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
      setCreateProgress(null)
    } finally { setCreatingCamp(false) }
  }

  useEffect(() => { fetchPosts(1); fetchMappings(); fetchAssets(); fetchCampaigns(); fetchAutoCamp() }, [])

  // Auto-refresh trạng thái Auto-camp mỗi 30s + khi tab regain focus.
  // Lý do: user có thể toggle ở tab khác → tab này phải sync state mới (banner + button).
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) fetchAutoCamp() }, 30_000)
    const onVis = () => { if (!document.hidden) fetchAutoCamp() }
    document.addEventListener("visibilitychange", onVis)
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchAssets() {
    const [accs, pgs] = await Promise.all([
      fetch("/api/accounts", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      fetch("/api/pages", { credentials: "include" }).then(r => r.ok ? r.json() : [])
    ])
    try {
      // Filter theo isSelected (lưu DB, sync cross-browser) thay vì localStorage.
      let filteredAccs = accs.filter((a: any) => a.isSelected !== false)
      let filteredPgs = pgs.filter((p: any) => p.isSelected !== false)
      // Fallback localStorage nếu DB chưa migrate
      if (filteredAccs.length === accs.length) {
        try {
          const savedAccIds: string[] = JSON.parse(localStorage.getItem("selected_accounts") || "[]")
          if (savedAccIds.length) filteredAccs = accs.filter((a: any) => savedAccIds.includes(a.id))
        } catch {}
      }
      if (filteredPgs.length === pgs.length) {
        try {
          const savedPgIds: string[] = JSON.parse(localStorage.getItem("selected_pages") || "[]")
          if (savedPgIds.length) filteredPgs = pgs.filter((p: any) => savedPgIds.includes(p.id))
        } catch {}
      }
      setAccounts(filteredAccs)
      setPages(filteredPgs)
      // Không auto-select: để mặc định "Tất cả fanpage" và "-- Chọn tài khoản --"
    } catch {
      setAccounts(accs); setPages(pgs)
    }
  }

  async function fetchCampaigns() {
    const res = await fetch("/api/campaigns", { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      setCampaigns(data.campaigns || data || [])
    }
  }

  // Cache page data per page number để chuyển trang qua/lại tức thì.
  // Cache invalidate khi đổi filter (tabCamp, pageId, dateFrom/To) — handled in applyFilter.
  const pageCacheRef = (typeof window !== "undefined") ? (window as any).__pageCache || ((window as any).__pageCache = new Map<string, any>()) : new Map()
  function cacheKey(page: number) {
    const pidsKey = Array.from(selectedPageIds).sort().join(",")
    return `${page}|${tabCamp}|${pidsKey}|${dateFrom}|${dateTo}|${sortPage}`
  }

  async function fetchPosts(page = 1, opts?: { background?: boolean; usePrefetch?: boolean }) {
    const k = cacheKey(page)
    // Hiển thị cache instant nếu có
    if (opts?.usePrefetch !== false) {
      const cached = pageCacheRef.get(k)
      if (cached) {
        setPosts(cached.posts || [])
        setTotalPosts(cached.total || 0)
        // Prefetch trang kế tiếp background, không refetch trang hiện tại nữa
        prefetchNextPage(page)
        return
      }
    }
    if (!opts?.background) setLoading(true)
    const params = new URLSearchParams({ page: String(page), limit: String(PER_PAGE), tab: tabCamp })
    if (selectedPageIds.size > 0) params.set("pageIds", Array.from(selectedPageIds).join(","))
    if (dateFrom) params.set("from", dateFrom)
    if (dateTo) params.set("to", dateTo)
    if (sortPage) { params.set("sort", "page"); params.set("order", sortPage) }
    const res = await fetch(`/api/posts?${params}`, { credentials: "include" })
    if (res.ok) {
      const data = await res.json()
      pageCacheRef.set(k, data)
      if (!opts?.background) {
        setPosts(data.posts || [])
        setTotalPosts(data.total || 0)
      }
    } else if (res.status === 401) window.location.href = "/login"
    if (!opts?.background) setLoading(false)
    if (!opts?.background) prefetchNextPage(page)
  }

  function prefetchNextPage(currentPg: number) {
    const total = totalPosts || 0
    const totalPg = Math.ceil(total / PER_PAGE)
    if (currentPg < totalPg) {
      const nextK = cacheKey(currentPg + 1)
      if (!pageCacheRef.get(nextK)) {
        fetchPosts(currentPg + 1, { background: true, usePrefetch: false })
      }
    }
  }

  // Khi đổi filter, xoá cache cũ
  function invalidatePageCache() {
    pageCacheRef.clear()
  }

  async function syncAndReload() {
    setLoading(true)
    toast.show("⏳ Đang tải bài mới từ FB...", "info" as any)
    try {
      const r = await fetch("/api/fb/sync-posts", { credentials: "include" })
      const d = await r.json().catch(() => ({}))
      if (r.ok) {
        const errs: string[] = Array.isArray(d?.errors) ? d.errors.map((x: any) => String(x)) : []
        const totalNew = d?.totalNew || 0
        if (errs.length > 0) {
          // Detect lỗi permission #10 → extract tên page để show banner.
          // Format error: "PageName: (#10) This endpoint requires..."
          const permPages: string[] = []
          for (const e of errs) {
            if (/\(#10\)|pages_read_engagement|Page Public Content Access/i.test(e)) {
              const m = e.match(/^([^:]+):/)
              if (m && m[1]) permPages.push(m[1].trim())
            }
          }
          setFailingPermPages(Array.from(new Set(permPages)))
          const hint = permPages.length > 0
            ? "\n💡 " + permPages.length + " page anh ko phải admin → bấm 'Bỏ tích page lỗi' ở banner để khỏi spam sync."
            : ""
          const head = `⚠ Sync ${totalNew} bài. ${errs.length} lỗi:`
          const detail = errs.slice(0, 3).map(e => "• " + e.slice(0, 200)).join("\n")
          const rest = errs.length > 3 ? `\n…và ${errs.length - 3} lỗi khác` : ""
          toast.show(head + "\n" + detail + rest + hint, "error" as any)
        } else {
          setFailingPermPages([])
          toast.show(totalNew > 0 ? `✅ Đã sync ${totalNew} bài mới` : "Không có bài mới", totalNew > 0 ? "success" as any : "warn" as any)
        }
      } else {
        toast.show("❌ " + (d?.error || `HTTP ${r.status}`), "error" as any)
      }
    } catch (e: any) {
      toast.show("❌ Lỗi: " + (e?.message || "unknown"), "error" as any)
    }
    invalidatePageCache()
    await fetchPosts(1)
    setCurrentPage(1)
  }

  async function selectByRange() {
    const a = parseInt(rangeFrom, 10)
    const b = parseInt(rangeTo, 10)
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a) {
      toast.show("STT không hợp lệ (Từ ≥ 1, Đến ≥ Từ)", "warn" as any)
      return
    }
    if (totalPosts > 0 && a > totalPosts) {
      toast.show(`Chỉ có ${totalPosts} bài, STT vượt quá`, "warn" as any)
      return
    }
    setRangeLoading(true)
    try {
      // Fetch top-b posts với same filter, slice [a-1, b] để lấy IDs
      const limit = Math.min(b, totalPosts || b)
      const params = new URLSearchParams({ page: "1", limit: String(limit), tab: tabCamp })
      if (selectedPageIds.size > 0) params.set("pageIds", Array.from(selectedPageIds).join(","))
      if (dateFrom) params.set("from", dateFrom)
      if (dateTo) params.set("to", dateTo)
      if (sortPage) { params.set("sort", "page"); params.set("order", sortPage) }
      const r = await fetch(`/api/posts?${params}`, { credentials: "include" })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      const arr = (d.posts || []).slice(a - 1, b)
      const ids = arr.map((p: any) => p.id)
      if (ids.length === 0) {
        toast.show("Không có bài nào trong khoảng STT đó", "warn" as any)
        return
      }
      setSelected(s => { const n = new Set(s); ids.forEach((id: string) => n.add(id)); return n })
      toast.show(`✅ Đã chọn ${ids.length} bài (STT ${a}-${a + ids.length - 1})`, "success" as any)
    } catch (e: any) {
      toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
    } finally { setRangeLoading(false) }
  }

  async function fetchMappings() {
    const res = await fetch("/api/mapping", { credentials: "include" })
    if (res.ok) setMappings(await res.json())
  }

  async function deletePost(id: string) {
    if (!await ask("Xoá bài post này?", { title: "Xác nhận xoá", danger: true })) return
    await fetch(`/api/posts/${id}`, { method: "DELETE", credentials: "include" })
    invalidatePageCache()
    fetchPosts(currentPage)
  }

  async function deleteSelectedPosts() {
    if (selected.size === 0 || deletingPosts) return
    if (!await ask(`Xoá ${selected.size} bài post đã chọn?\n\n⚠ Action không thể hoàn tác. Chỉ xoá khỏi app, KHÔNG xoá trên Facebook.`, { title: "Xác nhận xoá", danger: true })) return
    const ids = Array.from(selected)
    setDeletingPosts(true)
    toast.show(`⏳ Đang xoá ${ids.length} bài...`, "info" as any)
    try {
      // Chia chunk 1000 ids/request để tránh body quá lớn.
      const CHUNK = 1000
      let totalOk = 0
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const r = await fetch("/api/posts/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids: chunk }),
        })
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error || `HTTP ${r.status}`)
        totalOk += d.count || 0
      }
      // OPTIMISTIC UPDATE: hide deleted rows ngay khi server confirm OK — không đợi refetch.
      // Trước: chỉ refetch → nếu fetch lỗi/cache stale, user vẫn thấy bài đã xoá.
      const idSet = new Set(ids)
      setPosts((prev: any[]) => prev.filter((p: any) => !idSet.has(p.id)))
      setTotalPosts(t => Math.max(0, t - totalOk))
      setSelected(new Set())
      invalidatePageCache()
      // Refetch background để sync với server (lấy thêm post từ trang sau lên thay chỗ trống).
      fetchPosts(currentPage, { background: true } as any).catch(() => {})
      // Warn nếu server không xoá được bài nào (vd userId mismatch, đã bị xoá trước).
      if (totalOk === 0) {
        toast.show(`⚠️ Server không xoá được bài nào — có thể đã bị xoá trước hoặc không có quyền`, "error" as any)
      } else if (totalOk < ids.length) {
        toast.show(`⚠️ Chỉ xoá được ${totalOk}/${ids.length} bài (${ids.length - totalOk} bài không tìm thấy)`, "warn" as any)
      } else {
        toast.show(`✅ Đã xoá ${totalOk} bài`, "success" as any)
      }
    } catch (e: any) {
      toast.show("❌ Lỗi xoá: " + (e?.message || "unknown"), "error" as any)
    } finally {
      setDeletingPosts(false)
    }
  }

  async function syncMapping() {
    // Lấy URLs: ưu tiên textarea bulk; fallback single input.
    const urls = bulkUrls
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0 && s.startsWith("http"))
    const list = urls.length > 0 ? urls : (mapForm.sheetUrl ? [mapForm.sheetUrl] : [])
    if (list.length === 0) return

    setMapLoading(true); setMapMsg(null)
    setBulkProgress({ done: 0, total: list.length, success: 0, failed: 0 })

    let success = 0, failed = 0
    const errors: string[] = []
    let totalRows = 0, totalUpdated = 0

    for (let i = 0; i < list.length; i++) {
      const sheetUrl = list[i]
      try {
        const res = await fetch("/api/mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sheetUrl, sheetName: mapForm.sheetName || "Sheet1" }),
          credentials: "include",
        })
        const data = await res.json()
        console.log("[mapping] sync response:", { sheetUrl, status: res.status, data })
        if (res.ok) {
          success++
          totalRows += data.totalRows || 0
          totalUpdated += data.updatedPosts || 0
        } else {
          failed++
          // Show FULL error, không truncate
          errors.push(`${data.error || `HTTP ${res.status}`}`)
        }
      } catch (e: any) {
        failed++
        errors.push(`${sheetUrl.slice(0, 50)}…: lỗi kết nối`)
      }
      setBulkProgress({ done: i + 1, total: list.length, success, failed })
    }

    if (failed === 0) {
      setMapMsg({ type: "success", text: `Sync thành công ${success}/${list.length} sheet · ${totalRows} dòng · cập nhật ${totalUpdated} bài` })
      // GIỮ NGUYÊN bulkUrls trong textarea (đã lưu localStorage) để user dùng lại lần sau.
      // User có thể tự xoá tay nếu muốn dọn.
    } else {
      // Hiện FULL error message để user biết chính xác lý do
      setMapMsg({ type: "error", text: `Lỗi ${failed}/${list.length}:\n${errors.join("\n")}` })
    }
    fetchMappings(); fetchPosts(1); fetchCampaigns(); setCurrentPage(1)
    setMapLoading(false)
    setTimeout(() => setBulkProgress(null), 2000)
  }

  // Xoá 1 mapping
  async function deleteMapping(id: string, url: string) {
    if (!await ask(`Xoá mapping này?\n\n${url.slice(0, 80)}…`, { title: "Xác nhận xoá", danger: true })) return
    try {
      const res = await fetch(`/api/mapping/${id}`, { method: "DELETE", credentials: "include" })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Lỗi")
      toast.show("✓ Đã xoá mapping", "success" as any)
      fetchMappings()
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || ""), "error" as any)
    }
  }

  async function exportCsv() {
    if (selected.size === 0) { toast.show("Chon it nhat 1 bai post", "warn" as any); return }
    setExportLoading(true)
    try {
      const res = await fetch("/api/fb/export-csv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ postIds: Array.from(selected), config: exportConfig })
      })
      if (!res.ok) { toast.show("Loi xuat file: " + (await res.json()).error, "error" as any); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `fb_campaigns_${Date.now()}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setShowExport(false)
    } catch { toast.show("Loi ket noi", "error" as any) }
    setExportLoading(false)
  }

  function goToPage(pg: number) { setCurrentPage(pg); fetchPosts(pg) }
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  // selAll: fetch HẾT IDs theo filter hiện tại (cross-page) → tích sẵn.
  // desel: clear toàn bộ selection (không chỉ trang hiện tại).
  const selAll = async () => {
    const params = new URLSearchParams({ idsOnly: "1", tab: tabCamp })
    if (selectedPageIds.size > 0) params.set("pageIds", Array.from(selectedPageIds).join(","))
    if (dateFrom) params.set("from", dateFrom)
    if (dateTo) params.set("to", dateTo)
    try {
      const res = await fetch(`/api/posts?${params}`, { credentials: "include" })
      if (!res.ok) throw new Error("HTTP " + res.status)
      const data = await res.json()
      const ids: string[] = Array.isArray(data?.ids) ? data.ids : []
      setSelected(new Set(ids))
      toast.show(`Đã chọn ${ids.length} bài (toàn bộ ${ids.length} bài thoả filter)`, "success" as any)
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || "unknown"), "error" as any)
    }
  }
  const desel = () => setSelected(new Set())
  const handleRowClick = (idx: number, p: any, e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    if (target.closest('input, button, select, textarea, a, [data-no-row-select]')) return
    if (e.shiftKey && lastSelIdx !== null) {
      e.preventDefault()
      try { window.getSelection()?.removeAllRanges() } catch {}
      const start = Math.min(lastSelIdx, idx)
      const end = Math.max(lastSelIdx, idx)
      const ids: string[] = []
      for (let k = start; k <= end; k++) { const row = posts[k]; if (row) ids.push(row.id) }
      setSelected(new Set(ids))
    } else if (e.ctrlKey || e.metaKey) {
      toggleSel(p.id)
      setLastSelIdx(idx)
    } else {
      setSelected(new Set([p.id]))
      setLastSelIdx(idx)
    }
  }

  function applyFilter() { invalidatePageCache(); setCurrentPage(1); fetchPosts(1) }
  function clearFilter() {
    invalidatePageCache()
    setTabCamp("all"); setSelectedPageIds(new Set()); setDateFrom(""); setDateTo(""); setSortPage(""); setCurrentPage(1)
    setTimeout(() => fetchPosts(1), 0)
  }

  function toggleSortPage() {
    // none -> asc -> desc -> none
    invalidatePageCache()
    setCurrentPage(1)
    setSortPage(prev => {
      const next = prev === "" ? "asc" : prev === "asc" ? "desc" : ""
      setTimeout(() => fetchPosts(1), 0)
      return next
    })
  }

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    if (!showPageDropdown) return
    function onDocClick(e: MouseEvent) {
      if (pageDropdownRef.current && !pageDropdownRef.current.contains(e.target as Node)) {
        setShowPageDropdown(false)
      }
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [showPageDropdown])

  function togglePageId(id: string) {
    setSelectedPageIds(s => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const totalPages = Math.max(1, Math.ceil(totalPosts / PER_PAGE))
  const inp = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", outline: "none", height: 34, width: "100%", boxSizing: "border-box" } as React.CSSProperties
  const inp2 = { background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 6, color: "var(--text)", fontSize: 12, fontFamily: "inherit", padding: "0 10px", outline: "none", height: 30, width: "100%", boxSizing: "border-box" } as React.CSSProperties
  const lbl = { fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", marginBottom: 4, display: "block" }
  const SH2 = { height: 28, fontSize: 11, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", padding: "0 8px", outline: "none" }
  const TAB_LABELS: Record<string,string> = { all: "Tat ca", none: "Chua co ten", has: "Da co ten" }
  const STATUS_OPTS = [
    { v: "", l: "Trạng thái" },
    { v: "/camp-da-tao", l: "Camp đã tạo" },
    { v: "/camp-loi", l: "Camp lỗi" },
    { v: "/camp-da-xuat", l: "Camp đã xuất" },
  ]

  return (
    <AppLayout>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>Bai dang Fanpage</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => {
              setShowMapping(true); setMapMsg(null)
              // Auto-fill form với mapping mới nhất nếu form còn trống
              if (!mapForm.sheetUrl && mappings.length > 0) {
                setMapForm({ sheetUrl: mappings[0].sheetUrl, sheetName: mappings[0].sheetName || "Sheet1" })
              }
            }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border2)", fontFamily: "inherit", fontWeight: 500, background: "var(--bg3)", color: "var(--text)", height: 28, whiteSpace: "nowrap" as const }}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M8 3v8M4 8l4-4 4 4"/></svg>
            Tai len Mapping ({mappings.length})
          </button>
          <select onChange={e => { if (e.target.value) { window.open(e.target.value, "_blank"); e.target.value = "" } }} style={{ ...SH2 }}>
            {STATUS_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
          <button onClick={() => { setShowAccConfig(true); setAccConfigSearch("") }} title="Gan moi fanpage voi 1 TKQC duy nhat"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border2)", fontFamily: "inherit", fontWeight: 500, background: "var(--bg3)", color: "var(--text)", height: 28, whiteSpace: "nowrap" as const }}>
            ⚙️ Cau hinh Page → TKQC
          </button>
          <button onClick={openDiagnose} title="Hiện vì sao posts không được cron auto tạo camp"
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid rgba(79,126,248,.4)", fontFamily: "inherit", fontWeight: 500, background: "rgba(79,126,248,.1)", color: "#4f7ef8", height: 28, whiteSpace: "nowrap" as const }}>
            🔍 Vì sao chưa auto?
          </button>
          <button
            onClick={toggleAutoCamp}
            disabled={autoCampToggling || !autoCamp}
            title={autoCamp?.enabled ? "Auto-camp DANG BAT — click de TAT" : "Auto-camp DANG TAT — click de BAT (chay moi dau gio)"}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 6, fontSize: 11,
              cursor: autoCampToggling ? "wait" : "pointer", border: "none", fontFamily: "inherit", fontWeight: 600,
              background: autoCamp?.enabled ? "var(--success)" : "var(--bg3)",
              color: autoCamp?.enabled ? "#fff" : "var(--muted)",
              height: 28, whiteSpace: "nowrap" as const,
              opacity: autoCampToggling || !autoCamp ? 0.6 : 1,
            }}
          >
            🤖 Auto-camp: {autoCamp?.enabled ? "BAT" : "TAT"}
          </button>
          <button onClick={syncAndReload}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0 11px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "none", fontFamily: "inherit", fontWeight: 500, background: "var(--success)", color: "#fff", height: 28, whiteSpace: "nowrap" as const }}>
            <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 8A6 6 0 112 8"/><path d="M11 5l3 3-3 3"/></svg>
            Tai bai moi
          </button>
        </div>
      </div>

      {/* Banner page lỗi permission FB — show khi sync detect lỗi #10 */}
      {failingPermPages.length > 0 && (
        <div style={{ background: "rgba(232,77,45,.08)", border: "1px solid rgba(232,77,45,.3)", borderRadius: 6, padding: "9px 14px", fontSize: 12, color: "var(--danger)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" as const }}>
          <div style={{ flex: 1, minWidth: 250 }}>
            <strong>⚠ {failingPermPages.length} page sync lỗi (anh không phải admin):</strong>{" "}
            <span style={{ color: "var(--muted)", fontSize: 11 }}>{failingPermPages.join(", ")}</span>
            <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3 }}>
              FB không cho đọc post page ngoài. Bỏ tích để khỏi spam mỗi lần sync — data cũ vẫn giữ nguyên.
            </div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={async () => {
                if (untickBusy) return
                setUntickBusy(true)
                try {
                  const r = await fetch("/api/pages/untick-failing", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({ names: failingPermPages }),
                  })
                  const d = await r.json()
                  if (r.ok) {
                    toast.show(`✅ Đã bỏ tích ${d.untickedCount}/${d.requested} page. Lần sync sau sẽ skip.`, "success" as any)
                    setFailingPermPages([])
                  } else {
                    toast.show("❌ " + (d?.error || "Lỗi"), "error" as any)
                  }
                } catch (e: any) {
                  toast.show("❌ " + (e?.message || "Lỗi"), "error" as any)
                } finally {
                  setUntickBusy(false)
                }
              }}
              disabled={untickBusy}
              style={{ padding: "6px 14px", borderRadius: 6, fontSize: 11, cursor: untickBusy ? "wait" : "pointer", border: "none", background: "var(--danger)", color: "#fff", fontWeight: 600, opacity: untickBusy ? 0.6 : 1, whiteSpace: "nowrap" as const }}>
              {untickBusy ? "⏳ Đang bỏ tích..." : `🔇 Bỏ tích ${failingPermPages.length} page`}
            </button>
            <button
              onClick={() => setFailingPermPages([])}
              style={{ padding: "6px 12px", borderRadius: 6, fontSize: 11, cursor: "pointer", border: "1px solid var(--border2)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", whiteSpace: "nowrap" as const }}>
              Đóng
            </button>
          </div>
        </div>
      )}

      {/* Banner trang thai auto-camp */}
      {autoCamp?.enabled && (
        <div style={{ background: "rgba(46,204,143,.08)", border: "1px solid rgba(46,204,143,.25)", borderRadius: 6, padding: "7px 12px", fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" as const }}>
          <span>
            🤖 <strong>Auto-camp DANG BAT</strong> — chay moi dau gio (24/7).
            {autoCamp.lastRunAt
              ? <> Lan chay gan nhat: <strong>{new Date(autoCamp.lastRunAt).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</strong> (✓ {autoCamp.lastSuccess} · ✗ {autoCamp.lastFailed})</>
              : <> Chua co lan chay nao.</>}
            {(!autoCamp.config) && <span style={{ color: "var(--warn)", marginLeft: 6 }}>⚠ Chua co config — click Tao Campaign thu cong de luu config.</span>}
          </span>
        </div>
      )}

      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "9px 12px", display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>Ten Campaign</span>
          <div style={{ display: "flex", background: "var(--bg3)", borderRadius: 5, padding: 2, gap: 1 }}>
            {["all","none","has"].map(v => (
              <button key={v} onClick={() => setTabCamp(v)}
                style={{ padding: "3px 10px", borderRadius: 3, fontSize: 11, color: tabCamp===v?"var(--text)":"var(--muted)", cursor: "pointer", border: "none", background: tabCamp===v?"var(--bg2)":"transparent", fontFamily: "inherit", fontWeight: tabCamp===v?500:400 }}>
                {TAB_LABELS[v]}
              </button>
            ))}
          </div>
        </div>
        <div style={{ width: 1, height: 28, background: "var(--border)", alignSelf: "flex-end" as const }} />
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>Tu ngay</span>
          <DateInputVN value={dateFrom} onChange={setDateFrom} style={{ ...SH2, width: 118 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>Den ngay</span>
          <DateInputVN value={dateTo} onChange={setDateTo} style={{ ...SH2, width: 118 }} />
        </div>
        <div style={{ width: 1, height: 28, background: "var(--border)", alignSelf: "flex-end" as const }} />
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 3, position: "relative" as const }} ref={pageDropdownRef}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px" }}>Loc Fanpage</span>
          <button
            type="button"
            onClick={() => setShowPageDropdown(v => !v)}
            style={{ ...SH2, width: 180, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", textAlign: "left" as const }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, color: selectedPageIds.size === 0 ? "var(--muted)" : "var(--text)" }}>
              {selectedPageIds.size === 0
                ? "Tat ca fanpage"
                : selectedPageIds.size === 1
                  ? (pages.find((p: any) => selectedPageIds.has(p.id))?.name || "1 fanpage")
                  : `${selectedPageIds.size} fanpage`}
            </span>
            <span style={{ marginLeft: 6, fontSize: 9, color: "var(--muted)" }}>▼</span>
          </button>
          {showPageDropdown && (
            <div style={{ position: "absolute" as const, top: "100%", left: 0, marginTop: 2, width: 240, maxHeight: 320, overflowY: "auto" as const, background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,.25)", zIndex: 50, padding: 6 }}>
              <input
                autoFocus
                value={pageFilterSearch}
                onChange={e => setPageFilterSearch(e.target.value)}
                placeholder="Tim fanpage..."
                style={{ width: "100%", boxSizing: "border-box" as const, height: 26, fontSize: 11, padding: "0 8px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 4, color: "var(--text)", outline: "none", marginBottom: 4 }}
              />
              <div style={{ display: "flex", gap: 6, padding: "2px 4px 4px 4px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
                <button type="button" onClick={() => setSelectedPageIds(new Set(pages.map((p: any) => p.id)))} style={{ fontSize: 10, color: "var(--accent)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Chon tat ca</button>
                <button type="button" onClick={() => setSelectedPageIds(new Set())} style={{ fontSize: 10, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>Bo chon</button>
              </div>
              {pages
                .filter((p: any) => !pageFilterSearch || (p.name || "").toLowerCase().includes(pageFilterSearch.toLowerCase()))
                .map((p: any) => (
                  <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 6px", borderRadius: 4, cursor: "pointer", fontSize: 11 }} onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                    <input type="checkbox" checked={selectedPageIds.has(p.id)} onChange={() => togglePageId(p.id)} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{p.name}</span>
                  </label>
                ))}
              {pages.filter((p: any) => !pageFilterSearch || (p.name || "").toLowerCase().includes(pageFilterSearch.toLowerCase())).length === 0 && (
                <div style={{ padding: "8px 4px", fontSize: 11, color: "var(--muted)", textAlign: "center" as const }}>Khong tim thay</div>
              )}
            </div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column" as const, gap: 3 }}>
          <span style={{ fontSize: 9, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", display: "flex", alignItems: "center", gap: 4 }}>
            Tai khoan Ads
            {lockedAccId && <span title="TKQC tu dong khoa theo cau hinh page → TKQC" style={{ fontSize: 9, color: "var(--accent)" }}>🔒</span>}
          </span>
          <select
            value={selectedAccId}
            onChange={e => setSelectedAccId(e.target.value)}
            disabled={!!lockedAccId}
            title={lockedAccId ? "TKQC tu dong khoa theo cau hinh page → TKQC. Bo chon posts hoac doi cau hinh." : ""}
            style={{ ...SH2, width: 180, opacity: lockedAccId ? 0.7 : 1, cursor: lockedAccId ? "not-allowed" : "pointer" }}
          >
            <option value="">{accounts.length === 0 ? "-- Tick TK ở Keo Ads --" : "-- Chọn tài khoản --"}</option>
            {accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name} ({a.actId})</option>)}
          </select>
        </div>
        <button onClick={applyFilter} style={{ display: "inline-flex", alignItems: "center", padding: "0 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", fontFamily: "inherit", fontWeight: 500, background: "var(--accent)", color: "#fff", height: 28, alignSelf: "flex-end" as const }}>Loc</button>
        <button onClick={clearFilter} style={{ display: "inline-flex", alignItems: "center", padding: "0 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", fontFamily: "inherit", background: "transparent", color: "var(--muted)", height: 28, alignSelf: "flex-end" as const }}>Xoa</button>
      </div>

      <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" as const, gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--muted)", flexWrap: "wrap" as const }}>
            <input type="checkbox" checked={posts.length>0&&posts.every(p=>selected.has(p.id))} onChange={e=>e.target.checked?selAll():desel()} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
            <strong style={{ color: "var(--text)" }}>{totalPosts}</strong> bai
            <span onClick={selAll} style={{ cursor: "pointer", color: "var(--accent)" }}>Chon tat ca</span>
            <span onClick={desel} style={{ cursor: "pointer", color: "var(--accent)" }}>Bo chon</span>
            <span style={{ width: 1, height: 16, background: "var(--border)", margin: "0 4px" }} />
            <span style={{ fontSize: 10, color: "var(--muted)" }}>Từ STT</span>
            <input type="number" min={1} value={rangeFrom} onChange={e=>setRangeFrom(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")selectByRange()}} placeholder="1" style={{ width: 56, height: 24, padding: "0 6px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 4, color: "var(--text)", fontSize: 11, outline: "none" }} />
            <span style={{ fontSize: 10, color: "var(--muted)" }}>→</span>
            <input type="number" min={1} value={rangeTo} onChange={e=>setRangeTo(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")selectByRange()}} placeholder="20" style={{ width: 56, height: 24, padding: "0 6px", background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 4, color: "var(--text)", fontSize: 11, outline: "none" }} />
            <button onClick={selectByRange} disabled={rangeLoading||!rangeFrom||!rangeTo} style={{ padding: "3px 10px", borderRadius: 4, fontSize: 11, cursor: (rangeLoading||!rangeFrom||!rangeTo)?"not-allowed":"pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, height: 24, opacity: (rangeLoading||!rangeFrom||!rangeTo)?0.5:1 }}>
              {rangeLoading ? "..." : "Chọn"}
            </button>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {selected.size > 0 && (
              <button onClick={deleteSelectedPosts} disabled={deletingPosts} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 5, fontSize: 11, cursor: deletingPosts ? "wait" : "pointer", border: "1px solid rgba(232,77,45,.2)", fontFamily: "inherit", background: "rgba(232,77,45,.08)", color: "var(--danger)", height: 28, opacity: deletingPosts ? 0.6 : 1 }}>
                {deletingPosts ? `⏳ Đang xoá ${selected.size}...` : `🗑 Xoá (${selected.size})`}
              </button>
            )}
          </div>
        </div>

        {selected.size > 0 && (
          <div style={{ padding: "5px 12px", background: "rgba(79,126,248,.08)", borderBottom: "1px solid rgba(79,126,248,.12)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 11, color: "var(--pill-text)", fontWeight: 500 }}>{selected.size} da chon</span>
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={() => { setCreateCampMsg(null); setShowCreateCamp(true) }} disabled={!!assignmentBlock} title={assignmentBlock || ""} style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 4, fontSize: 11, cursor: assignmentBlock ? "not-allowed" : "pointer", border: "none", background: "var(--success)", color: "#fff", fontFamily: "inherit", fontWeight: 600, opacity: assignmentBlock ? 0.5 : 1 }}>🚀 Tạo Campaign</button>
              <button onClick={() => setShowExport(true)} style={{ display: "inline-flex", alignItems: "center", padding: "2px 9px", borderRadius: 4, fontSize: 11, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit" }}>Xuat file Campaign</button>
            </div>
          </div>
        )}
        {selected.size > 0 && assignmentBlock && (
          <div style={{ padding: "6px 12px", background: "rgba(245,166,35,.08)", borderBottom: "1px solid rgba(245,166,35,.2)", fontSize: 11, color: "var(--warn)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span>⚠ {assignmentBlock}</span>
            <button onClick={() => { setShowAccConfig(true); setAccConfigSearch("") }} style={{ padding: "2px 9px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(245,166,35,.4)", background: "transparent", color: "var(--warn)", fontFamily: "inherit", fontWeight: 600, whiteSpace: "nowrap" as const }}>⚙️ Mo cau hinh</button>
          </div>
        )}
        {selected.size > 0 && lockedAccId && !assignmentBlock && (
          <div style={{ padding: "5px 12px", background: "rgba(46,204,143,.06)", borderBottom: "1px solid rgba(46,204,143,.18)", fontSize: 11, color: "var(--success)" }}>
            🔒 TKQC tu dong khoa: <strong>{accounts.find((a:any)=>a.id===lockedAccId)?.name || lockedAccId}</strong> (theo cau hinh page)
          </div>
        )}

        <div className="tbl-wrap">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" as const, minWidth: 720 }}>
          <colgroup>
            <col style={{ width: 36 }}/><col style={{ width: 44 }}/><col style={{ width: "38%" }}/>
            <col style={{ width: "18%" }}/><col style={{ width: "22%" }}/><col style={{ width: 110 }}/>
          </colgroup>
          <thead>
            <tr style={{ background: "var(--bg3)" }}>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={posts.length>0 && posts.every(p=>selected.has(p.id))} onChange={e=>e.target.checked?selAll():desel()} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
              </th>
              {["STT","BAI DANG","FANPAGE","TEN CAMPAIGN","THOI GIAN DANG"].map(h => {
                const isFanpageCol = h === "FANPAGE"
                const arrow = sortPage === "asc" ? "▲" : sortPage === "desc" ? "▼" : "↕"
                const arrowColor = sortPage === "" ? "var(--muted)" : "var(--accent)"
                return (
                  <th
                    key={h}
                    onClick={isFanpageCol ? toggleSortPage : undefined}
                    title={isFanpageCol ? (sortPage === "" ? "Click de sap xep A→Z" : sortPage === "asc" ? "Click de sap xep Z→A" : "Click de bo sap xep") : undefined}
                    style={{ padding: "8px 12px", textAlign: "left" as const, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: ".5px", borderBottom: "1px solid var(--border)", whiteSpace: "nowrap" as const, cursor: isFanpageCol ? "pointer" : "default", userSelect: "none" as const }}
                  >
                    {h}
                    {isFanpageCol && (
                      <span style={{ marginLeft: 5, fontSize: 9, color: arrowColor, fontWeight: 700 }}>{arrow}</span>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Dang tai...</td></tr>
            ) : posts.length === 0 ? (
              <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>Chua co bai post nao</td></tr>
            ) : posts.map((p, i) => (
              <tr key={p.id} onClick={(e) => handleRowClick(i, p, e)} onMouseDown={(e)=>{ if(e.shiftKey) e.preventDefault() }} style={{ borderBottom: "1px solid var(--border)", background: selected.has(p.id)?"rgba(79,126,248,.05)":"transparent", cursor: "pointer", userSelect: "none" as const }}>
                <td style={{ padding: "10px 12px" }} onClick={e=>e.stopPropagation()}>
                  <input type="checkbox" checked={selected.has(p.id)} onChange={()=>toggleSel(p.id)} style={{ width: 20, height: 20, accentColor: "var(--accent)", cursor: "pointer" }} />
                </td>
                <td style={{ padding: "10px 12px", color: "var(--muted)", textAlign: "center" as const }}>{(currentPage-1)*PER_PAGE+i+1}</td>
                <td style={{ padding: "10px 12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 4, background: "var(--bg3)", flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{p.name||p.title||"Bai dang"}</div>
                      <div style={{ fontSize: 9.5, color: "var(--muted)", fontFamily: "monospace", marginTop: 1 }}>{p.fbId||p.id?.slice(0,15)||"—"}</div>
                    </div>
                  </div>
                </td>
                <td style={{ padding: "10px 12px", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }} title={p.page?.name || ""}>
                  {p.page?.name || pages.find((pg: any) => pg.id === p.pageId)?.name || p.pageId || "—"}
                </td>
                <td style={{ padding: "10px 12px" }}>
                  {p.campaignId
                    ? <span style={{ display: "inline-block", fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "var(--pill-bg)", color: "var(--pill-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                        {campaigns.find((c: any) => c.id === p.campaignId)?.name || p.campaignId}
                      </span>
                    : <span style={{ display: "inline-block", fontSize: 10, padding: "1px 7px", borderRadius: 4, background: "rgba(255,255,255,.05)", color: "var(--muted)" }}>Chua co ten</span>
                  }
                </td>
                <td style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap" as const }}>{
                  (() => {
                    const d = new Date(p.postedAt || p.createdAt)
                    const date = d.toLocaleDateString("vi-VN")
                    const time = d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
                    return `${date} ${time}`
                  })()
                }</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>

        <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", fontSize: 11, color: "var(--muted)" }}>
          <span>Hien thi {totalPosts>0?(currentPage-1)*PER_PAGE+1:0}-{Math.min(currentPage*PER_PAGE,totalPosts)} / {totalPosts} bai</span>
          <div style={{ display: "flex", gap: 3 }}>
            <button onClick={()=>goToPage(Math.max(1,currentPage-1))} disabled={currentPage===1} style={{ width: 24, height: 24, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", background: "transparent", color: currentPage===1?"var(--muted)":"var(--text)", fontSize: 11, cursor: currentPage===1?"default":"pointer" }}>‹</button>
            {Array.from({length:Math.min(totalPages,5)},(_,i)=>{
              let pg = i+1
              if(totalPages>5 && currentPage>3) pg = currentPage-2+i
              if(pg>totalPages) return null
              return <button key={pg} onClick={()=>goToPage(pg)} style={{ width: 24, height: 24, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${pg===currentPage?"var(--accent)":"var(--border)"}`, background: pg===currentPage?"var(--accent)":"transparent", color: pg===currentPage?"#fff":"var(--muted)", fontSize: 11, cursor: "pointer" }}>{pg}</button>
            })}
            <button onClick={()=>goToPage(Math.min(totalPages,currentPage+1))} disabled={currentPage===totalPages} style={{ width: 24, height: 24, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--border)", background: "transparent", color: currentPage===totalPages?"var(--muted)":"var(--text)", fontSize: 11, cursor: currentPage===totalPages?"default":"pointer" }}>›</button>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      {showExport && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 480, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 12, maxHeight: "90vh", overflowY: "auto" }}>
            <button onClick={() => setShowExport(false)} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Tao Campaign ({selected.size} bai)</div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <div>
                <label style={lbl}>Objective</label>
                <select value={exportConfig.objective} onChange={e => setExportConfig(c => ({...c, objective: e.target.value}))} style={{ ...inp2 }}>
                  {["Traffic","CONVERSIONS","LINK_CLICKS","POST_ENGAGEMENT","REACH"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Buy Type</label>
                <select value={exportConfig.buyType} onChange={e => setExportConfig(c => ({...c, buyType: e.target.value}))} style={{ ...inp2 }}>
                  {["AUCTION","RESERVED"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Budget (VND)</label>
                <input type="number" value={exportConfig.budget} onChange={e => setExportConfig(c => ({...c, budget: Number(e.target.value)}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Bid Amount</label>
                <input type="number" value={exportConfig.bid} onChange={e => setExportConfig(c => ({...c, bid: Number(e.target.value)}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Age Min</label>
                <input type="number" value={exportConfig.ageMin} onChange={e => setExportConfig(c => ({...c, ageMin: Number(e.target.value)}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Age Max</label>
                <input type="number" value={exportConfig.ageMax} onChange={e => setExportConfig(c => ({...c, ageMax: Number(e.target.value)}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Country</label>
                <input value={exportConfig.country} onChange={e => setExportConfig(c => ({...c, country: e.target.value}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Start Date</label>
                <DateInputVN value={exportConfig.startDate} onChange={v => setExportConfig(c => ({...c, startDate: v}))} style={inp2} />
              </div>
              <div>
                <label style={lbl}>Optimization Goal</label>
                <select value={exportConfig.optimizationGoal} onChange={e => setExportConfig(c => ({...c, optimizationGoal: e.target.value}))} style={{ ...inp2 }}>
                  {["LINK_CLICKS","LANDING_PAGE_VIEWS","IMPRESSIONS","REACH","CONVERSATIONS"].map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Page ID</label>
                <select value={exportConfig.pageId} onChange={e => setExportConfig(c => ({...c, pageId: e.target.value}))} style={{ ...inp2 }}>
                  <option value="">-- Chon page --</option>
                  {pages.map((p: any) => <option key={p.pageId} value={p.pageId}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
              <button onClick={() => setShowExport(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huy</button>
              <button onClick={exportCsv} disabled={exportLoading}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: exportLoading?"wait":"pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 600, height: 32, opacity: exportLoading?0.7:1 }}>
                {exportLoading ? "Dang xuat..." : "Xuat CSV"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Modal */}
      {showMapping && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 520, padding: 24, position: "relative" as const, display: "flex", flexDirection: "column" as const, gap: 14 }}>
            <button onClick={() => setShowMapping(false)} style={{ position: "absolute", top: 14, right: 14, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>x</button>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Tai len Mapping tu Google Sheet</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>Doc cot K (Link Shopee) va cot L (Ten Campaign)</div>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />
            <div style={{ background: "var(--bg3)", borderRadius: 8, padding: "10px 14px", fontSize: 11 }}>
              <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>Định dạng sheet (linh hoạt — ưu tiên tên cột):</div>
              <div style={{ color: "var(--muted)" }}>
                Tìm cột tên <b>"Link Shopee"</b> + <b>"Tên Campaign"</b> ở row 1 (không quan trọng vị trí).
              </div>
              <div style={{ color: "var(--muted)", marginTop: 2 }}>
                Nếu không tìm thấy header → fallback: cột A = Link Shopee, cột B = Tên Campaign.
              </div>
              <div style={{ marginTop: 6, fontSize: 10, color: "var(--warn)" }}>Sheet phải được chia sẻ công khai: Anyone with the link - Viewer</div>
              <div style={{ marginTop: 6, fontSize: 10, color: "var(--success)" }}>⚡ Tự động sync 5 phút/lần — không cần bấm thủ công</div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={lbl}>URL Google Sheet * <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 10 }}>(paste nhiều URL — mỗi dòng 1 URL · tự lưu nháp)</span></label>
                {bulkUrls && (
                  <button
                    type="button"
                    onClick={() => { setBulkUrls(""); try { localStorage.removeItem(BULK_URLS_KEY) } catch {} }}
                    title="Xoá nội dung trong ô này (không xoá mapping đã sync)"
                    style={{ fontSize: 10, color: "var(--muted)", background: "transparent", border: "none", cursor: "pointer", padding: "0 4px" }}
                  >
                    🗑 Xoá nháp
                  </button>
                )}
              </div>
              <textarea
                value={bulkUrls}
                onChange={e => setBulkUrls(e.target.value)}
                placeholder={"https://docs.google.com/spreadsheets/d/AAA...\nhttps://docs.google.com/spreadsheets/d/BBB...\nhttps://docs.google.com/spreadsheets/d/CCC..."}
                rows={5}
                style={{ ...inp, resize: "vertical" as const, minHeight: 90, padding: "8px 10px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}
              />
            </div>
            <div>
              <label style={lbl}>Tên Sheet/tab (áp dụng cho tất cả URL trên)</label>
              <input value={mapForm.sheetName} onChange={e => setMapForm(f => ({ ...f, sheetName: e.target.value }))} placeholder="Sheet1" style={{ ...inp, width: 160 }} />
            </div>
            {bulkProgress && (
              <div style={{ background: "rgba(79,126,248,.08)", border: "1px solid rgba(79,126,248,.2)", borderRadius: 6, padding: "6px 10px", fontSize: 11, color: "var(--pill-text)" }}>
                Đang sync {bulkProgress.done}/{bulkProgress.total} · ✓ {bulkProgress.success} · ✗ {bulkProgress.failed}
              </div>
            )}
            {mappings.length > 0 && (
              <div>
                <div style={lbl}>Đang sync ({mappings.length})</div>
                <div style={{ maxHeight: 180, overflowY: "auto" as const, display: "flex", flexDirection: "column" as const, gap: 4 }}>
                  {mappings.map(m => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "var(--bg3)", borderRadius: 6, border: "1px solid var(--border)" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.sheetUrl}</div>
                        <div style={{ fontSize: 9.5, color: "var(--muted)" }}>{m.rowCount} dòng · {m.lastSyncAt ? new Date(m.lastSyncAt).toLocaleString("vi-VN") : "—"}</div>
                      </div>
                      <button
                        onClick={() => deleteMapping(m.id, m.sheetUrl)}
                        title="Xoá mapping"
                        style={{ padding: "3px 8px", borderRadius: 4, fontSize: 10, cursor: "pointer", border: "1px solid rgba(232,77,45,.3)", background: "rgba(232,77,45,.08)", color: "var(--danger)", fontFamily: "inherit" }}
                      >
                        Xoá
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mapMsg && (
              <div style={{ background: mapMsg.type==="success"?"rgba(46,204,143,.08)":"rgba(232,77,45,.08)", border: `1px solid ${mapMsg.type==="success"?"rgba(46,204,143,.2)":"rgba(232,77,45,.2)"}`, borderRadius: 6, padding: "8px 12px", fontSize: 11, color: mapMsg.type==="success"?"var(--success)":"var(--danger)", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const, maxHeight: 200, overflowY: "auto" as const }}>
                {mapMsg.text}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setShowMapping(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Dong</button>
              <button onClick={syncMapping} disabled={mapLoading || (!bulkUrls.trim() && !mapForm.sheetUrl)}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: mapLoading?"wait":"pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 600, height: 32, opacity: (!bulkUrls.trim() && !mapForm.sheetUrl) ? 0.5 : 1 }}>
                {mapLoading ? "Đang sync..." : "Sync Mapping"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateCamp && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)" }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 520, padding: 22, maxHeight: "90vh", overflowY: "auto", display: "flex", flexDirection: "column" as const, gap: 12, position: "relative" as const }}>
            <button onClick={() => setShowCreateCamp(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer", lineHeight: 1 }}>×</button>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>🚀 Tạo Campaign từ {selected.size} post</div>
              <button
                onClick={async () => {
                  if (!await ask("Reset target về mặc định?", { warn: true })) return
                  // Re-fetch defaults từ server (vì client không còn hardcode).
                  try { localStorage.removeItem(CAMP_CONFIG_KEY) } catch {}
                  try {
                    const r = await fetch("/api/user/camp-defaults")
                    const d = await r.json()
                    if (d?.campConfig) setCampConfig({ ...PLACEHOLDER_CAMP_CONFIG, ...d.campConfig })
                    else setCampConfig(PLACEHOLDER_CAMP_CONFIG)
                  } catch { setCampConfig(PLACEHOLDER_CAMP_CONFIG) }
                  toast.show("Đã reset target", "info" as any)
                }}
                title="Reset về target mặc định"
                style={{ padding: "3px 9px", borderRadius: 5, fontSize: 10, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}
              >
                ↺ Reset
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              TK Ads: <strong>{accounts.find((a:any)=>a.id===selectedAccId)?.name || "—"}</strong>
              {" · "}Chỉ tạo cho post đã có tên Campaign.
              <br/>
              <span style={{ color: "var(--success)" }}>💾 Target tự động lưu lại cho lần sau</span>
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={lbl}>Mục tiêu chiến dịch</label>
                <select value={campConfig.objective} onChange={e=>setCampConfig(c=>({...c, objective: e.target.value}))} style={inp}>
                  <option value="OUTCOME_AWARENESS">Mức độ nhận biết</option>
                  <option value="OUTCOME_TRAFFIC">Lưu lượng truy cập</option>
                  <option value="OUTCOME_ENGAGEMENT">Lượt tương tác</option>
                  <option value="OUTCOME_LEADS">Khách hàng tiềm năng</option>
                  <option value="OUTCOME_APP_PROMOTION">Quảng cáo ứng dụng</option>
                  <option value="OUTCOME_SALES">Doanh số</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Budget/ngày (VND)</label>
                <input type="number" value={campConfig.budget} onChange={e=>setCampConfig(c=>({...c, budget: Number(e.target.value)||0}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Chiến lược giá thầu</label>
                <select value={campConfig.bidStrategy} onChange={e=>setCampConfig(c=>({...c, bidStrategy: e.target.value}))} style={inp}>
                  <option value="LOWEST_COST_WITHOUT_CAP">Lowest Cost (không giới hạn)</option>
                  <option value="LOWEST_COST_WITH_BID_CAP">Lowest Cost với Bid Cap</option>
                  <option value="COST_CAP">Cost Cap</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Bid Amount (VND)</label>
                <input type="number" value={campConfig.bidAmount} onChange={e=>setCampConfig(c=>({...c, bidAmount: Number(e.target.value)||0}))} disabled={campConfig.bidStrategy === "LOWEST_COST_WITHOUT_CAP"} style={{...inp, opacity: campConfig.bidStrategy === "LOWEST_COST_WITHOUT_CAP" ? 0.5 : 1}} />
              </div>
              <div>
                <label style={lbl}>Tuổi từ</label>
                <input type="number" min={13} max={65} value={campConfig.ageMin} onChange={e=>setCampConfig(c=>({...c, ageMin: Number(e.target.value)||18}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Đến</label>
                <input type="number" min={13} max={65} value={campConfig.ageMax} onChange={e=>setCampConfig(c=>({...c, ageMax: Number(e.target.value)||65}))} style={inp} />
              </div>
              <div>
                <label style={lbl}>Giới tính</label>
                <select value={campConfig.gender} onChange={e=>setCampConfig(c=>({...c, gender: e.target.value as any}))} style={inp}>
                  <option value="all">Tất cả</option>
                  <option value="male">Nam</option>
                  <option value="female">Nữ</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Quốc gia</label>
                <input value={campConfig.country} onChange={e=>setCampConfig(c=>({...c, country: e.target.value.toUpperCase()}))} placeholder="VN" style={inp} />
              </div>
              <div style={{ gridColumn: "span 2" }}>
                <label style={lbl}>Mục tiêu tối ưu</label>
                <select value={campConfig.optimizationGoal} onChange={e=>setCampConfig(c=>({...c, optimizationGoal: e.target.value}))} style={inp}>
                  <option value="LINK_CLICKS">Click vào link</option>
                  <option value="POST_ENGAGEMENT">Tương tác bài viết</option>
                  <option value="REACH">Tiếp cận</option>
                  <option value="IMPRESSIONS">Lượt hiển thị</option>
                  <option value="LANDING_PAGE_VIEWS">Lượt xem trang</option>
                </select>
              </div>
            </div>

            {createCampMsg && (
              <div style={{ padding: "8px 10px", borderRadius: 5, background: createCampMsg.type==="error"?"rgba(232,77,45,.08)":"rgba(46,204,143,.08)", border: `1px solid ${createCampMsg.type==="error"?"rgba(232,77,45,.25)":"rgba(46,204,143,.25)"}`, color: createCampMsg.type==="error"?"var(--danger)":"var(--success)", fontSize: 11 }}>
                {createCampMsg.text}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button onClick={() => setShowCreateCamp(false)} style={{ padding: "6px 13px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Huỷ</button>
              <button onClick={createCampaigns} disabled={creatingCamp || !selectedAccId} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: creatingCamp?"wait":"pointer", border: "none", background: "var(--success)", color: "#fff", fontFamily: "inherit", fontWeight: 600, height: 32, opacity: (creatingCamp||!selectedAccId)?0.6:1 }}>
                {creatingCamp ? "Đang tạo..." : "🚀 Tạo Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress toast khi đang tạo campaign — góc phải dưới, không che modal khác */}
      {createProgress && (
        <div style={{ position: "fixed", right: 20, bottom: 20, zIndex: 9000, width: 320, background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, padding: 14, boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <span style={{ fontSize: 14 }}>{createProgress.running ? "🚀" : "✅"}</span>
            <span style={{ fontSize: 12, fontWeight: 600 }}>
              {createProgress.running ? "Đang tạo Campaign..." : "Hoàn tất"}
            </span>
            {!createProgress.running && (
              <button onClick={() => setCreateProgress(null)} style={{ marginLeft: "auto", background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{createProgress.done}</span>
            <span> / {createProgress.total} bài</span>
            <span style={{ color: "var(--success)", marginLeft: 10 }}>✓ {createProgress.success}</span>
            {createProgress.failed > 0 && <span style={{ color: "var(--danger)", marginLeft: 8 }}>✗ {createProgress.failed}</span>}
          </div>
          {/* Progress bar */}
          <div style={{ height: 6, background: "var(--bg3)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${createProgress.total > 0 ? (createProgress.done / createProgress.total) * 100 : 0}%`,
              background: createProgress.running
                ? "linear-gradient(90deg, var(--accent), var(--success))"
                : (createProgress.failed > 0 ? "var(--warn)" : "var(--success)"),
              transition: "width .25s ease",
            }} />
          </div>
        </div>
      )}

      {/* Modal Diagnose: vì sao chưa auto tạo camp */}
      {showDiagnose && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: "95%", maxWidth: 1100, maxHeight: "90vh", display: "flex", flexDirection: "column" as const }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>🔍 Vì sao posts chưa được cron auto tạo?</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {/* Nút Trigger chỉ enable khi Auto-camp đang BẬT (match backend guard 2026-05-27). */}
                {(() => {
                  const enabled = !!autoCamp?.enabled
                  const disabled = triggering || !enabled
                  return (
                    <button
                      onClick={triggerAutoCampNow}
                      disabled={disabled}
                      title={enabled ? "Trigger auto-camp ngay (không đợi cron)" : "Auto-camp đang TẮT — bật ở header trang trước"}
                      style={{
                        padding: "6px 12px", borderRadius: 5, fontSize: 12, fontWeight: 600, border: "none",
                        background: !enabled ? "#888" : (triggering ? "#888" : "var(--success)"),
                        color: "white",
                        cursor: disabled ? (triggering ? "wait" : "not-allowed") : "pointer",
                        opacity: !enabled ? 0.5 : 1,
                      }}>
                      {triggering ? "⏳ Đang chạy..." : (enabled ? "⚡ Trigger Auto-camp NGAY" : "⚡ Trigger (Auto-camp đang TẮT)")}
                    </button>
                  )
                })()}
                <button onClick={() => setShowDiagnose(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 20, cursor: "pointer" }}>×</button>
              </div>
            </div>
            <div style={{ padding: 14, overflow: "auto", flex: 1 }}>
              {/* Trigger result log */}
              {triggerLog && (
                <div style={{ marginBottom: 14, padding: 12, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg3)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>📋 Kết quả Trigger Auto-camp</div>
                  {triggerLog.error ? (
                    <div style={{ color: "var(--danger)", fontSize: 12 }}>❌ {triggerLog.error}</div>
                  ) : (
                    <div style={{ fontSize: 11 }}>
                      <div>Tổng candidates: <b>{triggerLog.totalCandidates}</b> | ✅ Success: <b style={{ color: "#0a8a5e" }}>{triggerLog.totalSuccess}</b> | ❌ Failed: <b style={{ color: "#c33" }}>{triggerLog.totalFailed}</b> | ⏭ Skipped (page chưa TKQC): <b style={{ color: "#a86b00" }}>{triggerLog.totalSkipped}</b></div>
                      {triggerLog.batches?.map((b: any, i: number) => (
                        <details key={i} style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--border)" }}>
                          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                            Batch {i + 1}: <code>{b.accountName}</code> — {b.postIds.length} posts → {b.result?.ok ? `✓ ${b.result.success}/${b.postIds.length} ok` : `✗ ${b.result?.error || "fail"}`}
                          </summary>
                          <div style={{ marginTop: 6, fontSize: 10, fontFamily: "monospace", whiteSpace: "pre-wrap" as const, color: "var(--muted)", maxHeight: 200, overflow: "auto" }}>
                            {b.result?.results?.map((r: any) => `${r.ok ? "✓" : "✗"} ${r.postId.slice(0, 8)} ${r.error || r.campaignFbId || ""}`).join("\n") || JSON.stringify(b.result, null, 2)}
                          </div>
                        </details>
                      ))}
                      {triggerLog.skipped?.length > 0 && (
                        <details style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--warn)" }}>
                          <summary style={{ cursor: "pointer", fontWeight: 600, color: "var(--warn)" }}>⏭ Skipped {triggerLog.skipped.length} posts (page chưa TKQC)</summary>
                          <div style={{ marginTop: 6, fontSize: 10 }}>
                            {triggerLog.skipped.slice(0, 20).map((s: any, i: number) => <div key={i}>• {s.pageName}: {s.reason}</div>)}
                          </div>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}

              {diagnoseLoading && <div style={{ textAlign: "center", padding: 20, color: "var(--muted)" }}>⏳ Đang tải...</div>}
              {!diagnoseLoading && diagnoseData?.error && <div style={{ color: "var(--danger)", padding: 10 }}>❌ {diagnoseData.error}</div>}
              {!diagnoseLoading && diagnoseData?.items && (
                <>
                  {/* Stats summary */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 14 }}>
                    {[
                      { key: "create", label: "✅ Sẽ tạo lần cron tới", color: "#0a8a5e" },
                      { key: "retry-now", label: "🔁 Sẽ retry lần cron tới", color: "#0a8a5e" },
                      { key: "skip-no-campaign", label: "⚠️ Thiếu Tên Campaign", color: "#a86b00" },
                      { key: "skip-no-tkqc", label: "⚠️ Page chưa gán TKQC", color: "#a86b00" },
                      { key: "skip-error-cooldown", label: "⏳ Đợi 6h để retry", color: "#888" },
                      { key: "skip-error-maxed", label: "❌ Đã retry hết (manual)", color: "#c33" },
                    ].map((s) => {
                      const count = diagnoseData.stats?.[s.key] || 0
                      return (
                        <div key={s.key} style={{ padding: "8px 10px", borderRadius: 6, border: `1px solid ${s.color}33`, background: `${s.color}11` }}>
                          <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{count}</div>
                          <div style={{ fontSize: 10, color: s.color }}>{s.label}</div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                    Tổng {diagnoseData.total} posts pending. Cron retry sau {diagnoseData.retryHours}h, max {diagnoseData.maxRetry} lần. Bảng chi tiết:
                  </div>
                  <div style={{ overflowX: "auto", maxHeight: "55vh", overflowY: "auto" }}>
                    <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                      <thead style={{ position: "sticky" as const, top: 0, background: "var(--bg3)" }}>
                        <tr>
                          <th style={{ padding: "6px 8px", textAlign: "left" as const, borderBottom: "1px solid var(--border)" }}>Page</th>
                          <th style={{ padding: "6px 8px", textAlign: "left" as const, borderBottom: "1px solid var(--border)" }}>Camp name</th>
                          <th style={{ padding: "6px 8px", textAlign: "left" as const, borderBottom: "1px solid var(--border)", minWidth: 280 }}>Lý do (cron action)</th>
                          <th style={{ padding: "6px 8px", textAlign: "left" as const, borderBottom: "1px solid var(--border)", maxWidth: 300 }}>Lỗi gần nhất</th>
                        </tr>
                      </thead>
                      <tbody>
                        {diagnoseData.items.slice(0, 200).map((it: any) => (
                          <tr key={it.id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "6px 8px" }}>{it.pageName || "—"}</td>
                            <td style={{ padding: "6px 8px" }}>{it.campaignName || "—"}</td>
                            <td style={{ padding: "6px 8px", fontSize: 10.5 }}>
                              <span style={{ display: "inline-block", padding: "1px 6px", borderRadius: 3, fontSize: 9, marginRight: 5,
                                background: it.cronAction === "create" || it.cronAction === "retry-now" ? "#d4edda" :
                                            it.cronAction === "skip-no-campaign" || it.cronAction === "skip-no-tkqc" ? "#fff3cd" :
                                            it.cronAction === "skip-error-maxed" ? "#f8d7da" : "#e0e0e0",
                                color: it.cronAction === "create" || it.cronAction === "retry-now" ? "#155724" :
                                       it.cronAction === "skip-no-campaign" || it.cronAction === "skip-no-tkqc" ? "#856404" :
                                       it.cronAction === "skip-error-maxed" ? "#721c24" : "#555",
                              }}>{it.cronAction}</span>
                              {it.reason}
                            </td>
                            <td style={{ padding: "6px 8px", color: "var(--danger)", fontSize: 10, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={it.adError}>
                              {it.adError ? it.adError.slice(0, 100) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {diagnoseData.items.length > 200 && <div style={{ padding: 10, color: "var(--muted)", fontSize: 11 }}>... và {diagnoseData.items.length - 200} posts khác (chỉ hiện 200 đầu)</div>}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Cau hinh Page → TKQC */}
      {showAccConfig && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 10, width: "90%", maxWidth: 760, maxHeight: "85vh", display: "flex", flexDirection: "column" as const }}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>⚙️ Cau hinh Page → TKQC</div>
                <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                  Moi fanpage chi duoc tao campaign tren 1 TKQC duy nhat. Page chua chi dinh → khong tao camp duoc.
                </div>
              </div>
              <button onClick={() => setShowAccConfig(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 22, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--border)" }}>
              <input
                value={accConfigSearch}
                onChange={e => setAccConfigSearch(e.target.value)}
                placeholder="Tim fanpage theo ten..."
                style={{ ...inp2, width: "100%" }}
              />
            </div>
            <div style={{ flex: 1, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead style={{ position: "sticky" as const, top: 0, background: "var(--bg2)", zIndex: 1 }}>
                  <tr>
                    <th style={{ textAlign: "left" as const, padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase" as const, fontWeight: 600 }}>Fanpage</th>
                    <th style={{ textAlign: "left" as const, padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase" as const, fontWeight: 600 }}>TKQC chi dinh</th>
                  </tr>
                </thead>
                <tbody>
                  {pages
                    .filter((p: any) => !accConfigSearch.trim() || p.name.toLowerCase().includes(accConfigSearch.trim().toLowerCase()))
                    .map((p: any) => (
                      <tr key={p.id}>
                        <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                          <div style={{ fontWeight: 500 }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{p.pageId}</div>
                        </td>
                        <td style={{ padding: "8px 14px", borderBottom: "1px solid var(--border)" }}>
                          <select
                            value={p.accountId || ""}
                            onChange={e => savePageAccount(p.id, e.target.value || null)}
                            disabled={accConfigSavingId === p.id}
                            style={{ ...inp2, width: 320, opacity: accConfigSavingId === p.id ? 0.6 : 1 }}
                          >
                            <option value="">— Chua chi dinh —</option>
                            {accounts.map((a: any) => (
                              <option key={a.id} value={a.id}>{a.name} ({a.actId})</option>
                            ))}
                          </select>
                          {accConfigSavingId === p.id && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 6 }}>⏳</span>}
                        </td>
                      </tr>
                    ))}
                  {pages.length === 0 && (
                    <tr><td colSpan={2} style={{ padding: 24, textAlign: "center" as const, color: "var(--muted)", fontSize: 12 }}>Chua co fanpage</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>
                Da chi dinh: {pages.filter((p: any) => p.accountId).length} / {pages.length}
              </div>
              <button onClick={() => setShowAccConfig(false)} style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit", height: 32 }}>Dong</button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}