"use client"
import { useState, useRef, useEffect, useMemo } from "react"

// =============== Helpers ===============
const DAY_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"]
const MONTH_NAMES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]

const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
const parseISO = (s: string): Date | null => {
  const m = s?.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return null
  const d = new Date(+m[1], +m[2] - 1, +m[3])
  return isNaN(d.getTime()) ? null : d
}
const fmtVN = (s: string) => {
  const d = parseISO(s)
  if (!d) return s
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`
}
// Long form VN: "22 Tháng 5 2026" — dùng cho header mobile bottom sheet.
const fmtLongVN = (s: string) => {
  const d = parseISO(s)
  if (!d) return s
  return `${d.getDate()} Tháng ${d.getMonth() + 1} ${d.getFullYear()}`
}
const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1)
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0)
const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1)
const endOfYear = (d: Date) => new Date(d.getFullYear(), 11, 31)
const startOfQuarter = (d: Date) => {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3, 1)
}
const endOfQuarter = (d: Date) => {
  const q = Math.floor(d.getMonth() / 3)
  return new Date(d.getFullYear(), q * 3 + 3, 0)
}
// Tuần Mon–Sun (chuẩn VN). Calendar hiển thị lưới CN-T7 nhưng "Tuần này" lấy Mon–Sun.
const startOfWeekMon = (d: Date) => {
  const day = d.getDay() // Sun=0
  const diff = day === 0 ? -6 : 1 - day
  return addDays(d, diff)
}
const endOfWeekMon = (d: Date) => addDays(startOfWeekMon(d), 6)

// =============== Presets ===============
export type DateRangePreset = { id: string; label: string; calc: (today: Date) => [Date, Date] }
// Re-export utils để page có thể tự build preset list (vd trinh-quan-ly cần "Hôm nay")
export { addDays, startOfMonth, endOfMonth, startOfWeekMon, endOfWeekMon }

const getPresets = (): DateRangePreset[] => [
  // "Hôm nay" bị bỏ vì data FB Ads + Shopee đều delay 24h, hôm nay chưa có số đầy đủ.
  // "Tổng thời gian": lùi đến năm 2000, sẽ tự clamp về `min` prop (DATA_LOCK_DATE).
  { id: "all", label: "Tổng thời gian", calc: (t) => [new Date(2000, 0, 1), t] },
  { id: "yesterday", label: "Hôm qua", calc: (t) => { const y = addDays(t, -1); return [y, y] } },
  { id: "7d", label: "7 ngày qua", calc: (t) => [addDays(t, -6), t] },
  { id: "14d", label: "14 ngày qua", calc: (t) => [addDays(t, -13), t] },
  { id: "28d", label: "28 ngày qua", calc: (t) => [addDays(t, -27), t] },
  { id: "30d", label: "30 ngày qua", calc: (t) => [addDays(t, -29), t] },
  { id: "thisWeek", label: "Tuần này", calc: (t) => [startOfWeekMon(t), endOfWeekMon(t)] },
  { id: "lastWeek", label: "Tuần trước", calc: (t) => { const lw = addDays(t, -7); return [startOfWeekMon(lw), endOfWeekMon(lw)] } },
  { id: "thisMonth", label: "Tháng này", calc: (t) => [startOfMonth(t), endOfMonth(t)] },
  { id: "lastMonth", label: "Tháng trước", calc: (t) => { const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1); return [startOfMonth(lm), endOfMonth(lm)] } },
  { id: "thisQuarter", label: "Quý này", calc: (t) => [startOfQuarter(t), endOfQuarter(t)] },
  { id: "lastQuarter", label: "Quý trước", calc: (t) => { const lq = new Date(t.getFullYear(), t.getMonth() - 3, 1); return [startOfQuarter(lq), endOfQuarter(lq)] } },
  { id: "thisYear", label: "Năm nay", calc: (t) => [startOfYear(t), endOfYear(t)] },
  { id: "lastYear", label: "Năm trước", calc: (t) => { const ly = new Date(t.getFullYear() - 1, 0, 1); return [startOfYear(ly), endOfYear(ly)] } },
  { id: "custom", label: "Tùy chỉnh", calc: (t) => [t, t] },
]

function detectPreset(from: string, to: string, maxIso?: string, minIso?: string, presetList?: DateRangePreset[]): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const list = presetList || getPresets()
  for (const p of list) {
    if (p.id === "custom") continue
    let [a, b] = p.calc(today)
    // Clamp end về max
    if (maxIso) {
      const maxD = parseISO(maxIso)
      if (maxD && b > maxD) b = maxD
    }
    // Clamp start về min
    if (minIso) {
      const minD = parseISO(minIso)
      if (minD && a < minD) a = minD
    }
    if (isoDate(a) === from && isoDate(b) === to) return p.id
  }
  return "custom"
}

// =============== Main component ===============
type Props = {
  from: string
  to: string
  onChange: (from: string, to: string) => void
  max?: string                   // YYYY-MM-DD: ngày tối đa được phép chọn
  min?: string                   // YYYY-MM-DD: ngày tối thiểu được phép chọn
  align?: "left" | "right"        // dropdown anchor
  triggerStyle?: React.CSSProperties
  width?: number                  // chiều rộng trigger
  disabled?: boolean
  // Override preset list (vd FB Ads Manager cần "Hôm nay", không cần "Quý/Năm").
  // Khi truyền `custom` preset cần có id="custom" để giữ logic không apply.
  presets?: DateRangePreset[]
}

export default function DateRangePickerVN({ from, to, onChange, max, min, align = "left", triggerStyle, width, disabled, presets }: Props) {
  const presetList = presets || getPresets()
  // Mobile responsive: stack vertical + 1 calendar
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const check = () => setIsMobile(window.innerWidth < 700)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [])
  const [open, setOpen] = useState(false)
  const [tempFrom, setTempFrom] = useState(from)
  const [tempTo, setTempTo] = useState(to)
  const [pickStep, setPickStep] = useState<"start" | "end">("start") // bước tiếp theo: chọn start hay end
  const [viewMonth, setViewMonth] = useState<Date>(parseISO(from) || new Date())
  // Local string state cho 2 ô input để user gõ tay (DD/MM/YYYY)
  const [fromInput, setFromInput] = useState("")
  const [toInput, setToInput] = useState("")
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  // Position của popup (fixed → tránh bị clip bởi parent overflow:hidden)
  const [popupPos, setPopupPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0, left: 0 })

  // Sync input text khi temp đổi (do click calendar / preset)
  useEffect(() => { setFromInput(fmtVN(tempFrom)); setToInput(fmtVN(tempTo)) }, [tempFrom, tempTo])

  // Reset temp + tính position khi mở
  useEffect(() => {
    if (open) {
      setTempFrom(from)
      setTempTo(to)
      const d = parseISO(from) || new Date()
      setViewMonth(new Date(d.getFullYear(), d.getMonth(), 1))
      setPickStep("start")
      // Tính vị trí popup
      const rect = triggerRef.current?.getBoundingClientRect()
      if (rect) {
        const top = rect.bottom + 4
        // Mobile: full width minus 8px margin, ignore trigger position.
        if (window.innerWidth < 700) {
          setPopupPos({ top, left: 8 })
        } else if (align === "right") {
          // Popup right-aligned với trigger
          setPopupPos({ top, right: window.innerWidth - rect.right })
        } else {
          // Popup left-aligned, nhưng nếu vượt phải viewport → flip về right
          const POPUP_WIDTH = 620
          let left = rect.left
          if (left + POPUP_WIDTH > window.innerWidth - 8) {
            left = Math.max(8, window.innerWidth - POPUP_WIDTH - 8)
          }
          setPopupPos({ top, left })
        }
      }
    }
  }, [open, from, to, align])

  // Click outside → đóng (check cả trigger lẫn popup vì popup giờ ở ngoài DOM tree)
  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (wrapperRef.current?.contains(t)) return
      if (popupRef.current?.contains(t)) return
      setOpen(false)
    }
    if (open) {
      document.addEventListener("mousedown", handler)
      return () => document.removeEventListener("mousedown", handler)
    }
  }, [open])

  // Đóng khi scroll/resize (tránh popup lệch khỏi trigger)
  useEffect(() => {
    if (!open) return
    function close() { setOpen(false) }
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [open])

  function applyPreset(presetId: string) {
    if (presetId === "custom") return
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const p = presetList.find((x) => x.id === presetId)
    if (!p) return
    let [a, b] = p.calc(today)
    if (max) { const maxD = parseISO(max); if (maxD && b > maxD) b = maxD }
    if (min) { const minD = parseISO(min); if (minD && a < minD) a = minD }
    // Nếu sau clamp a > b → preset không hợp lệ (phạm vi nằm hoàn toàn ngoài min/max)
    if (a > b) { a = b }
    setTempFrom(isoDate(a))
    setTempTo(isoDate(b))
    setViewMonth(new Date(a.getFullYear(), a.getMonth(), 1))
    setPickStep("start")
  }

  // Commit input text (DD/MM/YYYY) → tempFrom/tempTo. Restore nếu invalid.
  function commitInput(which: "from" | "to") {
    const txt = (which === "from" ? fromInput : toInput).trim()
    const m = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (!m) {
      // Invalid → restore từ temp
      if (which === "from") setFromInput(fmtVN(tempFrom))
      else setToInput(fmtVN(tempTo))
      return
    }
    const dd = +m[1], mm = +m[2], yyyy = +m[3]
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
      if (which === "from") setFromInput(fmtVN(tempFrom))
      else setToInput(fmtVN(tempTo))
      return
    }
    const d = new Date(yyyy, mm - 1, dd)
    if (isNaN(d.getTime()) || d.getFullYear() !== yyyy || d.getMonth() !== mm - 1 || d.getDate() !== dd) {
      // VD: 31/2/2026 → JS auto-correct. Restore.
      if (which === "from") setFromInput(fmtVN(tempFrom))
      else setToInput(fmtVN(tempTo))
      return
    }
    // Clamp min/max
    const minD = min ? parseISO(min) : null
    const maxD = max ? parseISO(max) : null
    let final = d
    if (minD && final < minD) final = minD
    if (maxD && final > maxD) final = maxD
    const newIso = isoDate(final)
    if (which === "from") {
      setTempFrom(newIso)
      // Nếu from > tempTo → cập nhật tempTo = newIso
      if (parseISO(tempTo)! < final) setTempTo(newIso)
    } else {
      setTempTo(newIso)
      if (parseISO(tempFrom)! > final) setTempFrom(newIso)
    }
    // Move calendar view
    setViewMonth(new Date(final.getFullYear(), final.getMonth(), 1))
  }

  function clickDay(d: Date) {
    const iso = isoDate(d)
    if (pickStep === "start") {
      setTempFrom(iso)
      setTempTo(iso)
      setPickStep("end")
    } else {
      const fromD = parseISO(tempFrom)!
      if (d < fromD) {
        // Click ngày nhỏ hơn → đặt làm start mới
        setTempFrom(iso)
        setTempTo(isoDate(fromD))
      } else {
        setTempTo(iso)
      }
      setPickStep("start")
    }
  }

  function confirm() {
    onChange(tempFrom, tempTo)
    setOpen(false)
  }
  function cancel() {
    setOpen(false)
  }

  const currentPreset = useMemo(() => detectPreset(tempFrom, tempTo, max, min, presetList), [tempFrom, tempTo, max, min, presetList])
  const triggerLabel = useMemo(() => {
    const fp = detectPreset(from, to, max, min, presetList)
    if (fp !== "custom") {
      const p = presetList.find((x) => x.id === fp)
      if (p) return `${p.label}: ${fmtVN(from)} – ${fmtVN(to)}`
    }
    return `${fmtVN(from)} – ${fmtVN(to)}`
  }, [from, to, max, min, presetList])

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-block", width: width || "auto" }}>
      <button
        ref={triggerRef}
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        style={{
          width: "100%",
          height: 30,
          padding: "0 10px",
          borderRadius: 6,
          border: "1px solid var(--border)",
          background: "var(--bg2)",
          color: "var(--text)",
          fontSize: 12,
          fontFamily: "inherit",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
          textAlign: "left",
          opacity: disabled ? 0.6 : 1,
          ...triggerStyle,
        }}
        title={triggerLabel}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0 }}>
          <rect x="2" y="3" width="12" height="11" rx="1" />
          <path d="M2 6h12M5 1v3M11 1v3" />
        </svg>
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{triggerLabel}</span>
        <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" style={{ flexShrink: 0, opacity: 0.6 }}>
          <path d="M3 4l3 4 3-4z" />
        </svg>
      </button>

      {open && isMobile && (
        <>
          {/* Backdrop mờ phía sau bottom sheet */}
          <div onClick={cancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 999 }} />
          {/* Bottom sheet — giống FB Ads Manager mobile */}
          <div
            ref={popupRef}
            style={{
              position: "fixed",
              left: 0, right: 0, bottom: 0,
              background: "var(--bg2)",
              borderRadius: "16px 16px 0 0",
              boxShadow: "0 -8px 28px rgba(0,0,0,.3)",
              zIndex: 1000,
              display: "flex",
              flexDirection: "column",
              maxHeight: "92vh",
            }}
          >
            {/* Title bar */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 18px", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 17, fontWeight: 700 }}>Lọc theo ngày</span>
              <button onClick={cancel} aria-label="Đóng"
                style={{ background: "transparent", border: "none", color: "var(--muted)", fontSize: 26, lineHeight: 1, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>×</button>
            </div>

            {/* Range label — DD Tháng M YYYY - DD Tháng M YYYY */}
            <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: "var(--text)" }}>
                <b>{fmtLongVN(tempFrom)}</b> <span style={{ color: "var(--muted)", fontWeight: 400 }}>-</span> <b>{fmtLongVN(tempTo)}</b>
              </div>
            </div>

            {/* Calendar — body scroll riêng nếu cao quá */}
            <div style={{ padding: "10px 16px 16px", overflowY: "auto", flex: 1 }}>
              <MonthCalendar
                mobile
                month={viewMonth}
                from={tempFrom}
                to={tempTo}
                max={max}
                min={min}
                onClickDay={clickDay}
                onPrev={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                onNext={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                showPrev
                showNext
              />
            </div>

            {/* Preset chips horizontal scroll */}
            <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, overflowX: "auto", flexWrap: "nowrap", WebkitOverflowScrolling: "touch" }}>
              {presetList.filter(p => p.id !== "custom").map(p => {
                const active = currentPreset === p.id
                return (
                  <button key={p.id} onClick={() => applyPreset(p.id)}
                    style={{
                      flexShrink: 0,
                      padding: "10px 16px",
                      borderRadius: 22,
                      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      background: active ? "rgba(79,126,248,.12)" : "var(--bg3)",
                      color: active ? "var(--accent)" : "var(--text)",
                      fontSize: 14,
                      fontWeight: active ? 600 : 500,
                      whiteSpace: "nowrap",
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}>
                    {p.label}
                  </button>
                )
              })}
            </div>

            {/* Bottom Xong button — full-width CTA */}
            <div style={{ padding: "12px 16px", paddingBottom: "max(16px, env(safe-area-inset-bottom))", borderTop: "1px solid var(--border)" }}>
              <button onClick={confirm}
                style={{ width: "100%", padding: "14px 0", borderRadius: 10, background: "var(--accent)", color: "#fff", fontSize: 16, fontWeight: 600, border: "none", cursor: "pointer", fontFamily: "inherit" }}>
                Xong
              </button>
            </div>
          </div>
        </>
      )}

      {open && !isMobile && (
        <div
          ref={popupRef}
          style={{
            position: "fixed",
            top: popupPos.top,
            ...(popupPos.left !== undefined ? { left: popupPos.left } : { right: popupPos.right }),
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            boxShadow: "0 10px 28px rgba(0,0,0,.4)",
            zIndex: 1000,
            padding: 14,
            display: "flex",
            flexDirection: "row",
            gap: 14,
            minWidth: 600,
          } as React.CSSProperties}
        >
          {/* Sidebar presets — desktop column */}
          <div className="dr-preset-scroll" style={{ width: 130, display: "flex", flexDirection: "column", gap: 1, maxHeight: "min(450px, calc(100vh - 140px))", overflowY: "auto", paddingRight: 6 }}>
            {presetList.map((p) => {
              const active = currentPreset === p.id
              return (
                <label
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "6px 8px",
                    borderRadius: 5,
                    background: active ? "rgba(79,126,248,.12)" : "transparent",
                    color: active ? "var(--accent)" : "var(--text)",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: `2px solid ${active ? "var(--accent)" : "var(--border2)"}`,
                      background: "transparent",
                      position: "relative",
                      flexShrink: 0,
                    }}
                  >
                    {active && <span style={{ position: "absolute", inset: 2, borderRadius: "50%", background: "var(--accent)" }} />}
                  </span>
                  {p.label}
                </label>
              )
            })}
          </div>

          {/* Calendar area */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <MonthCalendar
                month={viewMonth}
                from={tempFrom}
                to={tempTo}
                max={max}
                min={min}
                onClickDay={clickDay}
                onPrev={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
                onNext={null}
                showPrev
                showNext={false}
              />
              <MonthCalendar
                month={new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1)}
                from={tempFrom}
                to={tempTo}
                max={max}
                min={min}
                onClickDay={clickDay}
                onPrev={null}
                onNext={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
                showPrev={false}
                showNext
              />
            </div>

            {/* Date inputs */}
            <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={fromInput}
                placeholder="DD/MM/YYYY"
                onChange={(e) => setFromInput(e.target.value)}
                onBlur={() => commitInput("from")}
                onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur() }}
                style={{ flex: 1, padding: "0 10px", height: 30, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
              <span style={{ color: "var(--muted)" }}>→</span>
              <input
                type="text"
                value={toInput}
                placeholder="DD/MM/YYYY"
                onChange={(e) => setToInput(e.target.value)}
                onBlur={() => commitInput("to")}
                onKeyDown={(e) => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur() }}
                style={{ flex: 1, padding: "0 10px", height: 30, borderRadius: 5, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>

            {/* Footer */}
            <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Múi giờ Việt Nam (GMT+7)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={cancel}
                  style={{ padding: "6px 14px", borderRadius: 5, fontSize: 12, cursor: "pointer", border: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontFamily: "inherit" }}
                >
                  Hủy
                </button>
                <button
                  onClick={confirm}
                  style={{ padding: "6px 16px", borderRadius: 5, fontSize: 12, cursor: "pointer", border: "none", background: "var(--accent)", color: "#fff", fontFamily: "inherit", fontWeight: 500 }}
                >
                  Cập nhật
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// =============== Month Calendar ===============
function MonthCalendar({
  month,
  from,
  to,
  max,
  min,
  onClickDay,
  onPrev,
  onNext,
  showPrev,
  showNext,
  mobile,
}: {
  month: Date
  from: string
  to: string
  max?: string
  min?: string
  onClickDay: (d: Date) => void
  onPrev: (() => void) | null
  onNext: (() => void) | null
  showPrev: boolean
  showNext: boolean
  mobile?: boolean
}) {
  const fromD = parseISO(from)
  const toD = parseISO(to)
  const maxD = max ? parseISO(max) : null
  const minD = min ? parseISO(min) : null
  const firstDay = startOfMonth(month)
  const lastDay = endOfMonth(month)
  const startCol = firstDay.getDay() // CN=0 → cột 0
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const todayIso = isoDate(today)

  const cells: (Date | null)[] = []
  for (let i = 0; i < startCol; i++) cells.push(null)
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 42) cells.push(null)

  // Mobile: cell to 44px + nút prev/next round.
  const CELL_H = mobile ? 44 : 28
  const FONT_DAY = mobile ? 15 : 12
  const FONT_HEADER = mobile ? 16 : 12

  return (
    <div style={{ width: mobile ? "100%" : 224 }}>
      {/* Header — mobile: tên tháng giữa + 2 nút round 2 bên */}
      <div style={{ display: "flex", alignItems: "center", marginBottom: mobile ? 12 : 8, height: mobile ? 40 : 22, padding: mobile ? "0 4px" : 0 }}>
        {mobile ? (
          <button onClick={onPrev || undefined} disabled={!showPrev}
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: showPrev ? "var(--bg3)" : "rgba(0,0,0,.05)", color: showPrev ? "var(--text)" : "var(--muted)", fontSize: 20, cursor: showPrev ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>‹</button>
        ) : (
          <button onClick={onPrev || undefined} disabled={!showPrev} style={navBtnStyle(showPrev)}>‹</button>
        )}
        <div style={{ flex: 1, textAlign: "center", fontSize: FONT_HEADER, fontWeight: 600 }}>
          Tháng {MONTH_NAMES[month.getMonth()]} {month.getFullYear()}
        </div>
        {mobile ? (
          <button onClick={onNext || undefined} disabled={!showNext}
            style={{ width: 36, height: 36, borderRadius: "50%", border: "none", background: showNext ? "var(--bg3)" : "rgba(0,0,0,.05)", color: showNext ? "var(--text)" : "var(--muted)", fontSize: 20, cursor: showNext ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>›</button>
        ) : (
          <button onClick={onNext || undefined} disabled={!showNext} style={navBtnStyle(showNext)}>›</button>
        )}
      </div>

      {/* Day name row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: mobile ? 4 : 2 }}>
        {DAY_NAMES.map((d) => (
          <div key={d} style={{ fontSize: mobile ? 12 : 10, color: "var(--muted)", textAlign: "center", padding: mobile ? "8px 0" : "4px 0", fontWeight: 600 }}>
            {d}
          </div>
        ))}
      </div>

      {/* Cells */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 0 }}>
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ height: CELL_H }} />
          const iso = isoDate(d)
          const isStart = iso === from
          const isEnd = iso === to
          const inRange = fromD && toD && d >= fromD && d <= toD && !isStart && !isEnd
          const disabled = !!((maxD && d > maxD) || (minD && d < minD))
          const isToday = iso === todayIso

          let bg = "transparent"
          let color = disabled ? "var(--muted)" : "var(--text)"
          let radius = "0"
          if (isStart && isEnd) { bg = "var(--accent)"; color = "#fff"; radius = mobile ? "50%" : "4px" }
          else if (isStart) { bg = "var(--accent)"; color = "#fff"; radius = mobile ? "50%" : "4px 0 0 4px" }
          else if (isEnd) { bg = "var(--accent)"; color = "#fff"; radius = mobile ? "50%" : "0 4px 4px 0" }
          else if (inRange) { bg = "rgba(79,126,248,.18)"; color = "var(--accent)"; radius = "0" }

          return (
            <div
              key={i}
              onClick={() => !disabled && onClickDay(d)}
              style={{
                height: CELL_H,
                lineHeight: `${CELL_H}px`,
                fontSize: FONT_DAY,
                textAlign: "center",
                cursor: disabled ? "not-allowed" : "pointer",
                background: bg,
                color,
                borderRadius: radius,
                opacity: disabled ? 0.4 : 1,
                fontWeight: isStart || isEnd ? 700 : (mobile ? 500 : 400),
                position: "relative",
                userSelect: "none",
              }}
            >
              {d.getDate()}
              {isToday && !isStart && !isEnd && (
                <span style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", width: 4, height: 4, borderRadius: "50%", background: "var(--accent)" }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const navBtnStyle = (visible: boolean): React.CSSProperties => ({
  width: 22,
  height: 22,
  borderRadius: 4,
  border: "none",
  background: "transparent",
  color: visible ? "var(--text)" : "transparent",
  fontSize: 16,
  cursor: visible ? "pointer" : "default",
  fontFamily: "inherit",
  visibility: visible ? "visible" : "hidden",
})
