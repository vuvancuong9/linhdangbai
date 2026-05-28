"use client"
// Trang Nghiem thu Shopee Affiliates — workflow 2 buoc:
//
// BUOC 1: Upload file 1 (4 cot: account_id, campaign_name, old_ad_name, new_ad_name)
//   → app lookup ad_id qua FB API → luu DB → bam "Doi ten" de rename qua FB API.
//
// BUOC 2: Upload file 2 (FB Ads Manager export — co cot Ad Name + Body + Permalink)
//   → app match theo new_ad_name → update linkPost (Permalink) + shopeeLink (extract tu Body).
//
// Cuoi: bam "Xuat Excel" de tai file nop Shopee.

import { useState, useRef, useEffect } from "react"
import AppLayout from "@/components/layout/AppLayout"
import { useToast } from "@/components/Toast"
// PERF (R2.C1): XLSX lazy import — chỉ load 300KB khi user upload/export.
// Dynamic import trong các function dùng (handleFile1, handleFile2, exportExcel, downloadTemplate1).

interface Item {
  id: string
  accountId: string
  affiliateId: string | null
  campaignName: string
  oldAdName: string
  newAdName: string
  adId: string | null
  lookupError: string | null
  linkPost: string | null
  shopeeLink: string | null
  renamedAt: string | null
  renameError: string | null
  createdAt: string
  updatedAt: string
}
interface AffiliateAgg {
  affiliateId: string | null
  count: number
}

export default function NghiemThuPage() {
  const toast = useToast()
  const file1Ref = useRef<HTMLInputElement | null>(null)
  const file2Ref = useRef<HTMLInputElement | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [affiliates, setAffiliates] = useState<AffiliateAgg[]>([])
  const [affFilter, setAffFilter] = useState<string>("") // "" = tất cả, "_null_" = chưa parse
  const [loading, setLoading] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  // Labels nick Shopee: affiliateId → label
  const [labels, setLabels] = useState<Record<string, string>>({})
  const [labelModalOpen, setLabelModalOpen] = useState(false)
  const [labelDraft, setLabelDraft] = useState<Array<{ affiliateId: string; label: string }>>([])
  // Progress banner cho doRename — null = ẩn, active=true = đang chạy, active=false = đã xong (hiện 6s rồi tự dismiss)
  const [renameProgress, setRenameProgress] = useState<{ active: boolean; current: number; total: number; ok: number; fail: number } | null>(null)
  // Anchor cho Shift+click range select — row được click cuối cùng (chưa shift).
  const [anchorId, setAnchorId] = useState<string | null>(null)

  useEffect(() => { loadItems(); loadLabels() }, [affFilter])

  async function loadLabels() {
    try {
      const r = await fetch("/api/nghiem-thu/labels")
      const d = await r.json()
      if (r.ok) {
        const map: Record<string, string> = {}
        for (const l of (d.labels || [])) map[l.affiliateId] = l.label
        setLabels(map)
      }
    } catch {}
  }

  function openLabelModal() {
    // Load distinct affId tu items hien co + labels da luu
    const allAffIds = new Set<string>()
    for (const a of affiliates) if (a.affiliateId) allAffIds.add(a.affiliateId)
    for (const k of Object.keys(labels)) allAffIds.add(k)
    const draft = Array.from(allAffIds).sort().map(affId => ({
      affiliateId: affId,
      label: labels[affId] || "",
    }))
    if (draft.length === 0) {
      // Cho phep them thu cong dong dau
      draft.push({ affiliateId: "", label: "" })
    }
    setLabelDraft(draft)
    setLabelModalOpen(true)
  }

  async function saveLabels() {
    setLoading(true)
    try {
      const clean = labelDraft
        .map(d => ({ affiliateId: String(d.affiliateId).trim(), label: String(d.label).trim() }))
        .filter(d => d.affiliateId)
      const r = await fetch("/api/nghiem-thu/labels", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels: clean }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi")
      toast.show(`✅ Đã lưu ${d.upserted} label · xoá ${d.deleted}`, "success")
      setLabelModalOpen(false)
      await loadLabels()
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  function affDisplayName(affId: string | null): string {
    if (!affId || affId === "_null_") return "Chưa xác định"
    return labels[affId] || affId
  }

  async function loadItems() {
    setLoading(true)
    try {
      const q = affFilter ? `?affiliateId=${encodeURIComponent(affFilter)}` : ""
      const r = await fetch(`/api/nghiem-thu/items${q}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d?.error || "Lỗi load")
      setItems(d.items || [])
      setAffiliates(d.affiliates || [])
      setSelectedIds(new Set())
    } catch (e: any) {
      toast.show("Lỗi load: " + (e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  function handleFile1(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx")
        const buf = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(buf, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })
        if (json.length < 2) { toast.show("File rỗng", "error"); return }
        const header = (json[0] || []).map((c: any) => String(c || "").trim().toLowerCase())

        let cTkqc = -1, cCamp = -1, cNewAd = -1, cOldAd = -1
        for (let i = 0; i < header.length; i++) {
          if (cTkqc < 0 && /account[_\s]?id|act[_\s]?id|tkqc/i.test(header[i])) cTkqc = i
        }
        for (let i = 0; i < header.length; i++) {
          if (cCamp < 0 && /camp/.test(header[i]) && !/ad/.test(header[i]) && !/nghi|thu|new/.test(header[i])) cCamp = i
        }
        for (let i = 0; i < header.length; i++) {
          if (cNewAd < 0 && (/new[_\s]?ad/.test(header[i]) || (/ngh[iị?]/i.test(header[i]) && /thu|ad/.test(header[i])))) cNewAd = i
        }
        for (let i = 0; i < header.length; i++) {
          if (i === cTkqc || i === cCamp || i === cNewAd) continue
          if (/old[_\s]?ad|ad[_\s]?name|^ad$|t[êe?]n\s*ad/.test(header[i])) { cOldAd = i; break }
        }
        if (cTkqc < 0 || cCamp < 0 || cOldAd < 0 || cNewAd < 0) {
          alert(
            `❌ File 1 thiếu cột.\nHeader đọc được: ${header.map((h, i) => `[${i}] "${h}"`).join(" · ")}\n\n` +
            `Cần 4 cột: account_id | campaign_name | old_ad_name | new_ad_name`
          )
          return
        }

        const rows: any[] = []
        for (let i = 1; i < json.length; i++) {
          const r = json[i] || []
          const tkqcId = String(r[cTkqc] || "").trim()
          const campName = String(r[cCamp] || "").trim()
          const oldAdName = String(r[cOldAd] || "").trim()
          const newAdName = String(r[cNewAd] || "").trim()
          if (!tkqcId && !campName && !oldAdName && !newAdName) continue
          rows.push({ tkqcId, campName, oldAdName, newAdName })
        }
        if (rows.length === 0) { toast.show("Không có dòng dữ liệu", "error"); return }

        toast.show(`📤 Đang import ${rows.length} dòng từ file 1...`, "info")
        setLoading(true)
        const res = await fetch("/api/nghiem-thu/import-file1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || "Lỗi")
        const s = data.summary
        toast.show(`✅ Import file 1: ${s.matched}/${s.totalRows} ads tìm được, lưu DB OK`, s.matched === s.totalRows ? "success" : "warn")
        await loadItems()
      } catch (err: any) {
        toast.show("Lỗi file 1: " + (err?.message || err), "error")
      } finally {
        setLoading(false)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function handleFile2(file: File) {
    const reader = new FileReader()
    reader.onload = async (e) => {
      try {
        const XLSX = await import("xlsx")
        const buf = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(buf, { type: "array" })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const json: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" })
        if (json.length < 2) { toast.show("File rỗng", "error"); return }
        const header = (json[0] || []).map((c: any) => String(c || "").trim().toLowerCase())

        // FB Ads Manager export co cot "Ad Name", "Body", "Permalink"
        let cAdName = -1, cBody = -1, cPermalink = -1
        for (let i = 0; i < header.length; i++) {
          if (cAdName < 0 && /^ad name$|^ad_name$/.test(header[i])) cAdName = i
        }
        for (let i = 0; i < header.length; i++) {
          if (cBody < 0 && (header[i] === "body" || /^ad body$|caption|message/.test(header[i]))) cBody = i
        }
        for (let i = 0; i < header.length; i++) {
          if (cPermalink < 0 && /permalink|link[_\s]?post|fb[_\s]?link/.test(header[i])) cPermalink = i
        }
        if (cAdName < 0 || cBody < 0 || cPermalink < 0) {
          alert(
            `❌ File 2 thiếu cột.\nHeader (${header.length} cột) — sample: ${header.slice(0, 30).map((h, i) => `[${i}] "${h}"`).join(" · ")}\n\n` +
            `Cần 3 cột: "Ad Name" + "Body" + "Permalink" (file FB Ads Manager export ra Excel có sẵn).`
          )
          return
        }

        const rows: any[] = []
        for (let i = 1; i < json.length; i++) {
          const r = json[i] || []
          const adName = String(r[cAdName] || "").trim()
          const bodyText = String(r[cBody] || "")
          const permalink = String(r[cPermalink] || "").trim()
          if (!adName) continue
          rows.push({ adName, body: bodyText, permalink })
        }
        if (rows.length === 0) { toast.show("Không có dòng dữ liệu", "error"); return }

        toast.show(`📤 Đang import ${rows.length} dòng từ file 2...`, "info")
        setLoading(true)
        const res = await fetch("/api/nghiem-thu/import-file2", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || "Lỗi")
        const s = data.summary
        let msg = `✅ Import file 2: ${s.matched} match · ${s.unmatched} không match`
        if (s.unmatched > 0 && s.unmatchedSample?.length) {
          msg += `\nKhông match (sample): ${s.unmatchedSample.slice(0, 3).join(", ")}`
        }
        toast.show(msg, s.unmatched === 0 ? "success" : "warn")
        await loadItems()
      } catch (err: any) {
        toast.show("Lỗi file 2: " + (err?.message || err), "error")
      } finally {
        setLoading(false)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // Tra cứu lại ad_id cho các dòng chưa match (hoặc subset selected).
  async function doLookupRetry() {
    const ids = selectedIds.size > 0 ? Array.from(selectedIds) : undefined  // undefined = all adId=null
    const noMatchCount = items.filter(i => !i.adId).length
    if (noMatchCount === 0) { toast.show("Tất cả dòng đã có ad_id rồi", "warn"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/nghiem-thu/lookup-retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || "Lỗi")
      const msg = `🔍 Tra cứu lại: ${d.matched}/${d.total} match được${d.failed > 0 && d.topErrors?.length ? "\nLý do fail:\n" + d.topErrors.map((e: any) => `• ${e.msg} (${e.count})`).join("\n") : ""}`
      // Toast 1 dòng + alert chi tiết
      toast.show(`Tra cứu xong: ${d.matched}/${d.total} match`, d.matched > 0 ? "success" : "warn")
      if (d.failed > 0 && d.topErrors?.length > 0) {
        // Hiện chi tiết lý do fail (alert đơn giản — non-tech friendly)
        alert(msg)
      }
      await loadItems()
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  async function doRename(targetIds?: string[]) {
    const ids = targetIds || (selectedIds.size > 0 ? Array.from(selectedIds) : items.filter(i => i.adId && !i.renamedAt).map(i => i.id))
    if (ids.length === 0) { toast.show("Không có ad nào để đổi tên", "warn"); return }
    if (!confirm(`Đổi tên ${ids.length} ad trên FB? Thao tác không undo được.\n\nThời gian dự kiến: ~${Math.ceil(ids.length * 0.5)}s.`)) return
    setLoading(true)
    // CHUNK nhỏ (20) để progress banner update mượt thay vì chờ 1 lần xong.
    // Backend throttle 400ms/ad → 20 ad ≈ 8s/chunk, update banner mỗi 8s.
    const CHUNK = 20
    setRenameProgress({ active: true, current: 0, total: ids.length, ok: 0, fail: 0 })
    try {
      let totalOk = 0, totalFail = 0
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const res = await fetch("/api/nghiem-thu/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d?.error || "Lỗi")
        totalOk += d.summary?.success || 0
        totalFail += d.summary?.fail || 0
        // Update progress banner sau mỗi chunk.
        setRenameProgress({
          active: i + CHUNK < ids.length,  // false khi hoàn thành
          current: Math.min(i + CHUNK, ids.length),
          total: ids.length,
          ok: totalOk,
          fail: totalFail,
        })
      }
      toast.show(`✅ Đổi tên: ${totalOk} thành công · ${totalFail} fail`, totalFail === 0 ? "success" : "warn")
      await loadItems()
      // Auto-dismiss banner sau 6s (đủ thời gian user đọc kết quả).
      setTimeout(() => setRenameProgress(null), 6000)
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || e), "error")
      setRenameProgress(null)
    } finally {
      setLoading(false)
    }
  }

  async function doDelete(targetIds?: string[]) {
    const ids = targetIds || Array.from(selectedIds)
    if (ids.length === 0) { toast.show("Chưa chọn dòng nào", "warn"); return }
    if (!confirm(`Xoá ${ids.length} dòng? (chỉ xoá trong app, KHÔNG xoá ad trên FB)`)) return
    setLoading(true)
    try {
      const res = await fetch("/api/nghiem-thu/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || "Lỗi")
      toast.show(`🗑 Đã xoá ${d.deleted} dòng`, "success")
      setSelectedIds(new Set())
      await loadItems()
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  async function doDeleteAll() {
    // Neu dang filter theo nick: xoa rieng nick do. Neu khong filter: xoa toan bo.
    const scope = affFilter ? `nick "${affLabel(affFilter)}" (${items.length} dòng)` : `TẤT CẢ ${items.length} dòng`
    if (!confirm(`Xoá ${scope}? Không undo được.`)) return
    if (!confirm("Chắc chắn? Bấm OK lần nữa để xác nhận.")) return
    setLoading(true)
    try {
      const body: any = affFilter ? { affiliateId: affFilter } : { all: true }
      const headers: any = { "Content-Type": "application/json" }
      // Server yêu cầu X-Confirm cho cả 2 case: wipe tất cả + wipe theo nick.
      if (body.all || body.affiliateId) headers["X-Confirm"] = "yes"
      const res = await fetch("/api/nghiem-thu/items", {
        method: "DELETE",
        headers,
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d?.error || "Lỗi")
      toast.show(`🗑 Đã xoá ${d.deleted} dòng`, "success")
      setSelectedIds(new Set())
      await loadItems()
    } catch (e: any) {
      toast.show("Lỗi: " + (e?.message || e), "error")
    } finally {
      setLoading(false)
    }
  }

  function affLabel(affId: string | null): string {
    return affDisplayName(affId)
  }

  async function exportExcel() {
    if (items.length === 0) { toast.show("Không có dữ liệu", "warn"); return }
    const XLSX = await import("xlsx")
    const headers = ["account_id", "campaign_name", "old_ad_name", "new_ad_name", "link_post", "shopee_link"]
    const data = items.map(i => [i.accountId, i.campaignName, i.oldAdName, i.newAdName, i.linkPost || "", i.shopeeLink || ""])
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Nghiem thu")
    const ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")
    XLSX.writeFile(wb, `nghiem-thu_${ts}.xlsx`)
  }

  async function downloadTemplate1() {
    const XLSX = await import("xlsx")
    const headers = ["account_id", "campaign_name", "old_ad_name", "new_ad_name"]
    const example = [
      ["123456789012345", "Camp Sample 1", "R0405N26", "17360030347_SHPAAR26_campaign 1_adgroup 1_post 1"],
      ["123456789012345", "Camp Sample 2", "R0405N27", "17360030347_SHPAAR26_campaign 2_adgroup 1_post 1"],
    ]
    const ws = XLSX.utils.aoa_to_sheet([headers, ...example])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, "Template")
    XLSX.writeFile(wb, "mau-file-1.xlsx")
  }

  function toggleSelect(id: string) {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedIds(next)
    setAnchorId(id)
  }
  function toggleSelectAll() {
    if (selectedIds.size === items.length) setSelectedIds(new Set())
    else setSelectedIds(new Set(items.map(i => i.id)))
  }
  // Click row body — pattern Excel/Explorer:
  //   - Plain click → REPLACE selection (refresh chọn lại từ đầu, chỉ giữ row này)
  //   - Shift+click → REPLACE với range từ anchor đến row này
  //   - Ctrl/Cmd+click → toggle additive (giữ multi-select)
  //   - Checkbox riêng: vẫn toggle additive (stopPropagation tránh bubble)
  function handleRowClick(id: string, e: React.MouseEvent) {
    // Bỏ qua click trên element có handler riêng (checkbox, link, button)
    const target = e.target as HTMLElement
    if (target.closest("input, button, a, [data-no-row-select]")) return
    if (e.shiftKey) {
      const anchor = anchorId || items[0]?.id
      if (!anchor) return
      const aIdx = items.findIndex(it => it.id === anchor)
      const bIdx = items.findIndex(it => it.id === id)
      if (aIdx >= 0 && bIdx >= 0) {
        const from = Math.min(aIdx, bIdx)
        const to = Math.max(aIdx, bIdx)
        const next = new Set<string>()
        for (let i = from; i <= to; i++) next.add(items[i].id)
        setSelectedIds(next)
        try { window.getSelection()?.removeAllRanges() } catch {}
        return // anchor không đổi
      }
    }
    if (e.ctrlKey || e.metaKey) {
      toggleSelect(id)
      return
    }
    // Plain click: REPLACE — refresh chọn lại từ đầu, chỉ tick row này.
    setSelectedIds(new Set([id]))
    setAnchorId(id)
  }

  const stats = {
    total: items.length,
    matched: items.filter(i => i.adId).length,
    renamed: items.filter(i => i.renamedAt).length,
    withLinkPost: items.filter(i => i.linkPost).length,
    withShopee: items.filter(i => i.shopeeLink).length,
  }

  return (
    <AppLayout>
      {/* Progress banner — floating top-right, hiện khi đang đổi tên hoặc vừa xong (6s grace) */}
      {renameProgress && (
        <div style={{
          position: "fixed", top: 60, right: 16, zIndex: 500,
          background: "var(--bg2)",
          border: `2px solid ${renameProgress.active ? "var(--accent)" : (renameProgress.fail === 0 ? "var(--success)" : "var(--warn)")}`,
          borderRadius: 12,
          padding: "14px 18px",
          minWidth: 280, maxWidth: 360,
          boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          fontFamily: "inherit",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 16 }}>
              {renameProgress.active ? "⏳" : (renameProgress.fail === 0 ? "✅" : "⚠️")}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>
              {renameProgress.active
                ? "Đang đổi tên ads..."
                : `Hoàn thành: ${renameProgress.ok}/${renameProgress.total}`}
            </div>
            {!renameProgress.active && (
              <button onClick={() => setRenameProgress(null)}
                style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer", padding: 0, lineHeight: 1 }}>×</button>
            )}
          </div>
          {/* Progress bar */}
          <div style={{ height: 8, background: "var(--bg3)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
            <div style={{
              width: `${Math.round((renameProgress.current / Math.max(1, renameProgress.total)) * 100)}%`,
              height: "100%",
              background: renameProgress.active ? "var(--accent)" : (renameProgress.fail === 0 ? "var(--success)" : "var(--warn)"),
              transition: "width .3s ease",
            }} />
          </div>
          {/* Stats line */}
          <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between", gap: 8 }}>
            <span>Đã đổi: <b style={{ color: "var(--text)" }}>{renameProgress.current}/{renameProgress.total}</b></span>
            <span>✓ <b style={{ color: "var(--success)" }}>{renameProgress.ok}</b></span>
            {renameProgress.fail > 0 && <span>✗ <b style={{ color: "var(--danger)" }}>{renameProgress.fail}</b></span>}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>📋 Nghiệm thu Shopee Affiliates</h1>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            Quy trình 2 bước: upload file 1 (tên ad) → đổi tên → upload file 2 (FB export) → bổ sung link → xuất Excel nộp Shopee.
          </div>
        </div>

        {/* Hướng dẫn */}
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", fontSize: 11, color: "var(--muted)" }}>
          <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>📖 Quy trình</div>
          <ol style={{ margin: "0 0 0 16px", padding: 0, display: "flex", flexDirection: "column", gap: 3 }}>
            <li><b>Bước 1:</b> Upload <b>file 1</b> (4 cột: <code>account_id, campaign_name, old_ad_name, new_ad_name</code>) → app lookup ad_id + lưu DB.</li>
            <li><b>Bước 2:</b> Chọn dòng → bấm <b>✏️ Đổi tên ads</b> → app rename qua FB API.</li>
            <li><b>Bước 3:</b> Vào <a href="https://adsmanager.facebook.com/adsmanager" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>FB Ads Manager</a> → chọn ads → Xuất → Excel (.xlsx) → tải về.</li>
            <li><b>Bước 4:</b> Upload <b>file 2</b> (file FB export, có cột <code>Ad Name</code> + <code>Body</code> + <code>Permalink</code>) → app match theo new_ad_name, bổ sung link_post + shopee_link.</li>
            <li><b>Bước 5:</b> Bấm <b>📁 Xuất Excel</b> để tải file nộp Shopee.</li>
          </ol>
        </div>

        {/* Filter nick Shopee */}
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", marginRight: 4 }}>Nick Shopee:</div>
          {affiliates.length > 0 && (
            <button onClick={() => setAffFilter("")} style={affFilter === "" ? affChipActive : affChip}>
              Tất cả ({affiliates.reduce((s, a) => s + a.count, 0)})
            </button>
          )}
          {affiliates.map(a => {
            const key = a.affiliateId || "_null_"
            const active = affFilter === key
            return (
              <button key={key} onClick={() => setAffFilter(key)} style={active ? affChipActive : affChip} title={a.affiliateId ? `Affiliate ID: ${a.affiliateId}` : ""}>
                {affLabel(a.affiliateId)} ({a.count})
              </button>
            )
          })}
          <button onClick={openLabelModal} style={{ ...affChip, marginLeft: "auto", borderStyle: "dashed" }}>
            ⚙️ Cấu hình tên nick
          </button>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={downloadTemplate1} style={btnSecondary}>📥 Tải mẫu file 1</button>
          <button onClick={() => file1Ref.current?.click()} disabled={loading} style={btnPrimary}>📤 Upload file 1 (tên ad)</button>
          <input ref={file1Ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile1(f); e.target.value = "" }} />
          <button onClick={() => file2Ref.current?.click()} disabled={loading || items.length === 0} style={btnPrimary}>📤 Upload file 2 (FB export)</button>
          <input ref={file2Ref} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile2(f); e.target.value = "" }} />
          <button onClick={doLookupRetry} disabled={loading || stats.total === stats.matched}
            title="Re-lookup ad_id cho dòng chưa match (hoặc selected)"
            style={{ ...btnSecondary, borderColor: stats.total > stats.matched ? "var(--warn)" : "var(--border)", color: stats.total > stats.matched ? "var(--warn)" : "var(--muted)" }}>
            🔍 Tra cứu lại ({stats.total - stats.matched})
          </button>
          <button onClick={() => doRename()} disabled={loading || stats.matched === stats.renamed} style={btnWarn}>✏️ Đổi tên ads ({stats.matched - stats.renamed})</button>
          <button onClick={exportExcel} disabled={items.length === 0} style={btnSecondary}>📁 Xuất Excel nộp Shopee</button>
          <button onClick={() => doDelete()} disabled={selectedIds.size === 0} style={btnGhost}>🗑 Xoá ({selectedIds.size})</button>
          <button onClick={doDeleteAll} disabled={items.length === 0} style={btnGhost}>🗑 {affFilter ? `Xoá nick này` : "Xoá tất cả"}</button>
          <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
            {affFilter ? `[${affLabel(affFilter)}] ` : ""}{stats.total} dòng · {stats.matched} có ad_id · {stats.renamed} đã đổi tên · {stats.withLinkPost} có link · {stats.withShopee} có Shopee
          </div>
        </div>

        {/* Bảng */}
        {items.length > 0 ? (
          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, background: "var(--bg2)" }}>
              <thead style={{ background: "var(--bg3)", position: "sticky", top: 0 }}>
                <tr>
                  <th style={th}><input type="checkbox" checked={selectedIds.size === items.length && items.length > 0} onChange={toggleSelectAll} /></th>
                  <th style={th}>#</th>
                  <th style={th}>ID TKQC</th>
                  <th style={th}>Tên camp</th>
                  <th style={th}>Tên ad cũ</th>
                  <th style={th}>Tên ad nghiệm thu</th>
                  <th style={th}>Link post</th>
                  <th style={th}>Link Shopee</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}
                    onMouseDown={(e) => { if (e.shiftKey) e.preventDefault() }}
                    onClick={(e) => handleRowClick(it.id, e)}
                    style={{
                      borderTop: "1px solid var(--border)",
                      background: selectedIds.has(it.id) ? "rgba(79,126,248,.1)" : undefined,
                      cursor: "pointer",
                      userSelect: "none",
                    }}>
                    <td style={td}><input type="checkbox" checked={selectedIds.has(it.id)} onChange={() => toggleSelect(it.id)} onClick={(e) => e.stopPropagation()} /></td>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontFamily: "monospace", fontSize: 10 }}>{it.accountId}</td>
                    <td style={td}>{it.campaignName}</td>
                    <td style={td} title={it.adId || it.lookupError || ""}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {!it.adId && it.lookupError && (
                          <span title={it.lookupError} style={{ color: "var(--warn)", cursor: "help", fontSize: 12 }}>⚠️</span>
                        )}
                        <span>{it.oldAdName}</span>
                      </div>
                      {it.adId && <span style={{ display: "block", color: "var(--muted)", fontSize: 9 }}>ad_id: {it.adId}</span>}
                      {!it.adId && it.lookupError && (
                        <span style={{ display: "block", color: "var(--warn)", fontSize: 9, marginTop: 2 }}>
                          {it.lookupError.length > 60 ? it.lookupError.slice(0, 60) + "…" : it.lookupError}
                        </span>
                      )}
                    </td>
                    <td style={td}>{it.newAdName}</td>
                    <td style={td}>{it.linkPost ? <a href={it.linkPost} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{it.linkPost.length > 50 ? it.linkPost.slice(0, 50) + "..." : it.linkPost}</a> : "—"}</td>
                    <td style={td}>{it.shopeeLink ? <a href={it.shopeeLink} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>{it.shopeeLink}</a> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", border: "1px dashed var(--border)", borderRadius: 8 }}>
            Chưa có dữ liệu. Bấm <b>📤 Upload file 1</b> để bắt đầu.
          </div>
        )}
      </div>

      {/* Modal cấu hình label nick Shopee */}
      {labelModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(4px)", padding: 12 }}>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border2)", borderRadius: 12, width: 560, maxWidth: "100%", maxHeight: "85vh", padding: 22, display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
            <button onClick={() => setLabelModalOpen(false)} style={{ position: "absolute", top: 16, right: 16, background: "transparent", border: "none", color: "var(--muted)", fontSize: 24, cursor: "pointer", lineHeight: 1, width: 32, height: 32 }}>×</button>
            <div style={{ fontSize: 15, fontWeight: 600 }}>⚙️ Cấu hình tên nick Shopee Affiliate</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              Đặt tên dễ nhớ cho từng <code>Affiliate ID</code>. Tên này hiển thị trên chip filter thay vì dãy số.
              Để trống <b>Tên hiển thị</b> + bấm Lưu để xoá label.
            </div>
            <div style={{ height: 1, background: "var(--border)" }} />

            <div style={{ display: "flex", flexDirection: "column", gap: 6, overflowY: "auto", maxHeight: "50vh" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 30px", gap: 8, fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", padding: "0 2px" }}>
                <div>Affiliate ID</div>
                <div>Tên hiển thị</div>
                <div></div>
              </div>
              {labelDraft.map((d, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 30px", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    value={d.affiliateId}
                    onChange={e => setLabelDraft(arr => arr.map((x, j) => j === i ? { ...x, affiliateId: e.target.value } : x))}
                    placeholder="17305500347"
                    style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 12, padding: "6px 9px", height: 32, outline: "none", fontFamily: "monospace" }}
                  />
                  <input
                    type="text"
                    value={d.label}
                    onChange={e => setLabelDraft(arr => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))}
                    placeholder="VD: Tổng Kho Lý Ngô"
                    style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 5, color: "var(--text)", fontSize: 12, padding: "6px 9px", height: 32, outline: "none" }}
                  />
                  <button
                    onClick={() => setLabelDraft(arr => arr.filter((_, j) => j !== i))}
                    title="Xoá dòng này"
                    style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", borderRadius: 5, cursor: "pointer", height: 32, fontSize: 14 }}
                  >×</button>
                </div>
              ))}
              <button
                onClick={() => setLabelDraft(arr => [...arr, { affiliateId: "", label: "" }])}
                style={{ marginTop: 6, padding: "6px 10px", background: "transparent", border: "1px dashed var(--border)", color: "var(--muted)", borderRadius: 5, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}
              >+ Thêm nick</button>
            </div>

            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", paddingTop: 4 }}>
              <button onClick={() => setLabelModalOpen(false)} style={{ padding: "8px 16px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }}>Huỷ</button>
              <button onClick={saveLabels} disabled={loading} style={{ padding: "8px 18px", borderRadius: 6, fontSize: 13, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500, opacity: loading ? 0.5 : 1 }}>
                {loading ? "Đang lưu..." : "Lưu"}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  )
}

const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontSize: 10, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", whiteSpace: "nowrap" }
const td: React.CSSProperties = { padding: "8px 10px", verticalAlign: "top" }
const btnPrimary: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontWeight: 500 }
const btnWarn: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "none", background: "var(--warn)", color: "#fff", fontWeight: 500 }
const btnSecondary: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "var(--bg2)", color: "var(--text)" }
const btnGhost: React.CSSProperties = { padding: "7px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)" }
const affChip: React.CSSProperties = { padding: "5px 10px", borderRadius: 14, fontSize: 11, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontFamily: "inherit" }
const affChipActive: React.CSSProperties = { ...affChip, background: "var(--accent)", color: "#fff", border: "1px solid var(--accent)", fontWeight: 500 }
