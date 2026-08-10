/**
 * 버튼 크기·모양 한 곳 — 영업/관리자/특장사 화면이 **같은 버튼**을 쓰게 한다.
 *
 * 예전에는 화면마다 padding·fontSize·minWidth 를 따로 적어서, 같은 목록의 버튼인데도
 * 폭이 제각각이고 줄이 들쭉날쭉했다. 여기서만 고치면 세 화면이 함께 바뀐다.
 *
 * 두 가지 크기만 쓴다:
 *   row  — 표·카드 안의 액션 버튼 (견적서 / 계약서 / 확정 / 배정 / 삭제)
 *   bar  — 상단 툴바·필터 버튼 (조회 / 검색 / 저장)
 * 팝업 안의 확인·취소는 팝업 자체 스타일(더 큼)을 그대로 둔다.
 */

const ROW = {
  padding: '4px 10px',
  minWidth: 74,
  textAlign: 'center' as const,
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 11,
  lineHeight: 1.5,
  whiteSpace: 'nowrap' as const,
}

const BAR = {
  padding: '7px 16px',
  borderRadius: 8,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 13,
  lineHeight: 1.4,
  whiteSpace: 'nowrap' as const,
}

export const BTN: Record<string, React.CSSProperties> = {
  // ── 표·카드 안 ──
  /** 기본(중립) — 문서 열기·조회 */
  row:        { ...ROW, border: '1px solid var(--line)', background: '#f7f8f3', color: 'var(--dark)' },
  /** 강조 — 다음 단계로 넘기는 동작(확정·배정) */
  rowPrimary: { ...ROW, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff' },
  /** 보조 강조 — 발송 등 외부로 나가는 동작 */
  rowSend:    { ...ROW, border: '1px solid #b8c9e0', background: '#eaf2ff', color: '#1565c0' },
  rowDanger:  { ...ROW, border: '1px solid #b71c1c', background: '#b71c1c', color: '#fff' },
  /** 되돌릴 수 없는 삭제 — 테두리를 굵게 해 한 번 더 눈에 띄게 */
  rowDangerOutline: { ...ROW, border: '2px solid #b71c1c', background: '#fff', color: '#b71c1c' },
  rowDisabled: { ...ROW, border: '1px solid var(--line)', background: '#e9ecef', color: '#9e9e9e', cursor: 'not-allowed' },
  /** 눌러도 되지만 지금은 의미 없는 상태(비활성 대신 흐리게) */
  rowMuted:   { ...ROW, border: '1px solid var(--line)', background: '#f7f8f3', color: 'var(--dark)', opacity: 0.45, cursor: 'not-allowed' },

  // ── 상단 툴바 ──
  bar:         { ...BAR, border: '1px solid var(--line)', background: '#fff', color: 'var(--dark)', fontWeight: 600 },
  barPrimary:  { ...BAR, border: '1px solid var(--dark)', background: 'var(--dark)', color: '#fff' },
  barDanger:   { ...BAR, border: '1px solid #b71c1c', background: '#fff', color: '#b71c1c' },
  barDisabled: { ...BAR, border: '1px solid var(--line)', background: '#f0f2f4', color: '#b0b7c0', cursor: 'not-allowed', fontWeight: 600 },
}
