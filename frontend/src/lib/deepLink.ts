import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

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
 * 조건을 처리하고 **주소에서 지운다.**
 *
 * ⚠️ 지우지 않으면 주문을 닫고 목록으로 돌아가도 새로고침할 때마다 다시 열린다.
 *    `replace` 라 뒤로가기 이력에도 남지 않는다.
 *
 * ⚠️ **주소가 바뀔 때마다 본다**(2026-09-16 제보 — 휴대폰에서 알림을 눌러도 아무 일도 없었다).
 *    예전에는 화면이 처음 뜰 때 한 번만 읽었다. 이미 그 화면에 있는 사람이 알림을 누르면
 *    주소만 바뀌고 화면은 그대로였다 — PC 는 대개 다른 화면에 있다가 들어와 마운트되므로 열렸다.
 */
export function useOrderDeepLink(onOpen: (link: OrderDeepLink) => void): void {
  const { search, pathname, hash } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    const link = readOrderDeepLink(search)
    if (!link) return
    onOpen(link)
    navigate(pathname + hash, { replace: true })
    // onOpen 은 매 렌더 새 함수라 넣지 않는다 — 주소가 바뀔 때만 돈다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
}

/**
 * 알림이 가리키는 **화면 안의 자리** — `?view=assign` 처럼 주문 번호가 아닌 조건.
 * 같은 이유로 주소가 바뀔 때마다 보고, 처리하면 주소에서 지운다.
 */
export function useViewDeepLink(key: string, value: string, onHit: () => void): void {
  const { search, pathname, hash } = useLocation()
  const navigate = useNavigate()
  useEffect(() => {
    if (new URLSearchParams(search).get(key) !== value) return
    onHit()
    navigate(pathname + hash, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])
}
