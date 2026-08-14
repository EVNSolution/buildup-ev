import type { ApiOrder } from '@shared/types/index'
import { STEPS } from '@shared/process/steps'

/**
 * 주문 여러 건을 한눈에 — **옛 6단계 칸반을 대신한다.**
 *
 * 칸반은 진행이 한 줄일 때만 성립한다. 차량·특장·튜닝이 따로 도는 지금은 한 주문이
 * 동시에 여러 곳에 있어서 어느 칸에 둘지 정할 수 없다. 그래서 칸이 아니라 **줄**로 놓고,
 * 각 줄에 「지금 할 것」을 적는다 — 여러 건을 훑는 화면이 답해야 하는 질문은
 * 「이 건이 어느 칸에 있나」가 아니라 **「어느 건에 내 손이 필요한가」**다.
 *
 * 늦은 건이 맨 위로 온다. 라임(할 일)과 빨강(늦었다)의 뜻은 다른 화면과 같다.
 */
export function OrderStepsBoard({ orders, onCardClick }: {
  orders: ApiOrder[]
  onCardClick: (orderId: number) => void
}) {
  if (orders.length === 0) {
    return <div style={s.empty}>진행 중인 주문이 없습니다.</div>
  }

  // 늦은 것 → 할 일이 있는 것 → 나머지
  const sorted = [...orders].sort((a, b) => {
    const rank = (o: ApiOrder) => (o.steps?.stalled ? 0 : (o.steps?.open.length ?? 0) > 0 ? 1 : 2)
    return rank(a) - rank(b)
  })

  return (
    <div style={s.list}>
      {sorted.map(o => {
        const st = o.steps
        const done = st?.done ?? 0
        const total = st?.total ?? STEPS.length
        const open = st?.open ?? []
        const late = !!st?.stalled
        return (
          <button key={o.id} style={late ? s.rowLate : s.row} onClick={() => onCardClick(o.id)}>
            <div style={s.main}>
              <div style={s.line1}>
                <span style={s.no}>주문 #{o.id}</span>
                <span style={s.name}>{o.quote.customer?.name ?? '고객 미상'}</span>
                <span style={s.model}>{o.quote.model_code}</span>
                {late && <span style={s.lateTag}>지연</span>}
              </div>
              <div style={s.line2}>
                {open.length > 0
                  ? <span style={late ? s.openLate : s.open}>{open.join(' · ')}</span>
                  : <span style={s.muted}>{done === total ? '모든 단계 완료' : '다른 단계가 끝나야 진행됩니다'}</span>}
              </div>
            </div>
            <div style={s.side}>
              <span style={s.count}>{done}/{total}</span>
              <span style={s.bar}>
                <span style={{ ...s.barFill, width: `${Math.round((done / total) * 100)}%`, background: late ? 'var(--req)' : 'var(--lime)' }} />
              </span>
              {o.delivery_due && <span style={s.due}>납기 {o.delivery_due.slice(0, 10)}</span>}
            </div>
          </button>
        )
      })}
    </div>
  )
}

const rowBase: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  gap: 'var(--sp-3)', flexWrap: 'wrap', width: '100%', textAlign: 'left',
  padding: 'var(--sp-3) var(--sp-3) var(--sp-3) var(--sp-3)',
  border: 'none', borderBottom: 'var(--hairline)', background: 'none',
  fontFamily: 'inherit', cursor: 'pointer',
}

const s: Record<string, React.CSSProperties> = {
  list: { display: 'flex', flexDirection: 'column' },
  row: { ...rowBase, boxShadow: 'inset 3px 0 0 0 var(--lime)' },
  rowLate: { ...rowBase, boxShadow: 'inset 3px 0 0 0 var(--req)' },
  main: { flex: '1 1 260px', minWidth: 0 },
  line1: { display: 'flex', alignItems: 'baseline', gap: 'var(--sp-2)', flexWrap: 'wrap' },
  no: { fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--dark)', fontVariantNumeric: 'tabular-nums' },
  name: { fontSize: 'var(--fs-label)', color: 'var(--dark)' },
  model: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  lateTag: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 700 },
  line2: { marginTop: 3 },
  open: { fontSize: 'var(--fs-caption)', color: 'var(--dark)' },
  openLate: { fontSize: 'var(--fs-caption)', color: 'var(--req)', fontWeight: 600 },
  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  side: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)', flexShrink: 0 },
  count: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  bar: { display: 'block', width: 64, height: 4, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' },
  barFill: { display: 'block', height: '100%', borderRadius: 999 },
  due: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  empty: { padding: 'var(--sp-5) 0', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-label)' },
}
