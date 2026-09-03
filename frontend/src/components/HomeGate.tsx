import { Navigate, useLocation } from 'react-router-dom'
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
  const { search } = useLocation()
  // 세션 확인 중에 공개 화면을 먼저 그리면 로그인 사용자 화면이 한 번 깜빡인다
  if (loading) return null
  /*
   * ⚠️ **물음표 뒤를 그대로 들고 간다.** 예전엔 `to={homeFor(role)}` 만 넘겨서
   *    푸시 알림의 `/?order=19&tab=chat` 이 여기서 통째로 잘렸다 — 알림을 눌러도
   *    그냥 첫 화면이 열려 「이상한 데로 간다」는 제보가 나왔다.
   *    서버는 받는 사람이 관리자인지 특장사인지 모르므로 `/` 로 보내고,
   *    어느 화면으로 갈지는 여기서 정한다. 조건은 그 뒤 화면이 읽는다.
   */
  if (session) return <Navigate to={`${homeFor(session.user.role)}${search}`} replace />
  return <PublicConfiguratorPage />
}
