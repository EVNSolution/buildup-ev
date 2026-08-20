import type { ApiOrder } from '@shared/types/index'
import { STEPS } from '@shared/process/steps'

/**
 * 주문 여러 건을 한눈에 — **옛 6단계 칸반을 대신한다.**
 *
 * 칸반은 진행이 한 줄일 때만 성립한다. 차량·특장·튜닝이 따로 도는 지금은 한 주문이
 * 동시에 여러 곳에 있어서 어느 칸에 둘지 정할 수 없다. 그래서 칸이 아니라 **줄**로 놓는다.
 *
 * ⚠️ 각 줄에는 **끝낸 단계**만 적는다. 예전엔 「지금 할 수 있는 단계」를 적었는데,
 *    아무것도 완료 안 된 주문에 「차량 도착 · 특장 제작 완료」가 떠서 읽는 사람이
 *    그 단계를 **끝냈다**고 읽었다(실제 제보). 할 일과 끝낸 일은 반대 뜻이라
 *    한 자리에 같은 모양으로 적으면 안 된다.
 *    「어느 건에 손이 필요한가」는 **줄 순서와 지연 표시**가 답한다.
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
              {/* 끝낸 것만 적는다 — 「✓」 로 완료라는 뜻을 눈에도 못박는다 */}
              <div style={s.line2}>
                {done > 0 && done === total
                  ? <span style={s.doneAll}>✓ 모든 단계 완료</span>
                  : st?.last_done
                    ? <span style={s.doneStep}>✓ {st.last_done}<span style={s.doneCount}> · {done}/{total} 완료</span></span>
                    : <span style={s.muted}>아직 완료된 단계가 없습니다</span>}
              </div>
            </div>
            {/*
              납기를 진척도 **왼쪽**에 둔다 — 「언제까지인가」를 먼저 읽고 「얼마나 왔나」를 본다.
              둘 사이는 넉넉히 띄운다. 붙여 두면 「0/15」와 날짜가 한 덩어리로 읽혀
              무엇이 진척이고 무엇이 기한인지 구분되지 않는다.
            */}
            <div style={s.side}>
              <span style={s.due}>{o.delivery_due ? `납기 ${o.delivery_due.slice(0, 10)}` : ''}</span>
              <span style={s.progress}>
                <span style={s.count}>{done}/{total}</span>
                <span style={s.bar}>
                  <span style={{ ...s.barFill, width: `${Math.round((done / total) * 100)}%`, background: late ? 'var(--req)' : 'var(--lime)' }} />
                </span>
              </span>
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
  doneStep: { fontSize: 'var(--fs-caption)', color: 'var(--dark)' },
  doneAll: { fontSize: 'var(--fs-caption)', color: 'var(--dark)', fontWeight: 600 },
  doneCount: { color: 'var(--muted)' },
  muted: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  // 납기 ↔ 진척도 사이는 --sp-6(32px). 붙어 있으면 한 덩어리로 읽힌다
  side: { display: 'flex', alignItems: 'center', gap: 'var(--sp-6)', flexShrink: 0 },
  // 진척도는 숫자와 막대가 한 벌 — 이 둘만 붙어 있어야 한다
  progress: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  count: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  bar: { display: 'block', width: 64, height: 4, borderRadius: 999, background: 'var(--line)', overflow: 'hidden' },
  barFill: { display: 'block', height: '100%', borderRadius: 999 },
  // 납기가 없어도 자리를 지킨다 — 줄마다 진척도 위치가 흔들리면 세로로 훑기 어렵다
  due: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums', minWidth: 96, textAlign: 'right' },
  empty: { padding: 'var(--sp-5) 0', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-label)' },
}
