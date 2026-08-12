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
  badgeReq: { fontSize: 13, fontWeight: 700, color: '#b23c3c', background: '#fdecec', border: '1px solid #f3c3c3', borderRadius: 5, padding: '1px 6px' },
  badgeOpt: { fontSize: 13, fontWeight: 700, color: '#5a6b7a', background: '#eef1f4', border: '1px solid #dbe1e7', borderRadius: 5, padding: '1px 6px' },
  btns: { display: 'flex', gap: 7, flexWrap: 'wrap' as const },
  btn: { ...btnBase, ...OPTION_CARD.base, color: 'var(--body)' },
  btnOn: { ...btnBase, ...OPTION_CARD.on },
  btnDisabled: OPTION_CARD.disabled,
  btnName: { fontSize: 14 },
  btnPrice: { fontSize: 13, color: 'var(--muted)', fontWeight: 600 },
}
