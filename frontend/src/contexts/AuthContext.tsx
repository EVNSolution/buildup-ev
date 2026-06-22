import { createContext, useContext, useState, useEffect } from 'react'
import type { User, Org } from '@shared/types/index'
import { apiLogin, apiLogout, fetchAuthMe } from '../api/auth'

export interface Session {
  user: User
  org: Org
  permissions: string[]
}

interface AuthContextValue {
  session: Session | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => Promise<void>
  hasPermission: (code: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAuthMe()
      .then(data => setSession({ user: data.user, org: data.org, permissions: data.permissions }))
      .catch(() => setSession(null))
      .finally(() => setLoading(false))
  }, [])

  async function login(email: string, password: string) {
    await apiLogin(email, password)
    const data = await fetchAuthMe()
    setSession({ user: data.user, org: data.org, permissions: data.permissions })
  }

  async function logout() {
    await apiLogout().catch(() => {})
    setSession(null)
  }

  async function refreshSession() {
    const data = await fetchAuthMe()
    setSession({ user: data.user, org: data.org, permissions: data.permissions })
  }

  function hasPermission(code: string) {
    return session?.permissions.includes(code) ?? false
  }

  return (
    <AuthContext.Provider value={{ session, loading, login, logout, refreshSession, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
