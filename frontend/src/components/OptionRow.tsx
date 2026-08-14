import { OPTION_CARD } from '../styles/optionCard'
import type { ReactNode } from 'react'

/** 부가세 별도 단가 → 부가세 포함(×1.1) 표기 */
export function fmtWonVat(unitPrice: number): string {
  return '₩' + Math.round(unitPrice * 1.1).toLocaleString('ko-KR')
}

/**
 * 옵션 한 줄: 작은 라벨 + 「· 필수」 + 버튼들.
 *
 * 표시는 **필수(빨강) 아니면 없음** 두 갈래뿐 — 앱 전체가 같은 규칙이다.
 * 예전엔 「선택」 회색 뱃지도 달렸는데, 옵션 대부분이 선택이라 회색 뱃지가 줄줄이
 * 늘어서 정작 반드시 골라야 하는 줄이 묻혔다. 뱃지(칠한 칸) 대신 글자만 쓰는 것도
 * 같은 이유 — 입력 라벨의 「· 필수」와 생김새를 맞춘다.
 */
export function OptRow({ label, required, children }: { label: string; required: boolean; children: ReactNode }) {
  return (
    <div style={styles.row}>
      <div style={styles.head}>
        <span style={styles.label}>{label}</span>
        {required && <span style={styles.req}>· 필수</span>}
      </div>
      <div style={styles.btns}>{children}</div>
    </div>
  )
}

/** 옵션 버튼 — 항상 부가세 포함가 표시(price 미지정 시 가격줄 없음) */
export function PriceBtn({ label, price, selected, disabled = false, onClick }: {
  label: string
  price?: number
  selected: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      style={{ ...(selected ? styles.btnOn : styles.btn), ...(disabled ? styles.btnDisabled : null) }}
      onClick={() => !disabled && onClick()}
      disabled={disabled}
    >
      <span style={styles.btnName}>{label}</span>
      {price !== undefined && <span style={styles.btnPrice}>{fmtWonVat(price)}</span>}
    </button>
  )
}

const btnBase = {
  flex: 1,
  minWidth: 72,
  // 가로로만 길쭉해 보이던 버튼 — 세로를 키워 비율을 잡는다
  minHeight: 62,
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  // 가격줄이 없는 버튼(냉동·내장)은 이름만 있어 위로 붙었다 — 세로 가운데로 모은다
  justifyContent: 'center' as const,
  gap: 'var(--sp-1)',
}

const styles = {
  // 글자 크기 두 단계 — 본문 14 / 작은 글씨 13.
  row: { marginBottom: 16 },
  head: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 },
  label: { fontSize: 13, color: 'var(--muted)' },
  // 라벨 옆 「· 필수」 — 모달 입력칸과 같은 색·굵기(--req)
  req: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--req)' },
  btns: { display: 'flex', gap: 7, flexWrap: 'wrap' as const },
  btn: { ...btnBase, ...OPTION_CARD.base, color: 'var(--body)' },
  btnOn: { ...btnBase, ...OPTION_CARD.on },
  btnDisabled: OPTION_CARD.disabled,
  btnName: { fontSize: 14 },
  btnPrice: { fontSize: 13, color: 'var(--muted)', fontWeight: 600 },
}
