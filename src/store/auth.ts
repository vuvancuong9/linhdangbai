import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  userId: string
  email: string
  role: 'SUPER_ADMIN' | 'ADMIN' | 'USER'
  name: string
  userType?: 'accountant' | 'product_finder' | null
  permissions?: string | null
}

interface AuthStore {
  user: AuthUser | null
  setUser: (user: AuthUser | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      logout: () => set({ user: null }),
    }),
    { name: 'fb-ads-auth' }
  )
)
