import { createContext, useContext, useState } from 'react'
import type { AuthUser, Role } from '@shared/types/index'

interface AuthContextValue {
  user: AuthUser
  setRole: (role: Role) => void
}

const MOCK_USERS: Record<Role, AuthUser> = {
  SALES: { id: 'sales1@evnsolution.com', name: '여준성', role: 'SALES', org_code: 'ORG_HQ' },
  ADMIN: { id: 'admin@evnsolution.com',  name: '관리자', role: 'ADMIN', org_code: 'ORG_HQ' },
  MAKER: { id: 'maker1@partner.com',     name: '특장담당', role: 'MAKER', org_code: 'ORG_MAKER1' },
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser>(MOCK_USERS.SALES)

  function setRole(role: Role) {
    setUser(MOCK_USERS[role])
  }

  return <AuthContext.Provider value={{ user, setRole }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
