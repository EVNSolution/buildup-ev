import { BTN } from '../styles/buttons'

/**
 * 「받을 것」 목록 — **영업의 배정 문의**와 **특장사의 주문**이 같은 화면을 쓴다.
 *
 * 두 자리는 하는 일이 똑같다: 누가 나에게 넘긴 건이 있고, 내용을 보고, 받겠다고 누른다.
 * 화면을 따로 만들면 한쪽만 낡는다(특장사 쪽은 실제로 `window.confirm` 한 줄이었다).
 *
 * **내용을 보지 않고 수락하게 두지 않는다.** 받는 순간 담당이 되는데 무엇을 받는지
 * 모르면 수락이 형식이 된다 — 그래서 「내용 보기」가 수락과 나란히 있고, 상세를 연
 * 자리에서도 바로 수락할 수 있다.
 *
 * 칸을 채우지 않는다(디자인 시스템) — 줄로만 나누고, 강조는 왼쪽 라임 띠로 준다.
 * 이 목록은 「아직 아무도 붙지 않은 건」이라 목록에서 즉시 눈에 띄어야 한다.
 */
export interface InboxItem {
  /** 수락 대상 id — 영업은 견적 id, 특장사는 주문 id */
  id: number
  /** 첫 줄 왼쪽 — 번호 */
  no: string
  /** 첫 줄 — 고객명 등 */
  title: string
  /** 둘째 줄 — 차종·금액 등 */
  sub: string
  /** 오른쪽 끝 작은 글씨 — 접수일 등 */
  meta?: string
  /**
   * 너무 오래 방치된 건. **맨 위로 올리고 빨갛게 칠한다.**
   * 라임(할 일)과 빨강(늦었다)은 뜻이 다르다 — 늦은 것이 라임에 섞여 있으면
   * 목록을 다 훑어야 어느 게 급한지 알 수 있다.
   */
  urgent?: boolean
  /** 늦은 이유 — 「발주 후 9일째」처럼 숫자로 말한다 */
  urgentNote?: string
}

export function InboxPanel({ title, items, acceptLabel, busyId, onView, onAccept }: {
  title: string
  items: InboxItem[]
  /** 「주문 수락」처럼 무엇을 받는지 드러내는 말로 — 그냥 「수락」이면 무엇을 받는지 모른다 */
  acceptLabel: string
  busyId: number | null
  /** 내용을 따로 여는 길. 수락 팝업 안에서 내용을 다 보여주는 화면은 넘기지 않는다 */
  onView?: (id: number) => void
  onAccept: (id: number) => void
}) {
  if (items.length === 0) return null
  // 늦은 것부터 — 목록을 훑지 않아도 급한 게 맨 위에 있다
  const sorted = [...items].sort((a, b) => Number(!!b.urgent) - Number(!!a.urgent))
  return (
    <section style={s.wrap}>
      <div style={s.h}>
        {title} <span style={s.count}>{items.length}</span>
      </div>
      {sorted.map(it => (
        <div key={it.id} style={it.urgent ? s.rowUrgent : s.row}>
          <div style={s.info}>
            <div style={s.line1}>
              <span style={s.no}>{it.no}</span>
              <span style={s.title}>{it.title}</span>
              {it.urgentNote && <span style={s.urgentNote}>{it.urgentNote}</span>}
              {it.meta && <span style={s.meta}>{it.meta}</span>}
            </div>
            <div style={s.sub}>{it.sub}</div>
          </div>
          <div style={s.actions}>
            {onView && <button style={BTN.row} onClick={() => onView(it.id)}>상세 보기</button>}
            <button
              style={busyId === it.id ? BTN.rowDisabled : BTN.rowPrimary}
              disabled={busyId === it.id}
              onClick={() => onAccept(it.id)}
            >
              {busyId === it.id ? '처리 중' : acceptLabel}
            </button>
          </div>
        </div>
      ))}
    </section>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: { marginBottom: 'var(--sp-5)' },
  h: {
    fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--dark)',
    letterSpacing: 'var(--ls-tight)', paddingBottom: 'var(--sp-2)', borderBottom: 'var(--hairline)',
  },
  count: { fontSize: 'var(--fs-label)', fontWeight: 400, color: 'var(--muted)', marginLeft: 'var(--sp-1)' },
  /*
   * 한 건 — 왼쪽에 라임 띠. 배경까지 칠하면 목록 전체가 색 덩어리가 된다(칸을 채우지 않는다).
   * 좁은 화면에서는 내용과 버튼이 두 줄로 나뉜다.
   */
  row: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 'var(--sp-3)', flexWrap: 'wrap',
    padding: 'var(--sp-3) 0 var(--sp-3) var(--sp-3)',
    borderBottom: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--lime)',
  },
  // 늦은 건 — 띠와 글씨를 빨강으로. 배경까지 칠하지 않는다(목록이 색 덩어리가 된다)
  rowUrgent: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 'var(--sp-3)', flexWrap: 'wrap',
    padding: 'var(--sp-3) 0 var(--sp-3) var(--sp-3)',
    borderBottom: 'var(--hairline)', boxShadow: 'inset 3px 0 0 0 var(--req)',
  },
  urgentNote: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700 },
  info: { flex: '1 1 240px', minWidth: 0 },
  line1: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  no: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  title: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  meta: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  sub: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 2 },
  actions: { display: 'flex', gap: 'var(--sp-2)', flexShrink: 0 },
}
