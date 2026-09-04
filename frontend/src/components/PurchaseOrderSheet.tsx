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
  const [scale, setScale] = useState(1)

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
    const fit = () => setScale(el.clientWidth / BASE_W)
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={wrapRef} style={s.frame}>
      <div style={{ ...s.sheet, transform: `scale(${scale})` }}>
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
    width: '100%', aspectRatio: '210 / 297', position: 'relative', overflow: 'hidden',
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
    padding: 'var(--sp-4)', boxSizing: 'border-box',
  },
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
