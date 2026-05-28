"use client"
// Hook: detect mobile viewport (<700px). Tự update khi resize/rotate.
// Trả false trong SSR để tránh hydration mismatch.
import { useEffect, useState } from "react"

export function useIsMobile(breakpoint = 700): boolean {
  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    if (typeof window === "undefined") return
    const check = () => setIsMobile(window.innerWidth < breakpoint)
    check()
    window.addEventListener("resize", check)
    return () => window.removeEventListener("resize", check)
  }, [breakpoint])
  return isMobile
}
