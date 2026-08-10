import { useState, useEffect } from 'react'

/**
 * 화면이 **세로로 긴가**(가로:세로 ≤ 1:1) — 창을 좁히거나 세로 모니터를 쓸 때 참.
 *
 * 가격 계산 블록처럼 옆으로 늘어놓는 배치는 폭이 좁아지면 아무리 글자를 줄여도
 * 답이 없다. 이 시점부터는 가로로 욱여넣지 말고 세로로 쌓는 편이 낫다.
 */
export function useIsPortrait() {
  const query = '(max-aspect-ratio: 1/1)'
  const [portrait, setPortrait] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    setPortrait(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPortrait(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return portrait
}
