import { useState, useEffect } from 'react'

/**
 * 컨피규레이터를 **좌우 2단으로 펼칠 수 없는 창**인가.
 *
 * 지금까지는 "태블릿을 가로로 전체화면" 만 가정했는데, 실제로는 브라우저를 창 모드로
 * 띄우거나(갤럭시탭 팝업 창) 화면을 반으로 나눠 쓴다. 그때 3D 가 폭의 2/3 을 계속
 * 차지해 옵션 패널이 눌리고, 세로가 짧으면 옵션 목록만 줄어들어 label 만 남는다.
 *
 * 폭이 좁거나(2단이 안 되는 폭) 높이가 짧으면(3D+옵션+가격바가 세로로 안 들어감)
 * **위아래 한 줄 배치**로 바꾼다. 기기 종류가 아니라 **지금 창 크기**로 판단한다 —
 * 같은 태블릿도 전체화면일 때와 창 모드일 때가 다르기 때문이다.
 */
export function useIsCompact(): boolean {
  /*
   * ⚠️ 기준은 **폭**이 먼저다. 높이로 먼저 걸렀더니 태블릿 가로 전체화면(1024×~560,
   *    주소창을 빼면 600 아래)까지 좁은 창으로 잡혀 **멀쩡한 화면이 통째로 바뀌었다**.
   *    높이 조건은 정말 납작한 창(≤480)만 잡도록 낮춰 둔다.
   */
  const query = '(max-width: 820px), (max-height: 480px)'
  const [compact, setCompact] = useState(
    () => (typeof window !== 'undefined' ? window.matchMedia(query).matches : false),
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    setCompact(mq.matches)
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return compact
}
