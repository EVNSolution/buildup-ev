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
  return (
    <div style={s.sheet}>
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
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.meta}>
      <span style={s.metaLabel}>{label}</span>
      <span style={s.metaValue}>{value}</span>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  // 서류처럼 보이게 — 화면 요소가 아니라 '받은 문서'로 읽혀야 한다
  sheet: {
    border: 'var(--hairline)', borderRadius: 'var(--r-sm)', background: '#fff',
    padding: 'var(--sp-4)',
  },
  title: {
    textAlign: 'center', fontSize: 15, fontWeight: 700, color: 'var(--dark)',
    letterSpacing: '.3em', paddingBottom: 'var(--sp-3)', borderBottom: '1px solid var(--line)',
  },
  metaRow: { display: 'flex', gap: 'var(--sp-4)', flexWrap: 'wrap', marginTop: 'var(--sp-3)' },
  meta: { flex: '1 1 160px', minWidth: 0, display: 'flex', gap: 'var(--sp-2)', alignItems: 'baseline' },
  metaLabel: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 52, flexShrink: 0 },
  metaValue: { fontSize: 'var(--fs-label)', color: 'var(--dark)', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
  section: {
    fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--muted)',
    marginTop: 'var(--sp-4)', paddingBottom: 'var(--sp-1)', borderBottom: 'var(--hairline)',
  },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-label)', marginTop: 'var(--sp-2)' },
  tdLabel: { padding: '5px 12px 5px 0', color: 'var(--muted)', width: 96, whiteSpace: 'nowrap', verticalAlign: 'top' },
  tdValue: { padding: '5px 0', color: 'var(--dark)' },
  /** 비고 본문 — 적은 그대로(줄바꿈·띄어쓰기 보존) */
  remark: {
    whiteSpace: 'pre-wrap' as const, fontSize: 'var(--fs-caption)', lineHeight: 1.6,
    color: 'var(--dark)', padding: 'var(--sp-2) 0',
  },
  remarkEmpty: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', padding: 'var(--sp-2) 0' },
  pending: {
    marginTop: 'var(--sp-2)', fontSize: 'var(--fs-caption)', color: 'var(--muted)',
    background: 'var(--card)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)', lineHeight: 'var(--lh-body)',
  },
  notes: {
    margin: 'var(--sp-2) 0 0', paddingLeft: 18,
    fontSize: 'var(--fs-caption)', color: 'var(--body)', lineHeight: 'var(--lh-body)',
    display: 'flex', flexDirection: 'column', gap: 3,
  },
  due: { color: 'var(--dark)' },
}
