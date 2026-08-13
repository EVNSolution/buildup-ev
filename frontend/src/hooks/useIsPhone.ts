import { useState, useEffect } from 'react'

/**
 * 휴대폰 크기인가 — **3D 를 접고 옵션·금액만 남기는** 기준.
 *
 * 560px 아래에서는 3D 를 16:9 로 넣는 순간 높이의 1/3 을 가져가는데, 그 크기의 차량 그림은
 * 보여 주는 것이 사실상 없다(폭 340px → 높이 190px). 같은 자리를 옵션에 주는 편이 낫다.
 *
 * 태블릿 창 모드(≤900px)와는 다른 기준이다. 그쪽은 2단을 접어 위아래로 쌓을 뿐 3D 는 남긴다
 * — 화면이 그만큼은 되기 때문이다([[useIsCompact]]).
 */
export function useIsPhone(): boolean {
  const query = '(max-width: 560px)'
  const [phone, setPhone] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    setPhone(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPhone(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return phone
}
