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
  /**
   * 좁은 창 — 폭 전체를 쓰되 **세로로 쌓지 않는다**.
   * 세로로 쌓으면 6칸이 300px 가까이 되어 옵션 패널이 통째로 밀려난다(실측: 패널 높이 0).
   * 대신 한 줄로 두고 옆으로 밀어 보게 한다 — 높이를 아끼는 쪽이 낫다.
   */
  compact?: boolean
  /**
   * 휴대폰 — 6칸을 다 펼칠 자리가 없다. **실구매가 한 줄**만 늘 보이게 두고,
   * 나머지 흐름은 눌러서 펼친다. 상담 중 가장 자주 보는 숫자가 실구매가라 그 하나를 남겼다.
   */
  summary?: boolean
}

function fmt(n: number) {
  return '₩' + Math.round(Math.abs(n)).toLocaleString('ko-KR')
}

/**
 * 글자의 대략적인 폭(em) — 폰트를 직접 재지 않고 어림한다.
 * 숫자는 tabular-nums 라 폭이 고정이고 한글은 정사각형에 가깝다. 이 둘만 알면
 * "칸을 채우려면 몇 px 이어야 하는가" 를 충분히 정확하게 구할 수 있다.
 */
function textEm(t: string): number {
  let em = 0
  for (const ch of t) {
    if (/[가-힣ㄱ-ㆎ]/.test(ch)) em += 1        // 한글
    else if (ch === ' ') em += 0.32
    else em += 0.6                                              // 숫자·₩·쉼표
  }
  return em || 1
}

/**
 * 칸 폭에 맞춰 **금액 글자 크기가 스스로 맞춰지는** 표시.
 *
 * 예전엔 화면 폭에 비례한 clamp 하나로 모든 칸의 글자를 정해서, 자릿수가 짧은 칸은
 * 오른쪽이 휑하게 비고 긴 칸은 빠듯했다. 이제 칸 폭(cqi)을 글자 길이로 나눠 채운다.
 *
 * ⚠️ 폭을 **재서** 맞추지 않는다(ResizeObserver). 칸이 flex 라 글자가 줄면 칸도 줄고,
 *    그러면 다시 글자를 키우는 되먹임이 생겨 크기가 튄다(실측: 일부 칸만 맞고 나머지는 잘렸다).
 *    컨테이너 쿼리 단위는 브라우저가 한 번에 풀어 주므로 그 문제가 없다.
 * ⚠️ 세로로 쌓는 배치에서는 끈다 — 거기선 라벨과 금액이 한 줄에 나란히 서므로,
 *    폭을 채우려 들면 글자만 커졌다 작아졌다 해 오히려 어수선해진다.
 */
function FitValue({ text, max, min = 11, active, style }: {
  text: string
  max: number
  min?: number
  active: boolean
  style?: React.CSSProperties
}) {
  const size = active
    ? `clamp(${min}px, ${(100 / textEm(text)).toFixed(2)}cqi, ${max}px)`
    : undefined
  return <span style={{ ...style, display: 'block', fontSize: size, whiteSpace: 'nowrap' }}>{text}</span>
}

export function PriceBar({ calc, total, hasCustomer, subsidy, onSubsidyChange, regions, compact = false, summary = false }: Props) {
  // 화면이 1:1 보다 세로로 길면 옆으로 늘어놓지 않고 **세로로 쌓는다**.
  // 좁은 폭에 6칸을 욱여넣으면 글자를 아무리 줄여도 읽히지 않는다.
  const portrait = useIsPortrait()
  // 좁은 창(위아래 배치)에서는 가격바가 세로 자리를 다 먹으면 안 되므로 한 줄로 둔다.
  // 휴대폰 요약 모드는 펼쳤을 때만 보이므로 읽기 쉬운 세로 배치를 쓴다.
  const stack = summary ? true : compact ? false : portrait
  // 태블릿·휴대폰은 세로가 귀하다 — 가격바를 두껍게 하지 않아 옵션 선택 칸을 넓힌다
  const touch = useIsTouch()
  const [showReg, setShowReg] = useState(false)
  const [showSubsidy, setShowSubsidy] = useState(false)
  // 요약 모드에서 흐름을 펼쳤는가(휴대폰 전용)
  const [openFlow, setOpenFlow] = useState(false)
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
  // 칸 공통 얹기 — 세로배치/두툼하게/좁은창(고정폭) 세 갈래
  const row  = stack ? styles.rowCell : compact ? styles.cellFixed : touch ? null : styles.cellTall
  // 넓은 화면 = 2×2 + 결과줄(B안). 좁은 창·휴대폰은 종전 배치를 그대로 쓴다.
  const wide = !stack && !compact && !summary
  // 가로 배치에서는 칸 사이를 세로선으로만 나눈다(연산자는 라벨 앞에 붙는다)
  const sep  = stack || wide ? null : styles.sep
  // 세로 배치는 칸이 위아래로 서므로 연산자를 줄 사이에 그대로 둔다
  const sign = (op: string) => (stack ? '' : `${op} `)
  const big  = stack ? styles.stackBig : null
  const lbl  = stack ? styles.stackLabel : null

  return (
    <div style={{
      ...(stack || touch ? styles.bar : { ...styles.bar, ...styles.barTall }),
      // 요약 한 줄은 바로 위 「견적 저장」 버튼과 한 덩어리로 읽혀야 한다 — 위 여백을 줄인다
      ...(summary ? styles.barSummary : null),
    }}>
      {isUnsupported && <div style={styles.warnTbd}>{tbd}</div>}

      {wide ? (
        /*
         * 넓은 화면 — 위 2×2 는 **과정**(같은 모양 네 칸), 아래는 **결론**.
         * 과정을 한 줄로 늘어놓으면 결론과 같은 무게로 읽혀, 정작 실구매가가 묻힌다.
         */
        <div style={styles.gridWrap}>
          <div style={styles.grid4}>
            <Tile label="차량 + 특장 (VAT 포함)" text={view ? fmt(view.start) : '—'} />
            <Tile label="구매 혜택" text={ok ? `−${fmt(ok.purchase_benefit)}` : '—'} tone="neg" />
            <Tile
              label="보조금" arrow onClick={() => setShowSubsidy(v => !v)}
              text={!hasCustomer ? '정보 입력 필요' : ok ? `−${fmt(ok.subsidy_total)}` : '—'}
              tone={hasCustomer ? 'neg' : 'muted'}
              popup={showSubsidy && (
                <SubsidyPopup
                  value={subsidy} onChange={onSubsidyChange} regions={regions} ok={ok}
                  onClose={() => setShowSubsidy(false)}
                />
              )}
            />
            <Tile
              label="부가세 환급"
              text={!ok ? '—' : noRefund ? '환급 불가' : `−${fmt(vatRefund)}`}
              tone={noRefund ? 'muted' : 'neg'}
            />
          </div>
          {/*
            아랫줄은 칸을 나누지 않는다 — 한 줄에 결론(왼쪽)과 곁다리(오른쪽)를 놓는다.
            칸을 나누면 별도 비용이 실구매가와 같은 급으로 읽힌다.
          */}
          {/*
            결론 줄 — 윗줄과 **같은 2열 격자**를 쓴다. 그래야 별도 비용 금액이 왼쪽 열의
            다른 금액(차량+특장·보조금)과 같은 자리·같은 크기로 떨어진다.
            높이는 윗줄보다 낮다 — 여기엔 한 줄만 있기 때문이다.
          */}
          <div style={styles.resultRow}>
            <Tile
              rowHeight label="기타" arrow onClick={() => ok && setShowReg(v => !v)}
              text={ok ? fmt(regEtc) : '—'}
              popup={showReg && ok && <RegPopup ok={ok} onClose={() => setShowReg(false)} />}
            />
            <span style={styles.resultRight}>
              <span style={styles.resultMain}>
                <span style={styles.heroLabelWide}>실구매가</span>
                <span style={styles.heroValueWide}>{tbd ? '미정' : ok ? fmt(netPrice) : '—'}</span>
              </span>
              {/* 별도까지 더한 값은 결론 **바로 아래**에 — 같은 숫자 계열이라 붙여 둔다 */}
              {view && <span style={styles.heroSub}>기타 비용 포함 {fmt(view.grandTotal)}</span>}
            </span>
          </div>
        </div>
      ) : (
      <div
        className={summary ? 'scroll-hint' : undefined}
        style={{
          ...(stack ? styles.flowStack : compact ? { ...styles.flow, ...styles.flowScroll } : styles.flow),
          ...(summary ? { ...styles.flowSheet, display: openFlow ? 'flex' : 'none' } : null),
        }}
      >
        {/* ① 차량+특장 (부가세 포함) */}
        <div style={{ ...styles.first, ...row, ...sep }}>
          {/* 좁은 화면에서는 '(VAT 포함)'이 다음 줄로 접힌다 — 잘려 사라지는 것보다 낫다 */}
          <div style={{ ...styles.firstLabel, ...lbl }}>차량 + 특장 (VAT 포함)</div>
          <div style={stack ? styles.stackRight : undefined}>
            <FitValue text={view ? fmt(view.start) : '—'} max={24} active={!stack}
              style={{ ...styles.firstValue, ...big }} />
          </div>
        </div>

        {stack && <Op stack={stack}>−</Op>}
        <Block label={`${sign('−')}구매 혜택`} value={ok ? ok.purchase_benefit : 0} show={!!ok} negative stack={stack} tall={!stack && !touch} compact={compact} sep={sep} />
        {stack && <Op stack={stack}>−</Op>}
        {/* ③ 보조금 — 클릭하면 산정 입력(지역·소상공인·화물운송·경유차)을 그 자리에서 고친다 */}
        <div
          style={{ ...styles.block, ...styles.clickable, ...row, ...sep, ...(stack ? null : styles.blockWide) }}
          onClick={() => setShowSubsidy(v => !v)}
        >
          <div style={{ ...styles.blockLabel, ...lbl }}>{sign('−')}보조금 ▸</div>
          <div style={stack ? styles.stackRight : undefined}>
            <FitValue
              text={!hasCustomer ? '정보 입력 필요' : ok ? fmt(ok.subsidy_total) : '—'}
              max={24} active={!stack}
              style={{ ...styles.blockValue, ...big, ...(hasCustomer ? styles.negVal : styles.mutedVal) }} />
            {/*
              합계만 보면 왜 그 금액인지 알 수 없다 — 네 가지 내역을 항상 같은 순서로 보여준다.
              0원인 항목도 남긴다(빠진 게 아니라 해당 없음이라는 뜻이 드러나야 한다).
            */}

          </div>
          {showSubsidy && (
            <SubsidyPopup
              value={subsidy} onChange={onSubsidyChange} regions={regions} ok={ok}
              sheet={!wide}
              onClose={() => setShowSubsidy(false)}
            />
          )}
        </div>
        {stack && <Op stack={stack}>−</Op>}
        {/* ④ 부가세 환급 — 일반구매자는 환급 대상이 아니다 */}
        <div style={{ ...styles.block, ...row, ...sep }}>
          <div style={{ ...styles.blockLabel, ...lbl }}>{sign('−')}부가세 환급</div>
          <FitValue
            text={!ok ? '—' : noRefund ? '환급 불가' : fmt(vatRefund)}
            max={24} active={!stack}
            style={{ ...styles.blockValue, ...big, ...(noRefund ? styles.mutedVal : styles.negVal) }} />
        </div>

        {stack && !summary && <Op stack={stack}>=</Op>}
        {/* ⑤ 실구매가 — 부가세 환급까지. 등록·기타는 포함하지 않는다 */}
        {/* 휴대폰 요약 모드에서는 아래 고정 줄이 이 자리를 대신한다(같은 숫자를 두 번 두지 않는다) */}
        {!summary && (
          <div style={{ ...styles.hero, ...(stack ? styles.rowCell : compact ? styles.cellFixed : touch ? null : styles.cellTall) }}>
            <div style={{ ...styles.heroLabel, ...lbl }}>실구매가</div>
            <FitValue text={tbd ? '미정' : ok ? fmt(netPrice) : '—'} max={30} min={13} active={!stack}
              style={{ ...styles.heroValue, ...(stack ? styles.stackHero : null) }} />
          </div>
        )}

        {/* ⑥ 등록·기타 — 흐름 밖 별도 표시(클릭 → 상세) */}
        <div
          style={{ ...styles.block, ...styles.clickable, ...(stack ? { ...styles.rowCell, ...styles.asideStack } : compact ? { ...styles.aside, ...styles.cellFixed } : touch ? styles.aside : { ...styles.aside, ...styles.cellTall }) }}
          onClick={() => ok && setShowReg(v => !v)}
        >
          <div style={{ ...styles.blockLabel, ...lbl }}>기타 ▸ <span style={styles.asideNote}>별도</span></div>
          <div style={stack ? styles.stackRight : undefined}>
            <FitValue text={ok ? fmt(regEtc) : '—'} max={24} active={!stack}
              style={{ ...styles.blockValue, ...big }} />
            {view && <div style={{ ...styles.asideSub, ...(stack ? styles.stackSub : null) }}>기타 포함 {fmt(view.grandTotal)}</div>}
          </div>
          {showReg && ok && <RegPopup ok={ok} sheet={!wide} onClose={() => setShowReg(false)} />}
        </div>
      </div>
      )}

      {/*
        휴대폰 — 늘 보이는 것은 실구매가 한 줄. 「내역」을 누르면 위로 펼친다.
        여섯 칸을 다 펼쳐 두면 화면 절반을 먹어 정작 옵션을 고를 자리가 없어진다.
        펼친 내역은 이 줄 위에서 끝나므로 「… − 부가세 환급 = 실구매가」로 이어 읽힌다.
      */}
      {summary && (
        <button style={styles.summaryBar} onClick={() => setOpenFlow(v => !v)}>
          <span style={styles.summaryLabel}>실구매가</span>
          <span style={styles.summaryValue}>{tbd ? '미정' : ok ? fmt(netPrice) : '—'}</span>
          <span style={styles.summaryMore}>내역 {openFlow ? '▾' : '▴'}</span>
        </button>
      )}
    </div>
  )
}

/**
 * 넓은 화면의 금액 칸 — **네 칸이 모두 같은 모양**이다.
 * 칸마다 크기·배경이 다르면 어느 것이 더 중요한지 잘못 읽힌다. 강조는 아래 실구매가에만 둔다.
 */
function Tile({ label, text, tone, arrow, onClick, popup, rowHeight }: {
  label: string
  text: string
  tone?: 'neg' | 'muted'
  /** 눌러서 상세를 여는 칸임을 알리는 ▸ */
  arrow?: boolean
  onClick?: () => void
  popup?: React.ReactNode
  /** 격자 밖에 놓여도 윗줄과 같은 높이를 지킨다 */
  rowHeight?: boolean
}) {
  return (
    <div
      style={{
        ...styles.tile,
        ...(rowHeight ? { height: ROW_H } : null),
        ...(onClick ? styles.clickable : null),
      }}
      onClick={onClick}
    >
      <span style={styles.tileLabel}>{label}{arrow ? ' ▸' : ''}</span>
      <span style={{ ...styles.tileValue, ...(tone === 'neg' ? styles.negVal : tone === 'muted' ? styles.mutedVal : null) }}>{text}</span>
      {popup}
    </div>
  )
}

function Op({ children, stack }: { children: string; stack?: boolean }) {
  return <div style={stack ? styles.opStack : styles.op}>{children}</div>
}

function Block({ label, value, show, muted, negative, stack, tall, compact, sep }: { label: string; value: number; show: boolean; muted?: boolean; negative?: boolean; stack?: boolean; tall?: boolean; compact?: boolean; sep?: React.CSSProperties | null }) {
  return (
    // 좁은 창(가로 스크롤)에서는 칸이 줄어들면 안 된다 — 줄어드는 순간 금액이 잘린다
    <div style={{ ...styles.block, ...(stack ? styles.rowCell : compact ? styles.cellFixed : tall ? styles.cellTall : null), ...sep }}>
      <div style={{ ...styles.blockLabel, ...(stack ? styles.stackLabel : null) }}>{label}</div>
      <FitValue
        text={show ? (muted ? '미반영' : fmt(value)) : '—'}
        max={24} active={!stack}
        style={{ ...styles.blockValue, ...(stack ? styles.stackBig : null), ...(muted ? styles.mutedVal : negative ? styles.negVal : null) }} />
    </div>
  )
}

/**
 * 보조금 산정 입력 팝업 — 등록·기타 상세 팝업과 같은 여닫이 방식.
 * 여기 값이 바뀌면 화면 금액이 즉시 다시 계산된다(견적 저장 전에도).
 */
function SubsidyPopup({ value, onChange, regions, onClose, ok, sheet }: {
  value: SubsidyInputs
  onChange: (v: SubsidyInputs) => void
  regions: string[]
  onClose: () => void
  /** 산정 결과 — 조건을 고치는 자리에서 결과도 바로 보여준다 */
  ok: QuoteResult | null
  /** 좁은 화면 — 칸에 붙이지 않고 화면에 고정해 띄운다(안 그러면 잘린다) */
  sheet?: boolean
}) {
  return (
    <>
      <div style={styles.popOverlay} onClick={e => { e.stopPropagation(); onClose() }} />
      {/* 입력칸이라 클릭이 블록 토글로 새어 나가면 안 된다 */}
      <div
        className="scroll-hint"
        style={{ ...styles.popup, ...styles.popupLeft, ...(sheet ? styles.popupSheet : null) }}
        onClick={e => e.stopPropagation()}
      >
        <div style={styles.popTitle}>보조금 산정 조건</div>
        <SubsidyForm value={value} onChange={onChange} regions={regions} compact hideRequired dense={sheet} />
        {/*
          내역은 여기에 둔다 — 화면 칸에 네 줄로 박아 두면 그 칸만 키가 커지고 글자도 작아
          읽히지 않았다. 조건을 고치는 자리에서 결과를 함께 보는 편이 자연스럽다.
        */}
        {ok && (
          <div style={{ marginTop: 10 }}>
            <div style={styles.popTitle}>산정 결과</div>
            <Line k="국고보조금" v={fmt(ok.subsidy_national)} />
            <Line k="지방보조금" v={fmt(ok.subsidy_local)} />
            <Line k="소상공인" v={fmt(ok.subsidy_sosang)} />
            <Line k="화물운송" v={fmt(ok.subsidy_takbae)} />
            <Line k="보조금 합계" v={fmt(ok.subsidy_total)} bold />
          </div>
        )}
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
function RegPopup({ ok, onClose, sheet }: { ok: QuoteResult; onClose: () => void; sheet?: boolean }) {
  return (
    <>
      <div style={styles.popOverlay} onClick={e => { e.stopPropagation(); onClose() }} />
      <div className="scroll-hint" style={{ ...styles.popup, ...(sheet ? styles.popupSheet : null) }} onClick={e => e.stopPropagation()}>
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
        {/* 탁송료는 여기 없다 — 차량+특장 금액에 녹아 있다(부가세 계산이 그렇게 잡힌다) */}
        <Line k="기타 비용 합계" v={fmt(priceBarView(ok).regEtc)} bold />
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

/** 좁은 창에서 칸이 찌그러지지 않게 지키는 최소 폭 — 이보다 좁아지면 금액이 잘린다 */
const CELL_MIN = 132

/** 넓은 화면 가격바의 한 줄 높이 — 위 2줄 합이 아래 실구매가 줄과 같아진다 */
const ROW_H = 34


const cellBase = {
  // 금액 글자가 이 칸 폭(cqi)에 맞춰 커지고 작아진다 — FitValue 참고
  containerType: 'inline-size' as const,
  // 칸마다 내용 높이가 달라도(보조금만 내역 2줄) 빈자리가 위아래로 고르게 나뉜다
  display: 'flex' as const,
  flexDirection: 'column' as const,
  justifyContent: 'center' as const,
  /*
   * 칸마다 회색 배경을 깔면 덩어리 여섯 개가 같은 무게로 보여, 정작 결과인 실구매가가
   * 묻힌다. 배경을 걷고 **얇은 세로선**으로만 나눈다 — 강조는 실구매가 한 칸에만 남긴다.
   */
  background: 'transparent', borderRadius: 0,
  // ⚠️ padding 축약형을 쓰면 안 된다 — 아래 cellTall 이 위아래 여백만 덮어쓰는데,
  //    한 요소에서 축약형과 개별속성이 섞이면 React 가 렌더마다 경고를 뱉는다.
  paddingTop: fit(6, 0.47, 9), paddingBottom: fit(6, 0.47, 9),
  paddingLeft: fit(8, 0.68, 13), paddingRight: fit(8, 0.68, 13),
  flex: 1, minWidth: 0,
}

const styles: Record<string, React.CSSProperties> = {
  // 가격바는 칸(카드)들이 스스로 영역을 말한다 — 위쪽 구분선을 두면 화면이 토막나 보인다
  // 아래 여백을 줄여 내용을 전체적으로 내린다(가격바는 화면 맨 아래라 아래쪽 여백이 덜 필요하다)
  bar: { flexShrink: 0, background: 'var(--bg)', padding: 'var(--sp-4) var(--sp-4) var(--sp-2)' },
  /** 요약 한 줄 — 위 버튼과 붙여 둔다(둘 사이가 벌어지면 다른 화면처럼 읽힌다) */
  barSummary: { padding: 'var(--sp-2) var(--sp-4) var(--sp-2)' },
  /*
   * 예전엔 칸을 두툼하게(위아래 20~30px) 만들어 바를 채웠다. 그런데 보조금 내역이 붙으면서
   * 바가 이미 충분히 높아졌고, 그 여백은 **아래쪽 빈 공간**으로만 남았다.
   * 이제 여백은 한 벌(cellBase)만 쓰고, 칸 안에서는 내용을 세로 가운데로 모은다.
   */
  barTall: { padding: 'var(--sp-4)' },
  cellTall: {},
  warn: { background: 'var(--warnbg)', border: '1px solid #f0c9ad', color: 'var(--warn)', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10 },
  warnTbd: { background: '#f5f5f5', border: '1px solid #ddd', color: '#555', fontSize: 11.5, padding: '7px 10px', borderRadius: 8, marginBottom: 10, fontWeight: 600 },
  flow: { display: 'flex', gap: fit(3, 0.31, 6), alignItems: 'stretch', width: '100%' },
  /*
   * 좁은 창 — 칸을 줄이지 않고 옆으로 민다. 금액을 잘라 「₩1,…」 로 보여 주느니
   * 손가락으로 밀어 보게 하는 편이 낫다(잘린 금액은 정보가 아니라 오해를 만든다).
   */
  /** 휴대폰에서 늘 보이는 한 줄 — 이것만으로 상담이 굴러가야 한다 */
  summaryBar: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', width: '100%',
    // 화면에서 가장 중요한 한 줄 — 입력칸보다 한 단 크게 둔다
    minHeight: 'calc(var(--h-control) + 8px)', padding: '0 var(--sp-4)',
    background: 'var(--dark)', color: '#fff', border: 'none', borderRadius: 'var(--r-md)',
  },
  summaryLabel: { fontSize: 'var(--fs-body)', color: 'var(--lime)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], whiteSpace: 'nowrap' as const },
  summaryValue: { flex: 1, textAlign: 'right' as const, fontSize: 20, fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'], whiteSpace: 'nowrap' as const },
  summaryMore: { fontSize: 'var(--fs-caption)', color: '#c9ccd2', whiteSpace: 'nowrap' as const },
  /** 펼친 내역 — 화면을 다 덮지 않게 높이를 묶고 안에서 스크롤한다 */
  flowSheet: { maxHeight: '46vh', overflowY: 'auto' as const, marginBottom: 'var(--sp-2)' },
  flowScroll: {
    overflowX: 'auto' as const,
    scrollbarWidth: 'none' as const,
  },
  /** 가로 스크롤일 때 칸은 줄어들지 않는다(줄어들면 잘린다) */
  cellFixed: { flex: `0 0 ${CELL_MIN}px` as const, minWidth: CELL_MIN },
  op: { fontSize: fit(11, 0.83, 16), color: 'var(--muted)', fontWeight: 700, flexShrink: 0, alignSelf: 'center' },
  // EV& 브랜드 컬러(--lime #C8D200) 계열 — 어두운 초록은 브랜드와 어긋난다
  // 테두리 없이 배경색만으로 구분한다 — 선을 두르면 칸마다 굵기가 달라 보여 지저분했다
  first: { ...cellBase, flex: 1.3 },
  // 잘라서 없애기보다 접히게 둔다 — '(VAT 포함)'이 사라지면 무슨 금액인지 알 수 없다
  firstLabel: { fontSize: fit(11, 0.73, 14), color: 'var(--muted)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'], overflow: 'hidden' },
  firstValue: { fontSize: fit(11, 0.88, 17), fontWeight: 700, color: 'var(--dark)', marginTop: 2, ...noSpill },
  // 차량·특장 분해는 금액이 길어 좁은 화면에서 한 줄에 안 들어간다.
  // 숫자를 잘라 버리면 안 되므로 이 줄만 두 줄로 접히게 둔다(블록 밖으로는 못 나감).
  /*
   * 보조금 내역 4줄 — **높이를 못 박는다**.
   * 값이 길어 줄바꿈되면(좁은 칸에서 「소상공인 ₩3,450,000」) 이 칸만 키가 커지고,
   * 가로 배치는 가장 큰 칸에 맞춰 늘어나 가격바 전체가 들썩였다.
   * 각 줄은 nowrap + 칸 폭에 맞춘 글자 크기라 4줄에서 벗어나지 않는다.
   */
  block: { ...cellBase, position: 'relative' },
  /** 보조금 칸 — 안에 내역 4항목이 들어가 다른 칸보다 조금 넓어야 한다 */
  blockWide: { flex: 1.5 },
  /** 칸 사이 얇은 세로선 — 배경 대신 이것으로만 나눈다(가로 배치 전용) */
  sep: { borderRight: 'var(--hairline)' },

  // ── 넓은 화면(B안): 위 2×2 = 과정, 아래 = 결론 ──────────────────────────
  // 줄 사이 간격은 두지 않는다 — 윗줄끼리(차량+특장 ↔ 보조금)와 같은 간격으로 결론 줄이 이어진다
  gridWrap: { display: 'flex', flexDirection: 'column' as const, width: '100%' },
  /*
   * 칸은 **선으로만 나눈다**(배경을 채우지 않는다). 채우면 덩어리가 여러 개로 보여
   * 정작 결론인 실구매가가 묻힌다 — 배경을 갖는 것은 실구매가 하나뿐이다.
   * 위 두 줄(2×2)의 높이 합 = 아래 한 줄 높이. 그래서 좌우가 나란히 떨어진다.
   */
  grid4: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gridTemplateRows: `${ROW_H}px ${ROW_H}px`,
  },
  /** 아랫줄 — 한 칸짜리 긴 줄. 왼쪽이 결론, 오른쪽이 곁다리 */
  /** 결론 줄 — 윗줄과 같은 2열, 다만 한 줄뿐이라 높이는 낮다 */
  /*
   * 결론 줄 — 왼쪽(기타)은 윗줄들과 같은 34px 리듬을 그대로 잇고,
   * 오른쪽(실구매가)만 조금 내려 부가세 환급 줄과 사이를 벌린다. 결론이 과정에 붙어 있으면
   * 다섯 번째 항목처럼 읽힌다.
   */
  resultRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', alignItems: 'start',
    minHeight: ROW_H,
  },
  resultRight: {
    paddingRight: 14,
    // 부가세 환급 줄과 사이를 조금 벌린다(왼쪽 '기타' 줄은 그대로 34px 리듬)
    paddingTop: 10,
    display: 'flex', flexDirection: 'column' as const, alignItems: 'flex-end',
    gap: 1, textAlign: 'right' as const,
  },
  resultMain: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-3)' },
  /** 별도 비용 — 결론 옆 곁다리라 라벨·금액 모두 작게 */
  asideInline: { position: 'relative' as const, display: 'inline-flex', alignItems: 'baseline', gap: 'var(--sp-2)' },
  asideInlineValue: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--body)', whiteSpace: 'nowrap' as const },
  // 칸을 나누는 선은 두지 않는다 — 자리(격자)만으로 충분히 나뉘어 읽힌다
  tile: {
    position: 'relative' as const,
    minWidth: 0,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)',
    padding: '0 14px',
  },
  tileLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
  tileValue: {
    fontSize: 16, fontWeight: 700, color: 'var(--dark)',
    whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  /** 결론 — 유일하게 검은 카드이고 숫자가 가장 크다 */
  /** 결론 — 배경 없이 **글자 크기와 색**으로만 강조한다(칸을 채우면 다시 상자가 된다) */
  // 결론 라벨은 다른 칸 라벨보다 한 단계 크게 — 숫자를 줄인 만큼 라벨이 줄을 잡아 준다
  heroLabelWide: {
    fontSize: 'var(--fs-section)', fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    color: 'var(--dark)', whiteSpace: 'nowrap' as const,
  },
  /*
   * 결론 금액 — 배경 없이 **크기와 색**으로만 강조한다. 색은 브랜드 라임 그대로.
   * 브랜드 라임(#C8D200)을 한 톤 내린 값 — 흰 배경에서 원색은 너무 밝아 흐려 보인다.
   * ⚠️ 그래도 대비는 낮은 편이라(약 2.3:1) **큰 글씨 전용**이다. 본문 크기로 쓰지 말 것.
   */
  heroValueWide: {
    fontSize: 22, fontWeight: 700, color: '#AEB800',
    letterSpacing: '-0.01em', whiteSpace: 'nowrap' as const,
  },
  heroSub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', whiteSpace: 'nowrap' as const },
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
  // 유일하게 배경을 갖는 칸 — 상담의 결론이라 여기만 강조한다
  hero: {
    ...cellBase, flex: 1.4, background: 'var(--dark)', borderRadius: 'var(--r-md)',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
    paddingLeft: fit(10, 0.83, 16), paddingRight: fit(10, 0.83, 16),
  },
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
  /*
   * 바깥을 눌러 닫기 위한 **투명한** 판.
   *
   * ⚠️ 색을 칠하지 않는다. 가격바 팝업은 화면을 붙잡는 모달이 아니라 그 자리에서 값을
   *    고치는 창이다 — 뒤를 어둡게 하면 화면 전체가 회색이 되고, 무엇보다 이 판의
   *    z-index(59)가 팝업(41)보다 높아 **팝업 위를 덮어 입력이 막혔다**(실제 사고).
   *    팝업보다 아래에 두고 색을 지운다.
   */
  popOverlay: { position: 'fixed', inset: 0, zIndex: 40, background: 'transparent' },
  // 가격바가 화면 맨 아래라 팝업은 위로 열린다. 내용이 길면 화면 위로 넘쳐 잘리므로
  // 높이를 화면에 맞춰 자르고 안에서 스크롤한다(태블릿에서 위가 잘리던 문제).
  // 흰 바탕은 .scroll-hint(globals.css)가 준다 — 여기서 background 를 쓰면 인라인이
  // 클래스를 덮어 「더 있다」 그림자가 사라진다(실제로 한 번 덮여 있었다)
  // 높이 한도 560 = 보조금 팝업이 산정 결과까지 **스크롤 없이** 들어가는 높이(실측 535).
  // 여기서 아끼면 화면이 넉넉한데도 결과가 잘려 스크롤해야 한다.
  popup: { position: 'absolute', bottom: 'calc(100% + 8px)', right: 0, zIndex: 41, width: 260, maxHeight: 'min(70vh, 560px)', overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 8px 30px rgba(0,0,0,.18)', padding: 12 },
  popTitle: { fontSize: 12, fontWeight: 700, color: 'var(--dark)', marginBottom: 6, paddingBottom: 4, borderBottom: '1px solid var(--line)' },
  // 보조금 블록은 가격바 왼쪽에 있어 오른쪽 정렬(popup)로 열면 화면 밖으로 나간다.
  // 폭 364 = 가장 긴 줄(「화물자동차 운송사업허가증 · 개인사업자 국고 10% 추가」)이
  // 체크박스까지 포함해 344px 필요 + 여유. 좁으면 이 줄이 두 줄로 접혀 지저분했다.
  popupLeft: { right: 'auto' as const, left: 0, width: 364 },
  /*
   * 좁은 화면 — 팝업을 칸 안에 붙이면 **스크롤 영역에 갇혀 잘린다**(휴대폰 제보 사진).
   * 화면 기준으로 띄우고 폭·높이를 화면에 맞춘다. 글자도 한 단계 줄여 한 화면에 담는다.
   */
  popupSheet: {
    position: 'fixed' as const,
    left: 'var(--sp-3)', right: 'var(--sp-3)', bottom: 'var(--sp-3)', top: 'auto' as const,
    width: 'auto' as const, maxHeight: '78vh',
    fontSize: 13,
    zIndex: 60,
    // 이 안의 입력칸은 한 단계 낮게 — 변수 하나로 select·input·예/아니오가 함께 맞춰진다
    ['--h-control' as string]: '40px',
  } as React.CSSProperties,
  popFoot: { fontSize: 10.5, color: 'var(--muted)', marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--line)' },
  line: { display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--body)', padding: '2px 0' },
  lineBold: { fontWeight: 700, color: 'var(--dark)', borderTop: '1px solid var(--line)', marginTop: 3, paddingTop: 4 },
  lineNote: { color: 'var(--muted)' },
}
