import { useEffect, useRef } from 'react'

/**
 * **뒤로가기로 한 겹씩 닫는다.**
 *
 * 사진을 크게 보다가, 대화 서랍을 열어 두다가 휴대폰의 뒤로가기를 누르면 앱을 통째로
 * 벗어났다 — 보던 주문도, 치던 검색어도 사라진다(제보).
 * 겹이 열릴 때 이력에 한 칸을 넣어 두면, 뒤로가기가 **그 겹만** 닫고 바로 아래 화면으로
 * 돌아온다. 아래 화면은 그대로 살아 있으니 검색어도 대화도 그 자리에 있다.
 *
 * ## 겹은 이렇게 쌓인다
 * 목록 → 주문 상세 → 단계별 대화 → 사진 크게 보기
 * 뒤로가기를 누를 때마다 한 겹씩 벗겨진다.
 *
 * ## ⚠️ 겹마다 따로 듣지 않는다
 * 처음엔 겹마다 `popstate` 를 각자 들었다. 그랬더니 뒤로가기 한 번에 **모든 겹이 함께
 * 닫혔다** — 서랍을 닫으려 했는데 주문 상세까지 같이 닫혀 목록으로 튕겼다(실측).
 * 듣는 곳은 **한 곳**이고, 거기서 **맨 위 겹 하나만** 닫는다.
 */

/** 열려 있는 겹들 — 마지막이 맨 위 */
const stack: { id: number; close: () => void }[] = []
let seq = 0
let listening = false
/**
 * 우리가 부른 `history.back()` 인가 — 그때 오는 `popstate` 는 겹을 닫지 않는다.
 *
 * ⚠️ **반드시 스스로 풀린다.** 예전엔 다음 `popstate` 에서만 풀었는데, 그 이벤트가
 *    오지 않는 경우(이미 이력 맨 앞이라 되돌릴 것이 없을 때)에 표식이 남아
 *    **다음 진짜 뒤로가기를 삼켰다** — 마지막 겹이 안 닫혔다(실측).
 */
let selfBack = false
let selfBackTimer: number | undefined
function markSelfBack(): void {
  selfBack = true
  if (selfBackTimer) window.clearTimeout(selfBackTimer)
  selfBackTimer = window.setTimeout(() => { selfBack = false }, 250)
}

function onPop(): void {
  if (selfBack) {
    selfBack = false
    if (selfBackTimer) { window.clearTimeout(selfBackTimer); selfBackTimer = undefined }
    return
  }
  const top = stack.pop()
  top?.close()
}

function listen(): void {
  if (listening) return
  window.addEventListener('popstate', onPop)
  listening = true
}

export function useBackClose(open: boolean, onClose: () => void): void {
  // 매 렌더 새로 만들어지는 함수라 의존성에 넣지 않는다 — 넣으면 이력이 계속 쌓인다
  const latest = useRef(onClose)
  latest.current = onClose

  useEffect(() => {
    if (!open) return
    listen()
    const id = ++seq
    stack.push({ id, close: () => latest.current() })
    window.history.pushState({ __layer: id }, '')

    return () => {
      const at = stack.findIndex(l => l.id === id)
      if (at === -1) return           // 뒤로가기로 이미 걷혔다 — 할 일이 없다

      stack.splice(at, 1)
      /*
       * 화면 안에서 닫은 경우(✕ 버튼)에는 우리가 넣은 이력 칸을 **걷어낸다.**
       * 안 걷어내면 뒤로가기를 한 번 더 눌러야 아래 화면으로 간다 —
       * 사용자에게는 「뒤로가기가 한 번 먹히지 않는」 것으로 보인다.
       *
       * ⚠️ 이력 꼭대기가 **우리 것일 때만** 되돌린다. 그 사이 다른 곳으로 옮겨 갔다면
       *    남의 칸을 지우게 된다. 그리고 그때 오는 `popstate` 는 우리가 부른 것이므로
       *    겹을 또 닫지 않도록 표시해 둔다.
       */
      if ((window.history.state as { __layer?: number } | null)?.__layer === id) {
        markSelfBack()
        window.history.back()
      }
    }
  }, [open])
}
