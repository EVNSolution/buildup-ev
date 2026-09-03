import { useEffect, useRef } from 'react'
import type { StepComment } from '../api/stepComments'

/**
 * 대화창을 열어 둔 동안 **새 글이 저절로 뜨게** 한다.
 *
 * 예전엔 열 때 한 번만 받아 와서, 상대가 글을 남겨도 알림만 오고 화면은 그대로였다.
 * 새로고침을 눌러야 보였다(실제 제보). 대화는 지금 주고받는 것이라 그러면 안 된다.
 *
 * ## 왜 폴링인가
 * 웹소켓·SSE 는 연결을 오래 붙들어야 하는데, 이 앱의 백엔드는 blue/green 으로 슬롯을
 * 갈아끼우며 배포한다 — 배포 때마다 끊긴 연결을 되살리는 문제가 새로 생긴다.
 * 대화는 몇 초 늦어도 되는 일이라, **열려 있는 동안만** 가볍게 물어보는 쪽을 쓴다.
 *
 * ## 아낄 곳은 아낀다
 * - 화면이 가려져 있으면(`document.hidden`) **쉰다** — 배터리·서버를 낭비하지 않는다.
 * - 돌아오면 기다리지 않고 **즉시 한 번** 받는다(주머니에서 꺼내자마자 최신이 보인다).
 */
export const CHAT_POLL_MS = 5_000

export function useChatPoll(refresh: () => void, deps: readonly unknown[]): void {
  // 매 렌더 새로 만들어지는 함수라 의존성에 넣지 않는다 — 넣으면 5초마다 타이머가 새로 선다
  const latest = useRef(refresh)
  latest.current = refresh

  useEffect(() => {
    const tick = () => { if (!document.hidden) latest.current() }
    const timer = window.setInterval(tick, CHAT_POLL_MS)
    // 앱으로 돌아오거나 창을 다시 잡으면 즉시 한 번
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * 받아 온 목록이 지금 것과 같은가.
 *
 * 같으면 `setRows` 를 하지 않는다 — 5초마다 새 배열을 넣으면 목록이 통째로 다시 그려져,
 * 사진이 깜빡이고 스크롤이 튄다. 글은 지우지 않으므로 **개수와 마지막 id** 면 충분하다.
 */
export function sameComments(a: StepComment[] | null, b: StepComment[]): boolean {
  if (a == null || a.length !== b.length) return false
  return a.length === 0 || a[a.length - 1]?.id === b[b.length - 1]?.id
}
