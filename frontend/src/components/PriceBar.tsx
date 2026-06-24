import type { PricingResult } from '@shared/pricing/core'
import { Tooltip } from './Tooltip'

interface Props {
  calc: PricingResult | null
  hasCustomer: boolean
}

function fmt(n: number) {
  return '₩' + n.toLocaleString('ko-KR')
}

export function PriceBar({ calc, hasCustomer }: Props) {
  const ok = calc?.status === 'ok' ? calc : null
  const isUnsupported = calc?.status === 'unsupported'
  const tbd = isUnsupported ? (calc as { reason: string }).reason : null

  return (
    <div style={styles.bar}>
      {!hasCustomer && ok && (
        <div style={styles.warn}>
          고객정보 미입력 — <b>보조금 미반영</b> 참고 견적입니다. 정확한 실구매가는 고객정보 입력 후 확인하세요.
        </div>
      )}
      {isUnsupported && (
        <div style={styles.warnTbd}>{tbd}</div>
      )}
      <div style={styles.grid}>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>
            <Tooltip placement="above" text={'국고+지방 보조금을 차량가에서\n차감한 가격 (소상공인 할인 포함)'}>
              보조금 적용가
            </Tooltip>
          </div>
          <div style={hasCustomer ? styles.cellValue : styles.cellValueMuted}>
            {tbd ? '—' : ok ? (hasCustomer ? fmt(ok.applied_price) : '보조금 미반영') : '—'}
          </div>
        </div>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>
            <Tooltip placement="above" text={'법인·개인사업자는 부가세(10%)\n환급 가능. 환급 후 실질 부담액'}>
              부가세 환급 후
            </Tooltip>
          </div>
          <div style={styles.cellValue}>{tbd ? '—' : ok ? fmt(ok.vat_refunded_price) : '—'}</div>
        </div>
        <div style={styles.cell}>
          <div style={styles.cellLabel}>
            <Tooltip placement="above" text="등록비·이전비 등 부대비용 합계">
              총 비용 (등록+기타)
            </Tooltip>
          </div>
          <div style={styles.cellValue}>{tbd ? '—' : ok ? fmt(ok.reg_cost + ok.etc_cost) : '—'}</div>
        </div>
        <div style={styles.hero}>
          <div style={styles.heroLabel}>
            <Tooltip placement="above" text={'보조금 차감 + 부가세 환급\n부대비용 포함 최종 실부담액'}>
              실구매가 (부가세 환급 후)
            </Tooltip>
          </div>
          <div style={styles.heroValue}>
            {tbd ? '미정 (TBD)' : ok ? fmt(ok.real_price) : '—'}
          </div>
          {ok && (
            <div style={styles.heroSub}>공급가 {fmt(ok.supply_price)} · 보조금 {fmt(ok.subsidy_total)}</div>
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
  warnTbd: {
    background: '#f5f5f5',
    border: '1px solid #ddd',
    color: '#555',
    fontSize: 11.5,
    padding: '7px 10px',
    borderRadius: 8,
    marginBottom: 10,
    fontWeight: 600,
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
  cellValueMuted: { fontSize: 14, fontWeight: 700, color: '#bfc4cb', marginTop: 3 },
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
