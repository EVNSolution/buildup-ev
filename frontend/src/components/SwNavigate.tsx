import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * **알림을 눌렀을 때 화면이 스스로 옮긴다.**
 *
 * 서비스워커가 `{ type: 'navigate', url }` 을 보낸다(설치한 앱에서 워커가 창을 직접 옮기는 것은 자주 실패한다).
 * 라우터로 옮기므로 앱을 다시 켜지 않고, 보던 상태도 남는다. 앱 안 주소(`/`로 시작)만 따라간다.
 */
export function SwNavigate() {
  const navigate = useNavigate()
  useEffect(() => {
    const sw = navigator.serviceWorker
    if (!sw) return
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; url?: string } | null
      if (d?.type !== 'navigate' || typeof d.url !== 'string' || !d.url.startsWith('/')) return
      navigate(d.url)
    }
    sw.addEventListener('message', onMsg)
    return () => sw.removeEventListener('message', onMsg)
  }, [navigate])
  return null
}
