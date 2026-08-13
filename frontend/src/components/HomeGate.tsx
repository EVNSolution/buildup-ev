import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { PublicConfiguratorPage } from '../pages/PublicConfiguratorPage'
import { homeFor } from '../lib/surfaces'

/**
 * 기본 화면(`/`) 갈림길.
 *
 * 로그인하지 않았으면 **공개 컨피규레이터**, 로그인했으면 자기 화면으로 보낸다.
 * 로그인한 영업이 굳이 공개 화면을 볼 이유가 없다 — 그쪽에는 견적 저장·목록이 없다.
 */
export function HomeGate() {
  const { session, loading } = useAuth()
  // 세션 확인 중에 공개 화면을 먼저 그리면 로그인 사용자 화면이 한 번 깜빡인다
  if (loading) return null
  if (session) return <Navigate to={homeFor(session.user.role)} replace />
  return <PublicConfiguratorPage />
}
