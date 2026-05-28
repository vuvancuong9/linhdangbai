"use client"
import { ToastProvider } from "./Toast"
import { ConfirmProvider } from "./Confirm"
import PWARegister from "./PWARegister"

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConfirmProvider>
      <ToastProvider>
        <PWARegister />
        {children}
      </ToastProvider>
    </ConfirmProvider>
  )
}
