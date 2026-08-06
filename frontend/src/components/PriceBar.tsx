import { useState } from 'react'
import type { PricingResult, QuoteResult } from '@shared/pricing/core'

interface Props {
  /** 지원여부 판정용(내장탑 미정 등) */
  calc: PricingResult | null
  /** 표시 금액의 단일 소스 — 총견적서 기준(견적서 PDF 와 동일 규칙) */
  total: QuoteResult | null
  hasCustomer: boolean
  /** 차량+특장 세부 (부가세 별도 단가) */
  breakdown: { trim_price: number; option_sum: number } | null
}

function fmt(n: number) {
  return '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR')
}

export function PriceBar({ calc, total, hasCustomer, breakdown }: Props) {
  const [showReg, setShowReg] = useState(false)
  const isUnsupported = calc?.status === 'unsupported'
  const tbd = isUnsupported ? (calc as { reason: string }).reason : null
  const ok = isUnsupported ? null : total

  const regEtc = ok ? ok.car_reg_cost + ok.body_reg_cost : 0
  const vehicleVat = ok ? ok.car_price : (breakdown ? Math.round(breakdown.trim_price * 1.1) : 0)
  const optionVat  = ok ? ok.body_price : (breakdown ? Math.round(breakdown.option_sum * 1.1) : 0)
  const vatRefund  = ok ? (ok.car_payment + ok.body_payment) - ok.vat_refund_price : 0

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
          <div style={styles.firstValue}>{ok ? fmt(ok.car_price + ok.body_price) : '—'}</div>
          {ok && (
            <div style={styles.firstSub}>차량 {fmt(vehicleVat)} · 특장 {fmt(optionVat)}</div>
          )}
        </div>

        <Op>+</Op>
        <Block label="탁송료" value={ok ? ok.delivery_fee : 0} show={!!ok} />
        <Op>−</Op>
        <Block label="구매 혜택" value={ok ? ok.purchase_benefit : 0} show={!!ok} negative />
        <Op>−</Op>
        <Block label="보조금" value={ok ? ok.subsidy_total : 0} show={!!ok} muted={!hasCustomer} negative />
        <Op>−</Op>
        <Block label="부가세 환급" value={vatRefund} show={!!ok} negative />
        <Op>+</Op>

        {/* ④ 등록·기타 (클릭 → 상세) */}
        <div style={{ ...styles.block, ...styles.clickable }} onClick={() => ok && setShowReg(v => !v)}>
          <div style={styles.blockLabel}>등록·기타 ▸</div>
          <div style={styles.blockValue}>{ok ? fmt(regEtc) : '—'}</div>
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

/** 견적서 PDF 의 ⑥ 차량 등록/부대 · ⑩ 특장 등록/부대 와 동일 항목 */
function RegPopup({ ok, onClose }: { ok: QuoteResult; onClose: () => void }) {
  return (
    <>
      <div style={styles.popOverlay} onClick={e => { e.stopPropagation(); onClose() }} />
      <div style={styles.popup} onClick={e => e.stopPropagation()}>
        <div style={styles.popTitle}>차량 등록/부대비용 ⑥</div>
        <Line k="차량 취득세 (감면 후)" v={fmt(ok.car_acq_tax)} />
        <Line k="공채할인액" v={fmt(ok.bond_discount)} />
        <Line k="번호판금액" v={fmt(ok.plate)} />
        <Line k="증지대" v={fmt(ok.stamp)} />
        <Line k="의무보험료" v={fmt(ok.insurance)} />
        <Line k="등록대행료" v={fmt(ok.reg_agency)} />
        <Line k="차량 등록/부대비용 ⑥" v={fmt(ok.car_reg_cost)} bold />
        <div style={{ height: 8 }} />
        <div style={styles.popTitle}>특장 등록/부대비용 ⑩</div>
        <Line k="특장 취득세 (2.0%)" v={fmt(ok.body_acq_tax)} />
        <Line k="등록부가수수료" v={fmt(ok.etc_fee)} />
        <Line k="특장 등록/부대비용 ⑩" v={fmt(ok.body_reg_cost)} bold />
        <div style={{ height: 8 }} />
        <div style={styles.popTitle}>참고</div>
        <Line k="탁송료 (위 흐름에 별도 표시)" v={fmt(ok.delivery_fee)} />
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

const cellBase = { background: 'var(--card)', borderRadius: 10, padding: '9px 13px', flex: 1, minWidth: 0 }

const styles: Record<string, React.CSSProperties> = {
  bar: { flexShrink: 0, borderTop: '1px solid var(--line)', background: '#fff', padding: '12px 16px' },
  warn: { background: 'var(--warnbg)', border: '1px solid #f0c9ad', color: 'var(--warn)', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10 },
  warnTbd: { background: '#f5f5f5', border: '1px solid #ddd', color: '#555', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10, fontWeight: 600 },
  flow: { display: 'flex', gap: 6, alignItems: 'stretch', width: '100%' },
  op: { fontSize: 16, color: 'var(--muted)', fontWeight: 700, flexShrink: 0, alignSelf: 'center' },
  first: { ...cellBase, flex: 1.3, background: '#eef2e6', border: '1px solid #d5e0bf' },
  firstLabel: { fontSize: 11, color: '#5a6b3a', fontWeight: 700 },
  firstValue: { fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginTop: 2 },
  firstSub: { fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  block: { ...cellBase, position: 'relative' },
  clickable: { cursor: 'pointer', border: '1px dashed var(--line)' },
  blockLabel: { fontSize: 11, color: 'var(--muted)' },
  blockValue: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', marginTop: 2, whiteSpace: 'nowrap' as const },
  negVal: { color: '#c0392b' },
  mutedVal: { color: '#bfc4cb' },
  hero: { ...cellBase, flex: 1.3, background: 'var(--dark)', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  heroLabel: { fontSize: 12, color: 'var(--lime)', fontWeight: 700 },
  heroValue: { fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 2 },
  popOverlay: { position: 'fixed', inset: 0, zIndex: 40 },
  popup: { position: 'absolute', bottom: 'calc(100% + 8px)', left: 0, zIndex: 41, width: 260, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: 12 },
  popTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--line)' },
  line: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--body)', padding: '2px 0' },
  lineBold: { fontWeight: 700, color: 'var(--dark)', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 4 },
  lineNote: { color: 'var(--muted)' },
}
