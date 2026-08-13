import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { canUseSurface, homeFor } from '../lib/surfaces'

interface Props {
  children: React.ReactNode
  skipChangePasswordCheck?: boolean
}

export function RequireAuth({ children, skipChangePasswordCheck = false }: Props) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!skipChangePasswordCheck && session.user.must_change_pw) return <Navigate to="/change-password" replace />
  /*
   * 가지지 않은 역할의 화면은 자기 화면으로 되돌린다(주소를 직접 친 경우).
   * 서버가 이미 막고 있지만, 그러면 빈 화면에 오류만 뜬다 — 갈 수 있는 곳으로 보낸다.
   */
  if (!canUseSurface(session.user, location.pathname)) {
    return <Navigate to={homeFor(session.user.role)} replace />
  }
  return <>{children}</>
}
