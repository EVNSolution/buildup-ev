import { useState } from 'react'
import type { PricingResult, PricingOk } from '@shared/pricing/core'

interface Props {
  calc: PricingResult | null
  hasCustomer: boolean
  /** 차량+특장 세부 (부가세 별도 단가) */
  breakdown: { trim_price: number; option_sum: number } | null
}

function fmt(n: number) {
  const s = Math.round(Math.abs(n)).toLocaleString('ko-KR')
  return (n < 0 ? '−₩' : '₩') + s
}

export function PriceBar({ calc, hasCustomer, breakdown }: Props) {
  const [showReg, setShowReg] = useState(false)
  const ok = calc?.status === 'ok' ? calc : null
  const isUnsupported = calc?.status === 'unsupported'
  const tbd = isUnsupported ? (calc as { reason: string }).reason : null

  const regEtc = ok ? ok.reg_cost + ok.etc_cost : 0
  const vehicleVat = breakdown ? Math.round(breakdown.trim_price * 1.1) : (ok?.vehicle_price ?? 0)
  const optionVat  = breakdown ? Math.round(breakdown.option_sum * 1.1) : 0

  return (
    <div style={styles.bar}>
      {!hasCustomer && ok && (
        <div style={styles.warn}>고객정보 미입력 — <b>보조금 미반영</b> 참고 견적입니다. 정확한 실구매가는 고객정보 입력 후 확인하세요.</div>
      )}
      {isUnsupported && <div style={styles.warnTbd}>{tbd}</div>}

      <div style={styles.flow}>
        {/* ① 차량+특장 (부가세 포함) */}
        <div style={styles.first}>
          <div style={styles.firstLabel}>차량 + 특장 (VAT 포함)</div>
          <div style={styles.firstValue}>{ok ? fmt(ok.vehicle_price) : '—'}</div>
          {ok && breakdown && (
            <div style={styles.firstSub}>차량 {fmt(vehicleVat)} · 특장 {fmt(optionVat)}</div>
          )}
        </div>

        <Op>−</Op>
        <Block label="보조금" value={ok ? -ok.subsidy_total : 0} show={!!ok} muted={!hasCustomer} negative />
        <Op>−</Op>
        <Block label="부가세 환급" value={ok ? -ok.vat : 0} show={!!ok} negative />
        <Op>+</Op>

        {/* ④ 등록·기타 (클릭 → 상세) */}
        <div style={{ ...styles.block, ...styles.clickable }} onClick={() => ok && setShowReg(v => !v)}>
          <div style={styles.blockLabel}>등록·기타 ▸</div>
          <div style={styles.blockValue}>{ok ? '+' + fmt(regEtc) : '—'}</div>
          {showReg && ok && <RegPopup ok={ok} onClose={() => setShowReg(false)} />}
        </div>

        <Op>=</Op>
        {/* ⑤ 실구매가 */}
        <div style={styles.hero}>
          <div style={styles.heroLabel}>실구매가</div>
          <div style={styles.heroValue}>{tbd ? '미정' : ok ? fmt(ok.real_price) : '—'}</div>
        </div>
      </div>
    </div>
  )
}

function Op({ children }: { children: string }) {
  return <div style={styles.op}>{children}</div>
}

function Block({ label, value, show, muted, negative }: { label: string; value: number; show: boolean; muted?: boolean; negative?: boolean }) {
  return (
    <div style={styles.block}>
      <div style={styles.blockLabel}>{label}</div>
      <div style={{ ...styles.blockValue, ...(muted ? styles.mutedVal : negative ? styles.negVal : null) }}>
        {show ? (muted ? '미반영' : fmt(value)) : '—'}
      </div>
    </div>
  )
}

function RegPopup({ ok, onClose }: { ok: PricingOk; onClose: () => void }) {
  return (
    <>
      <div style={styles.popOverlay} onClick={e => { e.stopPropagation(); onClose() }} />
      <div style={styles.popup} onClick={e => e.stopPropagation()}>
        <div style={styles.popTitle}>등록 비용 ③</div>
        <Line k="차량 취득세율" v="5%" />
        <Line k="차량 취득세" v={fmt(ok.reg_acq_tax)} />
        <Line k="차량 취득세 감면" v={fmt(ok.reg_acq_tax_relief)} />
        <Line k="특장 취득세율" v="2%" />
        <Line k="특장 취득세" v={fmt(ok.reg_special_acq_tax)} />
        <Line k="증지대" v={fmt(ok.reg_stamp)} />
        <Line k="번호판대" v={fmt(ok.reg_plate)} />
        <Line k="등록대행료" v={fmt(ok.reg_agency)} />
        <Line k="의무보험료" v="₩2,800" note />
        <Line k="총 등록 비용 ③" v={fmt(ok.reg_cost)} bold />
        <div style={{ height: 8 }} />
        <div style={styles.popTitle}>기타 비용 ④</div>
        <Line k="탁송료" v={fmt(ok.delivery_fee)} />
        <Line k="등록부가수수료" v={fmt(ok.etc_fee)} />
        <Line k="총 기타 비용 ④" v={fmt(ok.etc_cost)} bold />
      </div>
    </>
  )
}

function Line({ k, v, bold, note }: { k: string; v: string; bold?: boolean; note?: boolean }) {
  return (
    <div style={{ ...styles.line, ...(bold ? styles.lineBold : null) }}>
      <span style={note ? styles.lineNote : undefined}>{k}{note ? ' (미합산)' : ''}</span>
      <span>{v}</span>
    </div>
  )
}

const cellBase = { background: 'var(--card)', borderRadius: 10, padding: '9px 11px', minWidth: 84 }

const styles: Record<string, React.CSSProperties> = {
  bar: { flexShrink: 0, borderTop: '1px solid var(--line)', background: '#fff', padding: '12px 16px' },
  warn: { background: 'var(--warnbg)', border: '1px solid #f0c9ad', color: 'var(--warn)', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10 },
  warnTbd: { background: '#f5f5f5', border: '1px solid #ddd', color: '#555', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10, fontWeight: 600 },
  flow: { display: 'flex', gap: 6, alignItems: 'center', overflowX: 'auto' },
  op: { fontSize: 16, color: 'var(--muted)', fontWeight: 700, flexShrink: 0 },
  first: { ...cellBase, background: '#eef2e6', border: '1px solid #d5e0bf', flexShrink: 0 },
  firstLabel: { fontSize: 11, color: '#5a6b3a', fontWeight: 700 },
  firstValue: { fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginTop: 2 },
  firstSub: { fontSize: 10, color: 'var(--muted)', marginTop: 2 },
  block: { ...cellBase, position: 'relative', flexShrink: 0 },
  clickable: { cursor: 'pointer', border: '1px dashed var(--line)' },
  blockLabel: { fontSize: 11, color: 'var(--muted)' },
  blockValue: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', marginTop: 2 },
  negVal: { color: '#c0392b' },
  mutedVal: { color: '#bfc4cb', fontSize: 13 },
  hero: { background: 'var(--dark)', borderRadius: 10, padding: '9px 14px', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  heroLabel: { fontSize: 12, color: 'var(--lime)', fontWeight: 700 },
  heroValue: { fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 2 },
  popOverlay: { position: 'fixed', inset: 0, zIndex: 40 },
  popup: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 41, width: 260, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: 12 },
  popTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--line)' },
  line: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--body)', padding: '2px 0' },
  lineBold: { fontWeight: 700, color: 'var(--dark)', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 4 },
  lineNote: { color: 'var(--muted)' },
}
