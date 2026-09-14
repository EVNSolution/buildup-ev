/**
 * **뒤로가기** — 앱 전체 한 벌(2026-09-14 지시: 「뒤로가기가 너무 많은 공간을 차지함, 전반적으로 낮게」).
 *
 * 예전에는 테두리 있는 버튼 상자(높이 44px)가 제목 위에 따로 한 줄을 차지했다. 이제는
 * **글자 한 줄 높이의 링크 모양**(‹ 주문 진행)으로 둔다.
 *
 * ⚠️ 보이는 높이는 낮추되 **손가락으로 누르는 자리는 줄이지 않는다** — 안쪽 여백으로 누르는 자리를
 *    44px 가까이 넓히고, 같은 크기의 음수 바깥 여백으로 그만큼 되돌려 줄 높이는 글자 한 줄로 남긴다.
 *    연세 있는 분도 누르기 어려워지면 안 된다.
 * ⚠️ 이름표에 「←」를 넣지 않는다 — 화살표는 이 부품이 그린다(모든 뒤로가기가 같은 모양이어야 한다).
 */
export function BackLink({ label, onClick, style }: { label: string; onClick: () => void; style?: React.CSSProperties }) {
  return (
    <button type="button" onClick={onClick} style={{ ...s.btn, ...style }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"
        stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 5l-7 7 7 7" />
      </svg>
      <span>{label}</span>
    </button>
  )
}

const s: Record<string, React.CSSProperties> = {
  btn: {
    alignSelf: 'flex-start',
    display: 'inline-flex', alignItems: 'center', gap: 2,
    fontFamily: 'inherit', fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 1.2,
    background: 'transparent', border: 'none', cursor: 'pointer',
    // 누르는 자리 = 위아래 12px·좌우 8px 더 넓게, 줄 높이는 그대로(음수 바깥 여백)
    paddingTop: 12, paddingBottom: 12, paddingLeft: 8, paddingRight: 8,
    marginTop: -12, marginBottom: -12, marginLeft: -8, marginRight: 0,
  },
}
