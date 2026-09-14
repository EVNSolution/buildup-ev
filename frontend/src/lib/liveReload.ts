import { useEffect, useRef } from 'react'

/**
 * **켜 둔 화면을 저절로 새로 읽는다** — 다른 사람이 단계를 끝내도 숫자가 따라오게.
 *
 * 주문 진행 탭(현황판)과 특장사 목록은 처음 열 때 한 번만 읽었다. 특장사가 단계를 끝내도,
 * 주문 상세를 열었다 뒤로 와도 숫자가 그대로였다(2026-09-14 로컬 제보·재현: 착수 8 → 끝낸 뒤에도 8).
 *
 *   · 화면이 보이는 동안에만 `intervalMs` 마다 부른다(다른 탭·잠금화면에서는 쉰다)
 *   · `active` 가 거짓이면 멈춘다 — 주문 상세를 보는 동안 뒤의 목록을 계속 읽을 이유가 없다
 *
 * 부르는 쪽은 **조용히** 읽어야 한다(로딩 표시로 화면을 비우지 않기) — `reload` 에 그런 함수를 넘긴다.
 */
export function useLiveReload(reload: () => void, active: boolean, intervalMs = 30_000): void {
  const ref = useRef(reload)
  ref.current = reload
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') ref.current()
    }, intervalMs)
    return () => clearInterval(timer)
  }, [active, intervalMs])
}
