import type { KeyboardEvent } from 'react'

/**
 * **`<div>` 를 눌러야 하는 자리**에 키보드 길을 열어 준다.
 *
 * 버튼으로 바꾸는 것이 제일 좋지만, 격자 칸처럼 자리와 크기가 정교하게 잡힌 자리는
 * `<button>` 의 기본 상자 모양이 배치를 흔든다. 그때는 표준이 정한 대로
 * **역할·초점·건반**을 직접 붙인다 — 보이는 것은 그대로, 쓸 수 있는 길만 하나 더 난다.
 *
 * ⚠️ 셋 중 하나라도 빠지면 소용없다.
 *   · `role="button"` — 화면 낭독기에 「버튼」이라고 알린다
 *   · `tabIndex={0}` — Tab 으로 닿는다(이게 없으면 아예 못 간다)
 *   · Enter·Space — 버튼은 둘 다로 눌린다. 마우스만 되는 자리는 없느니만 못하다
 *
 * ⚠️ Space 는 **기본 동작이 스크롤**이라 막아야 한다. 안 막으면 누를 때마다 화면이 내려간다.
 */
export function pressable(onPress: (() => void) | undefined) {
  if (!onPress) return {}
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onPress,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      onPress()
    },
  }
}
