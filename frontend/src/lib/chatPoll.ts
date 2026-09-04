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
 * - **대화창을 보고 있을 때만** 돈다. 다른 탭·다른 화면으로 가면 컴포넌트가 사라지며 멈춘다.
 * - 화면이 가려져 있으면(`document.hidden`) **쉰다** — 배터리·서버를 낭비하지 않는다.
 * - 돌아오면 기다리지 않고 **즉시 한 번** 받는다.
 * - **이야기가 오갈 때만 자주** 묻는다(아래 `pollDelay`).
 * - 받아 오는 것도 **새로 생긴 것만**이다(`?after=<마지막 id>`).
 */

/** 이야기가 오가는 중 — 답을 기다리는 사람이 있다 */
export const CHAT_POLL_ACTIVE_MS = 2_000
/** 조용할 때 — 열어만 두고 다른 일을 하는 중이다 */
export const CHAT_POLL_IDLE_MS = 15_000
/** 마지막 글로부터 이 시간 안이면 「오가는 중」으로 본다 */
export const CHAT_ACTIVE_WINDOW_MS = 60_000

/**
 * 지금 얼마나 자주 물어볼지.
 *
 * 5초 고정이었을 때는 **조용할 때도 5초마다** 물었고, 정작 이야기가 오갈 때는 5초가 느렸다.
 * 마지막 글이 방금이면 2초로 당기고, 1분 넘게 조용하면 15초로 늦춘다 —
 * 체감은 빨라지면서 오가는 양은 오히려 준다.
 */
export function pollDelay(lastMessageAt: number | null, now = Date.now()): number {
  if (lastMessageAt == null) return CHAT_POLL_IDLE_MS
  return now - lastMessageAt < CHAT_ACTIVE_WINDOW_MS ? CHAT_POLL_ACTIVE_MS : CHAT_POLL_IDLE_MS
}

/** 목록의 마지막 글 시각(ms). 비었으면 `null` */
export function lastMessageAt(rows: StepComment[] | null): number | null {
  const last = rows?.[rows.length - 1]
  if (!last) return null
  const t = Date.parse(last.created_at)
  return Number.isFinite(t) ? t : null
}

/**
 * `delayMs` 는 **매번 다시 물어본다** — 고정 간격이 아니라 그때그때 정한다.
 * `setInterval` 이 아니라 스스로 다음 차례를 잡는 `setTimeout` 을 쓰는 이유다.
 */
export function useChatPoll(
  refresh: () => void,
  delayMs: () => number,
  deps: readonly unknown[],
): void {
  // 매 렌더 새로 만들어지는 함수라 의존성에 넣지 않는다 — 넣으면 타이머가 계속 새로 선다
  const latest = useRef(refresh)
  const delay = useRef(delayMs)
  latest.current = refresh
  delay.current = delayMs

  useEffect(() => {
    let timer: number | undefined
    let alive = true

    const schedule = () => {
      if (!alive) return
      timer = window.setTimeout(() => {
        if (!document.hidden) latest.current()
        schedule()
      }, delay.current())
    }
    schedule()

    // 앱으로 돌아오거나 창을 다시 잡으면 즉시 한 번 — 주머니에서 꺼내자마자 최신이 보인다
    const wake = () => { if (!document.hidden) latest.current() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

/**
 * 받아 온 새 글을 지금 목록 뒤에 잇는다.
 *
 * 증분이라 새 글만 오지만, 같은 글이 두 번 오는 경우를 막는다 — 요청이 겹치거나
 * 글을 남긴 직후 폴링이 돌면 방금 것이 또 올 수 있다. `id` 가 유일하므로 그것으로 거른다.
 */
export function appendComments(prev: StepComment[] | null, incoming: StepComment[]): StepComment[] | null {
  if (incoming.length === 0) return prev          // 새 글이 없으면 목록을 손대지 않는다
  const base = prev ?? []
  const known = new Set(base.map(c => c.id))
  const added = incoming.filter(c => !known.has(c.id))
  if (added.length === 0) return prev
  // 서버가 id 순으로 주지만, 이어 붙인 뒤 한 번 더 맞춰 둔다(순서가 곧 이야기 순서다)
  return [...base, ...added].sort((a, b) => a.id - b.id)
}

/** 마지막으로 받은 id — 다음에 「이 뒤부터」라고 말할 기준 */
export function lastId(rows: StepComment[] | null): number | undefined {
  return rows?.[rows.length - 1]?.id
}
