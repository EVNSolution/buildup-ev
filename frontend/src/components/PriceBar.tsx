import type { QuoteResult } from '@shared/types/index'

interface Props {
  result: QuoteResult | null
  hasSubsidy: boolean
}

function fmt(n: number) {
  return '₩' + n.toLocaleString('ko-KR')
}

export function PriceBar({ result, hasSubsidy }: Props) {
  return (
    <div style={styles.bar}>
      {!hasSubsidy && result && (
        <div style={styles.warn}>
          ⚠ 고객정보 미입력 — <b>보조금 미반영</b> 참고 견적입니다. 정확한 실구매가는 고객정보 입력 후 확인하세요.
        </div>
      )}
      <div style={styles.grid}>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>보조금 적용가</div>
          <div style={hasSubsidy ? styles.cellValue : styles.cellValueMuted}>
            {result ? (hasSubsidy ? fmt(result.subsidy_applied_price) : '보조금 미반영') : '—'}
          </div>
        </div>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>부가세 환급 후</div>
          <div style={styles.cellValue}>{result ? fmt(result.vat_refund_price) : '—'}</div>
        </div>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>총 비용 (등록+기타)</div>
          <div style={styles.cellValue}>{result ? fmt(result.registration_fee) : '—'}</div>
        </div>
        <div style={styles.hero}>
          <div style={styles.heroLabel}>실구매가 (부가세 환급 후)</div>
          <div style={styles.heroValue}>
            {result ? (result.final_price ? fmt(result.final_price) : '—') : '—'}
          </div>
          {result && result.final_price > 0 && (
            <div style={styles.heroSub}>고객 실제 부담액 · placeholder</div>
          )}
        </div>
      </div>
    </div>
  )
}

const styles = {
  bar: {
    flexShrink: 0,
    borderTop: '1px solid var(--line)',
    background: '#fff',
    padding: '12px 16px',
  },
  warn: {
    background: 'var(--warnbg)',
    border: '1px solid #f0c9ad',
    color: 'var(--warn)',
    fontSize: 11.5,
    padding: '7px 10px',
    borderRadius: 8,
    marginBottom: 10,
  },
  grid: { display: 'flex', gap: 10, alignItems: 'stretch' },
  cell: {
    flex: 1,
    background: 'var(--card)',
    borderRadius: 10,
    padding: '10px 13px',
  },
  cellLabel: { fontSize: 11, color: 'var(--muted)' },
  cellValue: { fontSize: 16, fontWeight: 700, color: 'var(--dark)', marginTop: 3 },
  cellValueMuted: { fontSize: 16, fontWeight: 700, color: '#bfc4cb', marginTop: 3 },
  hero: {
    flex: 1.5,
    background: 'var(--dark)',
    borderRadius: 10,
    padding: '10px 13px',
    display: 'flex',
    flexDirection: 'column' as const,
    justifyContent: 'center',
  },
  heroLabel: { fontSize: 12, color: 'var(--lime)', fontWeight: 700 },
  heroValue: { fontSize: 24, fontWeight: 700, color: '#fff', marginTop: 4 },
  heroSub: { fontSize: 10, color: '#9aa0a8', marginTop: 3 },
}
