import { OPTION_CARD } from '../styles/optionCard'
import type { ReactNode } from 'react'

/** 부가세 별도 단가 → 부가세 포함(×1.1) 표기 */
export function fmtWonVat(unitPrice: number): string {
  return '₩' + Math.round(unitPrice * 1.1).toLocaleString('ko-KR')
}

/** 옵션 한 줄: 작은 라벨 + 필수/선택 뱃지 + 버튼들 */
export function OptRow({ label, required, children }: { label: string; required: boolean; children: ReactNode }) {
  return (
    <div style={styles.row}>
      <div style={styles.head}>
        <span style={styles.label}>{label}</span>
        <span style={required ? styles.badgeReq : styles.badgeOpt}>{required ? '필수' : '선택'}</span>
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
  // 필수 = --req(아직 안 채운 칸) · 선택 = 가라앉은 회색. 시스템 §12 뱃지 규격을 따른다
  badgeReq: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--req)', background: 'var(--warnbg)',
    border: '0.5px solid var(--req)', borderRadius: 'var(--r-sm)', padding: '1px 6px',
  },
  badgeOpt: {
    fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--muted)', background: 'var(--card)',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', padding: '1px 6px',
  },
  btns: { display: 'flex', gap: 7, flexWrap: 'wrap' as const },
  btn: { ...btnBase, ...OPTION_CARD.base, color: 'var(--body)' },
  btnOn: { ...btnBase, ...OPTION_CARD.on },
  btnDisabled: OPTION_CARD.disabled,
  btnName: { fontSize: 14 },
  btnPrice: { fontSize: 13, color: 'var(--muted)', fontWeight: 600 },
}
