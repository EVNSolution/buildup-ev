import { useState, useEffect } from 'react'

/**
 * 손가락으로 쓰는 기기인가(태블릿·휴대폰).
 *
 * 마우스 커서가 없으므로 **hover 로만 뜨는 것은 아예 볼 수 없고**, 세로 공간도 귀하다.
 * 그래서 이 값으로 (1) hover 대신 탭으로 열리게 바꾸고 (2) 두툼한 여백을 줄인다.
 *
 * `pointer: coarse` = 정밀한 포인팅 장치가 없다는 뜻. 화면 크기와 무관하므로
 * 큰 태블릿도 제대로 잡힌다(폭으로 판단하면 12인치 태블릿을 데스크톱으로 오인한다).
 */
export function useIsTouch(): boolean {
  const query = '(pointer: coarse)'
  const [touch, setTouch] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    setTouch(mq.matches)
    const handler = (e: MediaQueryListEvent) => setTouch(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return touch
}
