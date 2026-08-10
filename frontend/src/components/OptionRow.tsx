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
  padding: '13px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  gap: 3,
}

const styles = {
  // 글자 크기 세 단계 — 본문 13.5 / 보조 12.5 / 뱃지 11.5.
  // '작은 글씨로 의도한 것'은 본문보다 1씩 작게 유지한다.
  row: { marginBottom: 16 },
  head: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 },
  label: { fontSize: 12.5, color: 'var(--muted)' },
  badgeReq: { fontSize: 11.5, fontWeight: 700, color: '#b23c3c', background: '#fdecec', border: '1px solid #f3c3c3', borderRadius: 5, padding: '1px 6px' },
  badgeOpt: { fontSize: 11.5, fontWeight: 700, color: '#5a6b7a', background: '#eef1f4', border: '1px solid #dbe1e7', borderRadius: 5, padding: '1px 6px' },
  btns: { display: 'flex', gap: 7, flexWrap: 'wrap' as const },
  btn: { ...btnBase, border: '1px solid var(--line)', color: 'var(--body)' },
  btnOn: { ...btnBase, border: '2px solid var(--lime)', boxShadow: '0 0 0 2px rgba(200,210,0,.25)', color: 'var(--dark)', fontWeight: 700 },
  btnDisabled: { opacity: 0.4, cursor: 'not-allowed' },
  btnName: { fontSize: 13.5 },
  btnPrice: { fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 },
}
