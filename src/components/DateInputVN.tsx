"use client"
import { useEffect, useRef, useState } from "react"

// Input ngày kiểu Việt Nam: hiển thị dd/mm/yyyy.
// value và onChange luôn dùng ISO format: yyyy-mm-dd (giống <input type="date">).
// Click icon lịch để mở native date picker.
export default function DateInputVN({
  value,
  onChange,
  max,
  min,
  style,
  placeholder = "dd/mm/yyyy",
}: {
  value: string
  onChange: (v: string) => void
  max?: string
  min?: string
  style?: React.CSSProperties
  placeholder?: string
}) {
  const isoToVn = (iso: string) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ""
    const [y, m, d] = iso.split("-")
    return `${d}/${m}/${y}`
  }
  const vnToIso = (vn: string) => {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(vn)) return ""
    const [d, m, y] = vn.split("/")
    return `${y}-${m}-${d}`
  }

  // Auto-clamp + format dd/mm/yyyy.
  // - dd: 1-31, single digit 4-9 tự pad thành 04-09 (vì 40+ không hợp lệ)
  // - mm: 1-12, single digit 2-9 tự pad thành 02-09 (vì 20+ tháng vô nghĩa)
  // - yyyy: 4 digit cuối, không clamp
  const formatMask = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 8)
    if (digits.length === 0) return ""

    let dd = digits.slice(0, Math.min(2, digits.length))
    if (dd.length === 1 && parseInt(dd) > 3) dd = "0" + dd
    if (dd.length === 2) {
      let d = parseInt(dd)
      if (d > 31) d = 31
      if (d < 1) d = 1
      dd = d.toString().padStart(2, "0")
    }
    if (digits.length <= 2) return dd

    let mm = digits.slice(2, Math.min(4, digits.length))
    if (mm.length === 1 && parseInt(mm) > 1) mm = "0" + mm
    if (mm.length === 2) {
      let m = parseInt(mm)
      if (m > 12) m = 12
      if (m < 1) m = 1
      mm = m.toString().padStart(2, "0")
    }
    if (digits.length <= 4) return dd + "/" + mm

    const yyyy = digits.slice(4, 8)
    return dd + "/" + mm + "/" + yyyy
  }

  const [text, setText] = useState(isoToVn(value))
  const dateRef = useRef<HTMLInputElement>(null)

  // Chỉ sync text từ value khi value thực sự khác — tránh ghi đè khi user đang gõ.
  useEffect(() => {
    const currentIso = vnToIso(text)
    if (currentIso !== value) setText(isoToVn(value))
  }, [value])

  function handleText(e: React.ChangeEvent<HTMLInputElement>) {
    const v = formatMask(e.target.value)
    setText(v)
    const iso = vnToIso(v)
    if (iso) onChange(iso)
  }

  function handleBlur() {
    if (!text) { onChange(""); return }
    const iso = vnToIso(text)
    if (!iso) setText(isoToVn(value)) // Revert nếu nhập sai/chưa đủ
  }

  function openPicker() {
    if (!dateRef.current) return
    try {
      ;(dateRef.current as any).showPicker?.()
    } catch {}
    dateRef.current.focus()
    dateRef.current.click()
  }

  return (
    <div style={{ position: "relative", display: "inline-block", ...(style?.width ? { width: style.width } : {}) }}>
      <input
        type="text"
        value={text}
        onChange={handleText}
        onBlur={handleBlur}
        placeholder={placeholder}
        inputMode="numeric"
        autoComplete="off"
        style={{ ...style, paddingRight: 26, width: "100%", boxSizing: "border-box" } as React.CSSProperties}
      />
      <button
        type="button"
        onClick={openPicker}
        title="Mở lịch"
        aria-label="Mở lịch chọn ngày"
        style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", height: 22, width: 22, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "transparent", color: "var(--muted)", cursor: "pointer", borderRadius: 4 }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </button>
      <input
        ref={dateRef}
        type="date"
        value={value}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 0, height: 0, right: 0, top: 0 }}
        tabIndex={-1}
      />
    </div>
  )
}
