import { useEffect } from 'react'

/**
 * **알림을 눌러 들어온 주소를 읽는다.**
 *
 * 푸시 알림은 `/?order=19&tab=chat&step=…` 으로 온다. 서버는 받는 사람이 관리자인지
 * 특장사인지 모르므로 `/` 로 보내고, `HomeGate` 가 물음표 뒤를 그대로 들고
 * 각자 화면으로 넘긴다. 그 화면이 이 함수로 조건을 읽어 해당 주문을 연다.
 */
export interface OrderDeepLink {
  orderId: number
  /** 「대화」 탭으로 열지 여부 */
  chat: boolean
  /** 대화 탭에서 미리 골라 둘 단계 코드 */
  step?: string
}

export function readOrderDeepLink(search: string): OrderDeepLink | null {
  const q = new URLSearchParams(search)
  const raw = q.get('order')
  if (!raw) return null
  const orderId = Number(raw)
  // 주소는 사용자가 손으로 고칠 수도 있다 — 숫자가 아니면 그냥 무시한다
  if (!Number.isInteger(orderId) || orderId <= 0) return null
  return { orderId, chat: q.get('tab') === 'chat', step: q.get('step') ?? undefined }
}

/**
 * 조건을 한 번 처리하고 **주소에서 지운다.**
 *
 * ⚠️ 지우지 않으면 주문을 닫고 목록으로 돌아가도 새로고침할 때마다 다시 열린다.
 *    `replaceState` 라 뒤로가기 이력에도 남지 않는다.
 */
export function useOrderDeepLink(onOpen: (link: OrderDeepLink) => void): void {
  useEffect(() => {
    const link = readOrderDeepLink(window.location.search)
    if (!link) return
    onOpen(link)
    const url = window.location.pathname + window.location.hash
    window.history.replaceState(null, '', url)
    // 주소는 처음 들어올 때 한 번만 읽는다 — onOpen 이 매 렌더 새 함수여도 다시 돌지 않게
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
