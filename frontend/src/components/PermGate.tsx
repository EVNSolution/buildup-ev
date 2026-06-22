import { useAuth } from '../contexts/AuthContext'

interface PermGateProps {
  code: string
  fallback?: React.ReactNode
  children: React.ReactNode
}

/** 권한 게이트 컴포넌트 — code 없으면 fallback(기본 null) 렌더 */
export function PermGate({ code, fallback = null, children }: PermGateProps) {
  const { hasPermission } = useAuth()
  return hasPermission(code) ? <>{children}</> : <>{fallback}</>
}

/** 권한 확인 훅 */
export function usePermission(code: string): boolean {
  const { hasPermission } = useAuth()
  return hasPermission(code)
}
