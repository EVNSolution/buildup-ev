import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

interface Props {
  children: React.ReactNode
  skipChangePasswordCheck?: boolean
}

export function RequireAuth({ children, skipChangePasswordCheck = false }: Props) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  if (!skipChangePasswordCheck && session.user.must_change_pw) return <Navigate to="/change-password" replace />
  return <>{children}</>
}
