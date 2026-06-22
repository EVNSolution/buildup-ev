import { createContext, useContext, useState } from 'react'
import type { User, Org, Role } from '@shared/types/index'
import { fetchAuthMe } from '../api/auth'

export interface Session {
  user: User
  org: Org
  permissions: string[]
}

interface AuthContextValue {
  session: Session | null
  login: (email: string, role: Role) => Promise<void>
  logout: () => void
  hasPermission: (code: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)

  async function login(email: string, role: Role) {
    const data = await fetchAuthMe(role, email)
    setSession({ user: data.user, org: data.org, permissions: data.permissions })
  }

  function logout() {
    setSession(null)
  }

  function hasPermission(code: string) {
    return session?.permissions.includes(code) ?? false
  }

  return (
    <AuthContext.Provider value={{ session, login, logout, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
