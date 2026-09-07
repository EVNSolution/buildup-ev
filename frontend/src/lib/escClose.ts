import { useEffect, useRef } from 'react'

/**
 * **Esc 로 닫는다** — 화면을 덮는 것에는 나가는 길이 둘 이상 있어야 한다.
 *
 * 덮는 창은 대부분 「바깥을 눌러 닫기」와 「닫기 버튼」을 갖고 있는데, 둘 다 **마우스를
 * 써야 하는 길**이다. 키보드만 쓰는 사람은 갇히고, 손이 불편해 키보드를 쓰는 사람도 갇힌다.
 * Esc 는 덮는 창을 닫는 관습이라 배울 것도 없다.
 *
 * ⚠️ **가장 위에 있는 것만 닫는다.** 창 위에 창이 겹쳐 있을 때 Esc 한 번에 둘 다 닫히면
 *    사용자가 하던 일까지 사라진다(예: 발주서를 보다가 사진을 열었을 때, 사진만 닫혀야 한다).
 *    그래서 층을 쌓아 두고 맨 위 하나에만 전한다.
 *
 * ⚠️ 글을 쓰는 도중에는 브라우저·조합기가 Esc 를 먼저 쓴다(한글 조합 취소 등).
 *    그때 창까지 닫으면 쓰던 글이 통째로 사라진다 — 조합 중이면 넘긴다.
 */
const stack: (() => void)[] = []

let bound = false
function ensureBinding(): void {
  if (bound) return
  bound = true
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    // 한글 조합 중의 Esc 는 조합을 취소하는 것이지 창을 닫는 것이 아니다
    if (e.isComposing) return
    const top = stack[stack.length - 1]
    if (!top) return
    e.preventDefault()
    top()
  })
}

export function useEscapeClose(onClose: () => void, active = true): void {
  /*
   * 층에 쌓는 것은 **바뀌지 않는 함수**여야 한다 — 매 렌더 새 함수를 쌓으면 층이 계속
   * 흔들려 「맨 위」가 누구인지 알 수 없다. 그래서 껍데기 하나만 쌓고, 실제로 부를 것은
   * ref 로 매 렌더 최신으로 갈아 끼운다(옛 `onClose` 를 붙들면 닫아도 옛 상태가 되살아난다).
   */
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    if (!active) return
    ensureBinding()
    const entry = () => latest.current()
    stack.push(entry)
    return () => {
      const i = stack.lastIndexOf(entry)
      if (i >= 0) stack.splice(i, 1)
    }
  }, [active])
}
