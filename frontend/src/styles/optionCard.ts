/**
 * 옵션 선택 카드의 상태 한 곳 — 트림 카드 · 옵션 버튼 · 세그먼트 · O/X 토글이 모두 이걸 쓴다.
 *
 * 네 곳이 각자 "선택됨"을 그리다 보니 테두리 굵기도 강조색도 조금씩 달랐다.
 * 고객 앞에서 보는 화면이라 **무엇이 선택됐는지가 한눈에** 들어와야 하고,
 * 그 표시가 화면마다 달라 보이면 안 된다.
 *
 * 규칙(docs/design-system.md §9)
 *   기본   흰 배경 + 0.5px 헤어라인 + 아주 얕은 그림자
 *   선택   --lime 2px 테두리 + --lime-bg 옅은 배경
 *   비활성 --card 배경 + --muted 글씨
 *   누름   scale(.97) — globals.css 가 모든 button 에 걸어 둔다(카드가 div 면 .pressable)
 *
 * ⚠️ 테두리가 0.5 → 2px 로 굵어지면 안쪽 내용이 1.5px 밀린다. 그만큼 패딩을 깎아
 *    **선택해도 글자가 움직이지 않게** 한다(고르는 동안 카드가 들썩이면 어수선하다).
 */

/** 패딩을 직접 정하는 카드용 — pad 는 토큰 문자열(예: 'var(--sp-3)') */
export function cardStates(pad: string) {
  const BORDER = 0.5, ON = 2, diff = `${ON - BORDER}px`
  return {
    base: {
      background: '#fff',
      border: `${BORDER}px solid var(--line)`,
      borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-1)',
      padding: pad,
      cursor: 'pointer',
    } as React.CSSProperties,
    on: {
      background: 'var(--lime-bg)',
      border: `${ON}px solid var(--lime)`,
      borderRadius: 'var(--r-md)',
      boxShadow: 'none',
      // 굵어진 테두리만큼 패딩을 깎는다(내용 위치 고정)
      padding: `calc(${pad} - ${diff})`,
      cursor: 'pointer',
      color: 'var(--dark)',
      fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    } as React.CSSProperties,
    disabled: {
      background: 'var(--card)',
      color: 'var(--muted)',
      boxShadow: 'none',
      cursor: 'not-allowed',
    } as React.CSSProperties,
  }
}

/** 대부분의 옵션 버튼이 쓰는 기본 패딩(--sp-3) */
export const OPTION_CARD = cardStates('var(--sp-3)')
