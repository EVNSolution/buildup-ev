import { useState } from 'react'
import type { PricingResult, QuoteResult } from '@shared/pricing/core'
import { SubsidyForm, type SubsidyInputs } from './SubsidyInputs'

interface Props {
  /** 지원여부 판정용(내장탑 미정 등) */
  calc: PricingResult | null
  /** 표시 금액의 단일 소스 — 총견적서 기준(견적서 PDF 와 동일 규칙) */
  total: QuoteResult | null
  /** 보조금 산정 입력이 갖춰졌는가(지역 선택 여부). 미선택이면 보조금 금액을 흐리게 보여준다. */
  hasCustomer: boolean
  /** 차량+특장 세부 (부가세 별도 단가) */
  breakdown: { trim_price: number; option_sum: number } | null
  /** 「보조금」 블록 팝업에서 그 자리에서 고치는 입력값 */
  subsidy: SubsidyInputs
  onSubsidyChange: (v: SubsidyInputs) => void
  /** 지역 선택 목록(지방보조금 조회 기준) */
  regions: string[]
}

function fmt(n: number) {
  return '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR')
}

export function PriceBar({ calc, total, hasCustomer, breakdown, subsidy, onSubsidyChange, regions }: Props) {
  const [showReg, setShowReg] = useState(false)
  const [showSubsidy, setShowSubsidy] = useState(false)
  const isUnsupported = calc?.status === 'unsupported'
  const tbd = isUnsupported ? (calc as { reason: string }).reason : null
  const ok = isUnsupported ? null : total

  // 등록·기타 = 차량 등록/부대 ⑥ + 특장 등록/부대 ⑩ + 탁송료
  // (견적서는 탁송료를 ② 차량 결제금액에 넣지만, 화면은 블록을 줄이려 등록·기타로 묶는다.
  //  이렇게 해야 위 흐름을 그대로 계산했을 때 실구매가와 정확히 맞는다.)
  const regEtc = ok ? ok.car_reg_cost + ok.body_reg_cost + ok.delivery_fee : 0
  const vehicleVat = ok ? ok.car_price : (breakdown ? Math.round(breakdown.trim_price * 1.1) : 0)
  const optionVat  = ok ? ok.body_price : (breakdown ? Math.round(breakdown.option_sum * 1.1) : 0)
  // 일반구매자(비사업자)는 환급 자체가 없다 — vat_refund_price 가 0 으로 내려온다.
  // 이때 차액을 그대로 쓰면 결제금액 전체가 환급액으로 표시되므로 0 으로 둔다.
  const noRefund   = !!ok && ok.vat_refund_price === 0
  const vatRefund  = ok && !noRefund ? (ok.car_payment + ok.body_payment) - ok.vat_refund_price : 0
  // 실구매가 = 부가세 환급까지만. 등록·기타는 더하지 않고 오른쪽에 따로 보여준다.
  // real_price(단일 소스)에서 등록·기타를 빼 계산해 견적서 규칙과 어긋나지 않게 한다.
  const netPrice = ok ? ok.real_price - regEtc : 0

  return (
    <div style={styles.bar}>
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

        <Op>−</Op>
        <Block label="구매 혜택" value={ok ? ok.purchase_benefit : 0} show={!!ok} negative />
        <Op>−</Op>
        {/* ③ 보조금 — 클릭하면 산정 입력(지역·소상공인·화물운송·경유차)을 그 자리에서 고친다 */}
        <div
          style={{ ...styles.block, ...styles.clickable }}
          onClick={() => setShowSubsidy(v => !v)}
        >
          <div style={styles.blockLabel}>보조금 ▸</div>
          <div style={{ ...styles.blockValue, ...(hasCustomer ? styles.negVal : styles.mutedVal) }}>
            {!hasCustomer ? '정보 입력 필요' : ok ? fmt(ok.subsidy_total) : '—'}
          </div>
          {showSubsidy && (
            <SubsidyPopup
              value={subsidy} onChange={onSubsidyChange} regions={regions}
              onClose={() => setShowSubsidy(false)}
            />
          )}
        </div>
        <Op>−</Op>
        {/* ④ 부가세 환급 — 일반구매자는 환급 대상이 아니다 */}
        <div style={styles.block}>
          <div style={styles.blockLabel}>부가세 환급</div>
          <div style={{ ...styles.blockValue, ...(noRefund ? styles.mutedVal : styles.negVal) }}>
            {!ok ? '—' : noRefund ? '환급 불가' : fmt(vatRefund)}
          </div>
        </div>

        <Op>=</Op>
        {/* ⑤ 실구매가 — 부가세 환급까지. 등록·기타는 포함하지 않는다 */}
        <div style={styles.hero}>
          <div style={styles.heroLabel}>실구매가</div>
          <div style={styles.heroValue}>{tbd ? '미정' : ok ? fmt(netPrice) : '—'}</div>
        </div>

        {/* ⑥ 등록·기타 — 흐름 밖 별도 표시(클릭 → 상세) */}
        <div style={{ ...styles.block, ...styles.clickable, ...styles.aside }} onClick={() => ok && setShowReg(v => !v)}>
          <div style={styles.blockLabel}>등록·기타 ▸ <span style={styles.asideNote}>별도</span></div>
          <div style={styles.blockValue}>{ok ? fmt(regEtc) : '—'}</div>
          {ok && <div style={styles.asideSub}>합계 {fmt(netPrice + regEtc)}</div>}
          {showReg && ok && <RegPopup ok={ok} onClose={() => setShowReg(false)} />}
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

/**
 * 보조금 산정 입력 팝업 — 등록·기타 상세 팝업과 같은 여닫이 방식.
 * 여기 값이 바뀌면 화면 금액이 즉시 다시 계산된다(견적 저장 전에도).
 */
function SubsidyPopup({ value, onChange, regions, onClose }: {
  value: SubsidyInputs
  onChange: (v: SubsidyInputs) => void
  regions: string[]
  onClose: () => void
}) {
  return (
    <>
      <div style={styles.popOverlay} onClick={e => { e.stopPropagation(); onClose() }} />
      {/* 입력칸이라 클릭이 블록 토글로 새어 나가면 안 된다 */}
      <div style={{ ...styles.popup, ...styles.popupLeft }} onClick={e => e.stopPropagation()}>
        <div style={styles.popTitle}>보조금 산정 조건</div>
        <SubsidyForm value={value} onChange={onChange} regions={regions} compact />
        <div style={styles.popFoot}>지역을 골라야 지방보조금이 반영됩니다.</div>
      </div>
    </>
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
        <Line k="구조변경 비용" v={fmt(ok.structure_change_fee)} />
        <Line k="특장 등록/부대비용 ⑩" v={fmt(ok.body_reg_cost)} bold />
        <div style={{ height: 8 }} />
        <Line k="탁송료" v={fmt(ok.delivery_fee)} />
        <Line k="등록·기타 합계" v={fmt(ok.car_reg_cost + ok.body_reg_cost + ok.delivery_fee)} bold />
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
  // EV& 브랜드 컬러(--lime #C8D200) 계열 — 어두운 초록은 브랜드와 어긋난다
  first: { ...cellBase, flex: 1.3, background: '#f7fadf', border: '1px solid var(--lime)' },
  firstLabel: { fontSize: 14, color: '#6b7300', fontWeight: 700 },
  firstValue: { fontSize: 17, fontWeight: 700, color: 'var(--dark)', marginTop: 2 },
  firstSub: { fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  block: { ...cellBase, position: 'relative' },
  clickable: { cursor: 'pointer', border: '1px dashed var(--line)' },
  // 등록·기타는 계산 흐름 밖 — 왼쪽에 구분선을 둬 실구매가와 시각적으로 분리한다
  aside: { flex: 1.1, marginLeft: 8, borderLeft: '2px solid var(--line)' },
  asideNote: { fontSize: 9.5, color: '#a8aeb6', fontWeight: 700 },
  asideSub: { fontSize: 10, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap' as const },
  blockLabel: { fontSize: 11, color: 'var(--muted)' },
  blockValue: { fontSize: 15, fontWeight: 700, color: 'var(--dark)', marginTop: 2, whiteSpace: 'nowrap' as const },
  negVal: { color: '#c0392b' },
  mutedVal: { color: '#bfc4cb' },
  hero: { ...cellBase, flex: 1.3, background: 'var(--dark)', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  heroLabel: { fontSize: 12, color: 'var(--lime)', fontWeight: 700 },
  heroValue: { fontSize: 22, fontWeight: 700, color: '#fff', marginTop: 2 },
  popOverlay: { position: 'fixed', inset: 0, zIndex: 40 },
  popup: { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 260, background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: 12 },
  popTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--line)' },
  // 보조금 블록은 가격바 왼쪽에 있어 오른쪽 정렬(popup)로 열면 화면 밖으로 나간다.
  popupLeft: { right: 'auto' as const, left: 0, width: 280 },
  popFoot: { fontSize: 10.5, color: 'var(--muted)', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line)' },
  line: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--body)', padding: '2px 0' },
  lineBold: { fontWeight: 700, color: 'var(--dark)', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 4 },
  lineNote: { color: 'var(--muted)' },
}
