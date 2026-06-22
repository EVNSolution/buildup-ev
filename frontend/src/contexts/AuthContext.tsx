import { createContext, useContext, useState } from 'react'
import type { AuthUser, UserRole } from '@shared/types/index'

interface AuthContextValue {
  user: AuthUser
  setRole: (role: UserRole) => void
}

const MOCK_USERS: Record<UserRole, AuthUser> = {
  sales: { id: 'u1', name: '여준성', role: 'sales' },
  admin: { id: 'u2', name: '관리자', role: 'admin' },
  conversion: { id: 'u3', name: '특장사담당', role: 'conversion' },
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(MOCK_USERS.sales)

  function setRole(role: UserRole) {
    setUser(MOCK_USERS[role])
  }

  return <AuthContext.Provider value={{ user, setRole }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
