/**
 * 버튼 한 곳 — 영업/관리자/특장사 화면이 **같은 버튼**을 쓰게 한다.
 *
 * 예전에는 화면마다 padding·fontSize·minWidth 를 따로 적어서, 같은 목록의 버튼인데도
 * 폭이 제각각이고 줄이 들쭉날쭉했다. 여기서만 고치면 세 화면이 함께 바뀐다.
 *
 * 종류는 **넷뿐이다**(docs/design-system.md §7):
 *   primary    다음 단계로 넘기는 동작 — 화면당 하나가 원칙
 *   secondary  조회·열기·취소 등 대부분
 *   danger     되돌릴 수 없는 동작(삭제·되돌리기)
 *   disabled   조건 미충족
 * 크기는 둘: 기본(--h-control) / 표 안 작은 버튼(--h-control-sm).
 * 손가락 기기에서는 두 값 모두 44px 로 커진다 — 높이가 CSS 변수라 여기선 신경 쓰지 않아도 된다.
 *
 * 눌림·hover 반응은 globals.css 가 모든 button 에 걸어 둔다(인라인 style 은 :active 를 못 쓴다).
 * 색·크기 숫자를 여기 직접 쓰지 않는다 — 토큰만 참조한다.
 */

/** 크기만 정하는 뼈대 — 색은 아래 종류별로 얹는다 */
const base = {
  display: 'inline-flex' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  borderRadius: 'var(--r-sm)',
  cursor: 'pointer',
  whiteSpace: 'nowrap' as const,
  lineHeight: 1.2,
}

/** 기본 크기 — 툴바·모달·폼 */
const MD = {
  ...base,
  minHeight: 'var(--h-control)',
  padding: '0 var(--sp-4)',
  fontSize: 'var(--fs-body)',
  fontWeight: 'var(--fw-label)' as unknown as number,
}

/**
 * 작은 크기 — 표·카드 안. 손가락 기기에서는 높이만 44px 로 커진다.
 *
 * ⚠️ 폭은 **고정**이다(하한선이 아니라). 예전엔 minWidth 74 만 두어 글자 수가 많은 버튼은
 *    제 폭대로 늘어났다. 크롬에서는 대부분 74 안에 들어와 나란해 보였지만, 한글을 조금
 *    넓게 그리는 사파리에서는 「고객정보」·「견적 생성」이 삐져나와 한 줄의 버튼들이
 *    제각각 크기가 됐다(맥 사파리 제보 사진).
 *    92 = 가장 긴 라벨(「계약서 생성」 79px, 좌우 여백 포함)에 엔진 차이 여유를 더한 값.
 */
const SM_W = 92

const SM = {
  ...base,
  minHeight: 'var(--h-control-sm)',
  padding: '0 var(--sp-3)',
  fontSize: 'var(--fs-caption)',
  fontWeight: 'var(--fw-label)' as unknown as number,
  width: SM_W,
  minWidth: SM_W,
  // 폭을 못 박았으니 혹시 더 긴 라벨이 생겨도 줄을 밀지 않고 말줄임으로 끝낸다
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  flexShrink: 0,
}

// ── 종류 4가지 (색) ──
const PRIMARY   = { background: 'var(--dark)', color: '#fff', border: '0.5px solid var(--dark)' }
const SECONDARY = { background: '#fff', color: 'var(--dark)', border: 'var(--hairline)', boxShadow: 'var(--shadow-1)' }
const DANGER    = { background: '#fff', color: 'var(--warn)', border: '0.5px solid var(--warn)' }
const DISABLED  = { background: 'var(--card)', color: 'var(--muted)', border: 'var(--hairline)', cursor: 'not-allowed' }

export const BTN: Record<string, React.CSSProperties> = {
  // ── 지금 쓰는 이름 ──
  primary:   { ...MD, ...PRIMARY },
  secondary: { ...MD, ...SECONDARY },
  danger:    { ...MD, ...DANGER },
  disabled:  { ...MD, ...DISABLED },
  /** 표·카드 안 작은 버튼 */
  smPrimary:   { ...SM, ...PRIMARY },
  smSecondary: { ...SM, ...SECONDARY },
  smDanger:    { ...SM, ...DANGER },
  smDisabled:  { ...SM, ...DISABLED },

  /*
   * ── 예전 이름(화면들이 아직 이 이름으로 부른다) ──
   * 화면 로직을 건드리지 않고 모양만 바꾸기 위해 남겨 둔다. 화면을 순차 개편하면서
   * 위의 네 이름으로 옮기고, 다 옮기면 아래는 지운다.
   *   rowSend(파란 발송 버튼)·rowDangerOutline(2px 빨강)처럼 체계 밖이던 색은
   *   여기서 4종 안으로 흡수된다 — 그래서 화면을 안 고쳐도 톤이 정리된다.
   */
  row:              { ...SM, ...SECONDARY },
  rowPrimary:       { ...SM, ...PRIMARY },
  rowSend:          { ...SM, ...SECONDARY },
  rowDanger:        { ...SM, ...DANGER },
  rowDangerOutline: { ...SM, ...DANGER },
  rowDisabled:      { ...SM, ...DISABLED },
  /** 눌러도 되지만 지금은 의미 없는 상태 */
  rowMuted:         { ...SM, ...DISABLED, opacity: .6 },

  bar:         { ...MD, ...SECONDARY },
  barPrimary:  { ...MD, ...PRIMARY },
  barDanger:   { ...MD, ...DANGER },
  barDisabled: { ...MD, ...DISABLED },
}
