import { useLayoutEffect, useRef, useState } from 'react'
import type { ApiOrderOption } from '@shared/types/index'
import { toDateInput } from '@shared/schedule/businessDays'
import { DELIVERY_DUE_BUSINESS_DAYS } from '@shared/schedule/businessDays'

/**
 * 발주서 — **특장사가 보는 유일한 서류.**
 *
 * 계약서·견적서에는 고객 개인정보와 판매가가 들어 있어 특장사에게 가지 않는다(서버에서 막았다).
 * 특장사가 알아야 하는 것은 「누가 무엇을 언제까지 만들어 달라고 했는가」뿐이고, 그게 발주서다.
 *
 * ⚠️ **품목·수량·단가 칸은 두지 않는다.** 발주 품목은 견적 옵션과 1:1이 아니라 변환
 *    규칙과 특장사별 단가표가 필요하다(docs/process-redesign.md §4-3). 빈 칸을 띄워
 *    두면 「곧 채워지나」 하고 기다리게 되므로 아예 뺐다 — 표가 확정되면 그때 넣는다.
 *    지금 발주 내용은 **사양**이고, 이 주문만의 요청은 **비고**다.
 */
export function PurchaseOrderSheet({
  orderId, orderedAt, makerOrgName, modelCode, options, deliveryDue, remark, editable,
}: {
  orderId: number
  /** 발주일 = 배정일 */
  orderedAt: Date
  makerOrgName: string
  modelCode: string
  options: ApiOrderOption[]
  /** 고른 납기일 — 아직이면 '' */
  deliveryDue: string
  /** 이 주문만의 요청사항. 없으면 「특별 요청사항 없음」 */
  remark?: string
  /** 비고를 **적는** 자리(배정 팝업)면 입력칸을 여기 끼운다 */
  editable?: React.ReactNode
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  /**
   * 내용이 A4 한 장보다 길 때 **줄여서 담는 배율**.
   *
   * 예전에는 `overflow: hidden` 으로 넘치는 만큼을 잘랐다. 그러면 특이사항 3·4 항이
   * 소리 없이 사라진다 — 읽는 사람은 **없는 줄 안다**(사진 제보). 서류에서 이건 사고다.
   * 종이에 맞춰 인쇄할 때처럼, 잘라 내지 말고 글씨를 조금 줄여 한 장에 담는다.
   */
  const [fit, setFit] = useState(1)

  /**
   * **A4 비율은 줄여서 맞추지, 늘려서 맞추지 않는다.**
   *
   * `aspect-ratio` 만 걸어 봤더니 PC(504px 폭)에서는 정확히 A4였는데 휴대폰(347px 폭)에서는
   * 0.516 까지 찌그러졌다. 폭이 좁으면 글이 더 접혀 내용이 길어지고, `aspect-ratio` 는
   * **선호 크기일 뿐**이라 내용이 길면 상자가 그냥 늘어나기 때문이다.
   *
   * 그래서 서류는 늘 `BASE_W` 폭으로 조판하고, 남는 폭에 맞춰 **통째로 축소**한다.
   * 실제 종이를 멀리서 보는 것과 같아서, 화면이 좁아져도 비율도 줄바꿈도 그대로다.
   *
   * `zoom` 이 아니라 `transform` 인 이유: iOS 는 입력칸의 **지정된** 글씨 크기로 초점 확대
   * 여부를 판단한다. `transform` 은 지정값을 건드리지 않으므로 16px 규칙이 그대로 살아 있다.
   */
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setScale(el.clientWidth / BASE_W)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /*
   * 내용이 한 장에 들어가는지 재고, 넘치면 그만큼 줄인다.
   *
   * ⚠️ `scrollHeight` 는 **transform 의 영향을 받지 않는다** — 줄여 놓아도 늘 「원래 크기의
   *    내용 높이」가 나온다. 그래서 잰 값으로 배율을 바꿔도 다음 측정이 흔들리지 않는다.
   *
   *    처음엔 이걸 모르고 `scrollHeight / fit` 로 되돌려 읽었는데, 그러면 배율을 바꿀 때마다
   *    측정값이 조금씩 달라져 **끝없이 다시 그렸다**(Maximum update depth exceeded).
   *    자를 대는 값과 손대는 값이 서로 물리면 안 된다.
   */
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    const measure = () => {
      const natural = el.scrollHeight
      const room = BASE_H - PAGE_PAD * 2
      setFit(natural > room ? room / natural : 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={wrapRef} style={s.frame}>
      <div style={{ ...s.sheet, transform: `scale(${scale})` }}>
      <div ref={contentRef} style={{ ...s.content, transform: `scale(${fit})` }}>
      <div style={s.title}>발 주 서</div>

      <div style={s.metaRow}>
        <Meta label="문서번호" value={`주문 #${orderId}`} />
        <Meta label="발주일" value={toDateInput(orderedAt)} />
      </div>
      <div style={s.metaRow}>
        <Meta label="발주사" value="EV&Solution" />
        <Meta label="공급사" value={makerOrgName} />
      </div>

      <div style={s.section}>사양</div>
      <table style={s.table}>
        <tbody>
          <tr>
            <td style={s.tdLabel}>차종</td>
            <td style={s.tdValue}>{modelCode}</td>
          </tr>
          {options.map(o => (
            <tr key={o.group_code}>
              <td style={s.tdLabel}>{o.group_name}</td>
              <td style={s.tdValue}>{o.value_name}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/*
        비고 — **이 주문만의 요청사항.** 관리자가 배정할 때 적고, 특장사는 수락 전에 읽는다.
        줄바꿈·띄어쓰기를 적은 그대로 보여준다(`pre-wrap`) — 「윗줄은 A, 아랫줄은 B」처럼
        줄로 뜻을 나눈 글이 한 줄로 붙으면 다른 말이 된다.
        쓰는 자리(배정 팝업)에서 4줄로 잘라 두므로 여기서 양식이 깨질 일은 없다.
      */}
      <div style={s.section}>비고</div>
      {editable
        ? editable
        : remark?.trim()
          ? <div style={s.remark}>{remark}</div>
          : <div style={s.remarkEmpty}>특별 요청사항 없음</div>}

      <div style={s.section}>특이사항</div>
      <ol style={s.notes}>
        <li>본 발주서는 공급사의 견적서 수령 이후 발주사·공급사 간 기 협의한 사항에 따릅니다.</li>
        <li>
          납기일자: 발주일로부터 {DELIVERY_DUE_BUSINESS_DAYS}일 이내 (영업일 기준)
          {deliveryDue && <b style={s.due}> — {deliveryDue} 로 지정</b>}
        </li>
        <li>납품장소 및 검사방법: 당사 지정 장소 및 당사 검사기준에 의함. 사전 협의하여 진행함.</li>
        <li>기타: 상기 사항 외에 발주사·공급사 간 협의에 따라 진행함.</li>
      </ol>
      </div>
      </div>
    </div>
  )
}

/**
 * 서류를 조판하는 기준 폭(px). 화면 폭이 아니라 **늘 이 폭으로 그린 뒤 축소**한다.
 *
 * 560px 을 고른 이유: 실측해 보니 내용 높이가 A4 높이(792px)에 여유 있게 들어간다.
 * 더 좁게 잡으면 글이 접혀 내용이 A4 아래로 넘치고, 넘친 만큼은 잘려 보이지 않게 된다.
 */
const BASE_W = 560
/** A4 는 210 × 297 mm. 기준 폭에 대응하는 높이. */
const BASE_H = Math.round(BASE_W * 297 / 210)
/** 종이의 안쪽 여백(px) — `s.sheet` 의 padding 과 같은 값이어야 담기는 높이를 옳게 잰다. */
const PAGE_PAD = 16

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.meta}>
      <span style={s.metaLabel}>{label}</span>
      <span style={s.metaValue}>{value}</span>
    </div>
  )
}

/*
 * 발주서 안의 글씨는 **한 값으로 묶는다**(`--fs-sheet`).
 * 값칸·표·비고·특이사항이 제각각 다른 크기였고, 거기에 비고 **입력칸**만 또 다른 크기라
 * 특장사가 받아 보는 발주서와 이질감이 컸다(사진 제보).
 * 입력칸도 이 값을 물려받아 **적을 때와 읽을 때가 같은 글씨**가 된다.
 */
const s: Record<string, React.CSSProperties> = {
  // 서류처럼 보이게 — 화면 요소가 아니라 '받은 문서'로 읽혀야 한다
  /**
   * 발주서 — **A4 비율(210:297)을 지킨다.**
   *
   * 크기는 화면에 맞춰 줄었다 늘었다 해도 되지만, 비율이 달라지면 실제로 출력했을 때와
   * 다른 문서가 된다. 특장사가 받아 보는 것과 화면에서 보는 것이 같아야 한다.
   *
   * ⚠️ `aspect-ratio` 는 **선호 크기**다 — 내용이 그보다 길면 상자가 늘어난다.
   *    고정 높이로 두면 넘치는 글이 잘려 없는 것처럼 보인다. 비율은 지키되 잘리지는 않는다.
   */
  /**
   * 자리만 잡는 바깥틀 — **A4 비율의 빈 상자.** 폭은 화면에 맞춰 늘었다 줄었다 하고,
   * 높이는 `aspect-ratio` 가 따라온다. 실제 서류는 이 안에서 축소돼 얹힌다.
   */
  frame: {
    /*
     * 폭은 자리에 맞춰 줄지만 **기준 폭보다 커지지는 않는다.**
     *
     * 좁으면 축소해 담는 것이 목적이었는데, 넓은 자리(서류 탭)에 두니 1 배를 넘겨
     * 확대돼 화면을 가득 채웠다(제보 — 「서류탭에서 발주서가 너무 큼」).
     * 서류는 실물 크기가 있다 — 자리가 남는다고 키울 이유가 없다.
     */
    width: '100%', maxWidth: BASE_W,
    aspectRatio: '210 / 297', position: 'relative', overflow: 'hidden',
    // ⚠️ 세로 flex 안에 놓이면 남는 높이에 맞춰 **눌린다** — 실측 0.956(A4 는 0.707).
    //    비율은 서류의 정체성이라 남는 자리에 맞춰 양보하지 않는다. 넘치면 부모가 스크롤한다.
    flexShrink: 0,
  },
  /**
   * 서류 본체 — 늘 `BASE_W × BASE_H` 로 그리고 바깥틀에 맞게 축소된다.
   * 크기를 고정해야 축소 배율 하나로 비율이 정확히 보존된다.
   */
  sheet: {
    position: 'absolute', top: 0, left: 0,
    width: BASE_W, height: BASE_H, transformOrigin: 'top left',
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
    padding: PAGE_PAD, boxSizing: 'border-box',
  },
  /**
   * 종이 안의 내용 — 한 장을 넘치면 **줄여서 담는다.**
   *
   * 가운데를 기준으로 줄여 좌우 여백이 고르게 남는다. 위에서부터 줄이면 아래쪽에만
   * 빈자리가 몰려 「덜 그려졌나」로 읽힌다.
   */
  content: { transformOrigin: 'top center', width: '100%' },
  title: {
    textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--dark)',
    letterSpacing: '.3em', paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--line)',
  },
  metaRow: { display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' },
  meta: { flex: '1 1 160px', minWidth: 0, display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' },
  metaLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 52, flexShrink: 0 },
  metaValue: { fontSize: 'var(--fs-sheet)', color: 'var(--dark)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  section: {
    fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)',
    marginTop: 'var(--sp-4)', paddingBottom: 'var(--sp-1)', borderBottom: 'var(--hairline)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-sheet)', marginTop: 'var(--sp-2)' },
  tdLabel: { padding: '5px 12px 5px 0', color: 'var(--muted)', width: 96, whiteSpace: 'nowrap', verticalAlign: 'top' },
  tdValue: { padding: '5px 0', color: 'var(--dark)' },
  /** 비고 본문 — 적은 그대로(줄바꿈·띄어쓰기 보존) */
  remark: {
    whiteSpace: 'pre-wrap' as const, fontSize: 'var(--fs-sheet)', lineHeight: 1.6,
    color: 'var(--dark)', padding: 'var(--sp-2) 0',
  },
  remarkEmpty: { fontSize: 'var(--fs-sheet)', color: 'var(--muted)', padding: 'var(--sp-2) 0' },
  pending: {
    marginTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    background: 'var(--card)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)', lineHeight: 'var(--lh-body)',
  },
  notes: {
    margin: 'var(--sp-2) 0 0', paddingLeft: 18,
    fontSize: 'var(--fs-sheet)', color: 'var(--body)', lineHeight: 'var(--lh-body)',
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  due: { color: 'var(--dark)' },
}
