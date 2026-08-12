import { useState } from 'react'
import type { PricingResult, QuoteResult } from '@shared/pricing/core'
import { priceBarView } from '@shared/pricing/core'
import { SubsidyForm, type SubsidyInputs } from './SubsidyInputs'
import { useIsPortrait } from '../hooks/useIsPortrait'
import { useIsTouch } from '../hooks/useIsTouch'

interface Props {
  /** 지원여부 판정용(내장탑 미정 등) */
  calc: PricingResult | null
  /** 표시 금액의 단일 소스 — 총견적서 기준(견적서 PDF 와 동일 규칙) */
  total: QuoteResult | null
  /** 보조금 산정 입력이 갖춰졌는가(지역 선택 여부). 미선택이면 보조금 금액을 흐리게 보여준다. */
  hasCustomer: boolean
  /**
   * 차량+특장 세부 (부가세 별도 단가).
   * 지금은 화면에 쓰지 않는다 — 차량/특장을 나눠 보여주던 줄을 뺐다.
   * 호출부가 이미 넘기고 있고 되살릴 수 있어 자리만 남겨 둔다.
   */
  breakdown?: { trim_price: number; option_sum: number } | null
  /** 「보조금」 블록 팝업에서 그 자리에서 고치는 입력값 */
  subsidy: SubsidyInputs
  onSubsidyChange: (v: SubsidyInputs) => void
  /** 지역 선택 목록(지방보조금 조회 기준) */
  regions: string[]
}

function fmt(n: number) {
  return '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR')
}

export function PriceBar({ calc, total, hasCustomer, subsidy, onSubsidyChange, regions }: Props) {
  // 화면이 1:1 보다 세로로 길면 옆으로 늘어놓지 않고 **세로로 쌓는다**.
  // 좁은 폭에 6칸을 욱여넣으면 글자를 아무리 줄여도 읽히지 않는다.
  const stack = useIsPortrait()
  // 태블릿·휴대폰은 세로가 귀하다 — 가격바를 두껍게 하지 않아 옵션 선택 칸을 넓힌다
  const touch = useIsTouch()
  const [showReg, setShowReg] = useState(false)
  const [showSubsidy, setShowSubsidy] = useState(false)
  const isUnsupported = calc?.status === 'unsupported'
  const tbd = isUnsupported ? (calc as { reason: string }).reason : null
  const ok = isUnsupported ? null : total

  // 표시값 계산은 shared/pricing/pricebar.ts 한 곳에만 있다 — 화면은 결과를 받아 쓴다.
  // (컴포넌트 안에서 금액을 다시 만들면 앱을 붙일 때 같은 식이 한 벌 더 생긴다)
  const view = ok ? priceBarView(ok) : null
  const regEtc   = view?.regEtc ?? 0
  const noRefund = view?.noRefund ?? false
  const vatRefund = view?.vatRefund ?? 0
  const netPrice = view?.netPrice ?? 0

  // 세로로 쌓을 땐 폭이 넉넉하므로 글자를 줄이지 않는다(가로 배치용 축소는 stack 에서 해제).
  const row  = stack ? styles.rowCell : touch ? null : styles.cellTall
  const big  = stack ? styles.stackBig : null
  const lbl  = stack ? styles.stackLabel : null

  return (
    <div style={stack || touch ? styles.bar : { ...styles.bar, ...styles.barTall }}>
      {isUnsupported && <div style={styles.warnTbd}>{tbd}</div>}

      <div style={stack ? styles.flowStack : styles.flow}>
        {/* ① 차량+특장 (부가세 포함) */}
        <div style={{ ...styles.first, ...row }}>
          {/* 좁은 화면에서는 '(VAT 포함)'이 다음 줄로 접힌다 — 잘려 사라지는 것보다 낫다 */}
          <div style={{ ...styles.firstLabel, ...lbl }}>차량 + 특장 (VAT 포함)</div>
          <div style={stack ? styles.stackRight : undefined}>
            <div style={{ ...styles.firstValue, ...big }}>{view ? fmt(view.start) : '—'}</div>
          </div>
        </div>

        <Op stack={stack}>−</Op>
        <Block label="구매 혜택" value={ok ? ok.purchase_benefit : 0} show={!!ok} negative stack={stack} tall={!stack && !touch} />
        <Op stack={stack}>−</Op>
        {/* ③ 보조금 — 클릭하면 산정 입력(지역·소상공인·화물운송·경유차)을 그 자리에서 고친다 */}
        <div
          style={{ ...styles.block, ...styles.clickable, ...row }}
          onClick={() => setShowSubsidy(v => !v)}
        >
          <div style={{ ...styles.blockLabel, ...lbl }}>보조금 ▸</div>
          <div style={stack ? styles.stackRight : undefined}>
            <div style={{ ...styles.blockValue, ...big, ...(hasCustomer ? styles.negVal : styles.mutedVal) }}>
              {!hasCustomer ? '정보 입력 필요' : ok ? fmt(ok.subsidy_total) : '—'}
            </div>
            {/*
              합계만 보면 왜 그 금액인지 알 수 없다 — 네 가지 내역을 항상 같은 순서로 보여준다.
              0원인 항목도 남긴다(빠진 게 아니라 해당 없음이라는 뜻이 드러나야 한다).
            */}
            {hasCustomer && ok && (
              <div style={{ ...styles.firstSub, ...(stack ? styles.stackSub : null) }}>
                <div>국고 {fmt(ok.subsidy_national)}</div>
                <div>지방 {fmt(ok.subsidy_local)}</div>
                <div>소상공인 {fmt(ok.subsidy_sosang)}</div>
                <div>화물운송 {fmt(ok.subsidy_takbae)}</div>
              </div>
            )}
          </div>
          {showSubsidy && (
            <SubsidyPopup
              value={subsidy} onChange={onSubsidyChange} regions={regions}
              onClose={() => setShowSubsidy(false)}
            />
          )}
        </div>
        <Op stack={stack}>−</Op>
        {/* ④ 부가세 환급 — 일반구매자는 환급 대상이 아니다 */}
        <div style={{ ...styles.block, ...row }}>
          <div style={{ ...styles.blockLabel, ...lbl }}>부가세 환급</div>
          <div style={{ ...styles.blockValue, ...big, ...(noRefund ? styles.mutedVal : styles.negVal) }}>
            {!ok ? '—' : noRefund ? '환급 불가' : fmt(vatRefund)}
          </div>
        </div>

        <Op stack={stack}>=</Op>
        {/* ⑤ 실구매가 — 부가세 환급까지. 등록·기타는 포함하지 않는다 */}
        <div style={{ ...styles.hero, ...(stack ? styles.rowCell : touch ? null : styles.cellTall) }}>
          <div style={{ ...styles.heroLabel, ...lbl }}>실구매가</div>
          <div style={{ ...styles.heroValue, ...(stack ? styles.stackHero : null) }}>{tbd ? '미정' : ok ? fmt(netPrice) : '—'}</div>
        </div>

        {/* ⑥ 등록·기타 — 흐름 밖 별도 표시(클릭 → 상세) */}
        <div
          style={{ ...styles.block, ...styles.clickable, ...(stack ? { ...styles.rowCell, ...styles.asideStack } : touch ? styles.aside : { ...styles.aside, ...styles.cellTall }) }}
          onClick={() => ok && setShowReg(v => !v)}
        >
          <div style={{ ...styles.blockLabel, ...lbl }}>등록·기타 ▸ <span style={styles.asideNote}>별도</span></div>
          <div style={stack ? styles.stackRight : undefined}>
            <div style={{ ...styles.blockValue, ...big }}>{ok ? fmt(regEtc) : '—'}</div>
            {view && <div style={{ ...styles.asideSub, ...(stack ? styles.stackSub : null) }}>합계 {fmt(view.grandTotal)}</div>}
          </div>
          {showReg && ok && <RegPopup ok={ok} onClose={() => setShowReg(false)} />}
        </div>
      </div>
    </div>
  )
}

function Op({ children, stack }: { children: string; stack?: boolean }) {
  return <div style={stack ? styles.opStack : styles.op}>{children}</div>
}

function Block({ label, value, show, muted, negative, stack, tall }: { label: string; value: number; show: boolean; muted?: boolean; negative?: boolean; stack?: boolean; tall?: boolean }) {
  return (
    <div style={{ ...styles.block, ...(stack ? styles.rowCell : tall ? styles.cellTall : null) }}>
      <div style={{ ...styles.blockLabel, ...(stack ? styles.stackLabel : null) }}>{label}</div>
      <div style={{ ...styles.blockValue, ...(stack ? styles.stackBig : null), ...(muted ? styles.mutedVal : negative ? styles.negVal : null) }}>
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
        <SubsidyForm value={value} onChange={onChange} regions={regions} compact hideRequired />
        <div style={styles.popFoot}>
          {value.business_type === 'corporate'
            ? '법인사업자는 지방보조금 대상이 아닙니다 — 국고보조금만 반영됩니다.'
            : '지역을 골라야 지방보조금이 반영됩니다.'}
        </div>
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
        <Line k="등록·기타 합계" v={fmt(priceBarView(ok).regEtc)} bold />
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

/**
 * 가격바 글자 크기 — 폭에 따라 줄어든다.
 *
 * 3D 를 16:9 로 고정하면서 이 바의 폭이 좁아졌고, 고정 크기 글자가 블록 밖으로 삐져나왔다.
 * 이제 `clamp(최소, 화면폭 비례, 최대)` 로 넓은 화면에선 예전 크기 그대로, 좁아지면 줄어든다.
 * 계수는 바 폭 ≒ 화면폭의 65%(3D 칸이 2, 옵션 패널이 1) 기준으로 뽑았다.
 * 그래도 안 들어가는 극단적인 경우를 대비해 글자줄마다 overflow 를 막아 둔다(clip).
 */
const fit = (min: number, vw: number, max: number) => `clamp(${min}px, ${vw}vw, ${max}px)`
/** 글자가 어떤 경우에도 블록 밖으로 나가지 않게. 팝업은 블록에 달려 있으므로 여기서만 자른다. */
const noSpill = { overflow: 'hidden', textOverflow: 'ellipsis' as const, whiteSpace: 'nowrap' as const }

const cellBase = {
  background: 'var(--card)', borderRadius: 'var(--r-md)',
  // ⚠️ padding 축약형을 쓰면 안 된다 — 아래 cellTall 이 위아래 여백만 덮어쓰는데,
  //    한 요소에서 축약형과 개별속성이 섞이면 React 가 렌더마다 경고를 뱉는다.
  paddingTop: fit(6, 0.47, 9), paddingBottom: fit(6, 0.47, 9),
  paddingLeft: fit(8, 0.68, 13), paddingRight: fit(8, 0.68, 13),
  flex: 1, minWidth: 0,
}

const styles: Record<string, React.CSSProperties> = {
  bar: { flexShrink: 0, borderTop: '1px solid var(--line)', background: '#fff', padding: '12px 16px' },
  // 가로 배치일 때만 두께를 키운다 — 세로로 쌓을 땐 이미 충분히 높다.
  barTall: { padding: '34px 16px' },
  // 칸도 같이 두툼하게(가로 배치 전용). 글자는 그대로 두고 위아래 여백만 늘린다.
  cellTall: { paddingTop: fit(20, 1.6, 30), paddingBottom: fit(20, 1.6, 30) },
  warn: { background: 'var(--warnbg)', border: '1px solid #f0c9ad', color: 'var(--warn)', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10 },
  warnTbd: { background: '#f5f5f5', border: '1px solid #ddd', color: '#555', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10, fontWeight: 600 },
  flow: { display: 'flex', gap: fit(3, 0.31, 6), alignItems: 'stretch', width: '100%' },
  op: { fontSize: fit(11, 0.83, 16), color: 'var(--muted)', fontWeight: 700, flexShrink: 0, alignSelf: 'center' },
  // EV& 브랜드 컬러(--lime #C8D200) 계열 — 어두운 초록은 브랜드와 어긋난다
  // 테두리 없이 배경색만으로 구분한다 — 선을 두르면 칸마다 굵기가 달라 보여 지저분했다
  first: { ...cellBase, flex: 1.3, background: '#f7fadf' },
  // 잘라서 없애기보다 접히게 둔다 — '(VAT 포함)'이 사라지면 무슨 금액인지 알 수 없다
  firstLabel: { fontSize: fit(11, 0.73, 14), color: '#6b7300', fontWeight: 700, overflow: 'hidden' },
  firstValue: { fontSize: fit(11, 0.88, 17), fontWeight: 700, color: 'var(--dark)', marginTop: 2, ...noSpill },
  // 차량·특장 분해는 금액이 길어 좁은 화면에서 한 줄에 안 들어간다.
  // 숫자를 잘라 버리면 안 되므로 이 줄만 두 줄로 접히게 둔다(블록 밖으로는 못 나감).
  firstSub: { fontSize: fit(10, 0.68, 13), color: 'var(--muted)', marginTop: 3, lineHeight: 1.35, overflow: 'hidden' },
  block: { ...cellBase, position: 'relative' },
  // 누를 수 있다는 표시는 라벨의 '▸' 로 충분하다(점선 테두리는 뺐다)
  clickable: { cursor: 'pointer' },
  // 등록·기타는 계산 흐름 밖 — 왼쪽에 구분선을 둬 실구매가와 시각적으로 분리한다
  // 계산 흐름 밖이라는 구분은 왼쪽 여백으로만 준다
  aside: { flex: 1.1, marginLeft: fit(10, 0.83, 16) },
  asideNote: { fontSize: fit(10, 0.68, 13), color: '#a8aeb6', fontWeight: 700 },
  asideSub: { fontSize: fit(10, 0.68, 13), color: 'var(--muted)', marginTop: 3, ...noSpill },
  // 칸 제목은 모두 같은 크기 — 오른쪽 패널 글자(14)와 비슷한 수준으로 맞춘다
  blockLabel: { fontSize: fit(11, 0.73, 14), color: 'var(--muted)', ...noSpill },
  // 금액 글자 크기는 차량+특장 칸(firstValue)과 동일하게 — 칸마다 다르면 눈이 튄다
  blockValue: { fontSize: fit(11, 0.88, 17), fontWeight: 700, color: 'var(--dark)', marginTop: 2, ...noSpill },
  negVal: { color: '#c0392b' },
  mutedVal: { color: '#bfc4cb' },
  hero: { ...cellBase, flex: 1.3, background: 'var(--dark)', display: 'flex', flexDirection: 'column', justifyContent: 'center' },
  heroLabel: { fontSize: fit(11, 0.73, 14), color: 'var(--lime)', fontWeight: 700, ...noSpill },
  heroValue: { fontSize: fit(13, 1.14, 22), fontWeight: 700, color: '#fff', marginTop: 2, ...noSpill },
  // ── 세로 배치(화면이 1:1 보다 세로로 길 때) ──────────────────────────────
  // 칸마다 '이름 왼쪽 · 금액 오른쪽' 한 줄. 폭이 넉넉하니 글자는 원래 크기로 되돌린다.
  flowStack: { display: 'flex', flexDirection: 'column', gap: 4, width: '100%' },
  // flexDirection 을 명시해야 한다 — 실구매가 칸(hero)이 column 이라 안 그러면 세로 모드에서 그대로 남는다
  rowCell: { display: 'flex', flexDirection: 'row' as const, alignItems: 'center', justifyContent: 'space-between', gap: 10, flex: 'none' },
  stackRight: { textAlign: 'right' as const, minWidth: 0 },
  // 세로 배치에서는 라벨과 금액이 한 줄에 나란히 선다 — 라벨이 접히면 줄 높이가 들쭉날쭉해진다.
  // 폭은 넉넉하므로(세로 화면은 가로가 짧지 않다) 접지 않고 그대로 편다.
  stackLabel: { fontSize: 12.5, flexShrink: 0, whiteSpace: 'nowrap' as const },
  stackBig: { fontSize: 16, marginTop: 0 },
  stackHero: { fontSize: 20, marginTop: 0 },
  stackSub: { fontSize: 10.5, marginTop: 1 },
  // 세로에서는 위쪽 여백으로 흐름 밖임을 표시한다
  asideStack: { marginLeft: 0, marginTop: 10 },
  opStack: { fontSize: 12, color: 'var(--muted)', fontWeight: 700, alignSelf: 'center', lineHeight: 1 },
  popOverlay: { position: 'fixed', inset: 0, zIndex: 40 },
  // 가격바가 화면 맨 아래라 팝업은 위로 열린다. 내용이 길면 화면 위로 넘쳐 잘리므로
  // 높이를 화면에 맞춰 자르고 안에서 스크롤한다(태블릿에서 위가 잘리던 문제).
  popup: { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 260, maxHeight: 'min(70vh, 460px)', overflowY: 'auto', background: '#fff', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: 12 },
  popTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--line)' },
  // 보조금 블록은 가격바 왼쪽에 있어 오른쪽 정렬(popup)로 열면 화면 밖으로 나간다.
  // 폭 364 = 가장 긴 줄(「화물자동차 운송사업허가증 · 개인사업자 국고 10% 추가」)이
  // 체크박스까지 포함해 344px 필요 + 여유. 좁으면 이 줄이 두 줄로 접혀 지저분했다.
  popupLeft: { right: 'auto' as const, left: 0, width: 364 },
  popFoot: { fontSize: 10.5, color: 'var(--muted)', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line)' },
  line: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--body)', padding: '2px 0' },
  lineBold: { fontWeight: 700, color: 'var(--dark)', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 4 },
  lineNote: { color: 'var(--muted)' },
}
