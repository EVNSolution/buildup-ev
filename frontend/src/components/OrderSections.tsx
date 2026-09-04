import { useState } from 'react'
import type { ApiOrder } from '@shared/types/index'
import { OrderStepsBoard } from './OrderStepsBoard'
import { daysSince, isAcceptOverdue } from '@shared/schedule/businessDays'

/**
 * 주문 목록 — **수락 대기 · 진행 중 · 완료** 세 구획, 모두 접고 펼친다.
 *
 * 특장사 화면과 관리자 「주문 진행」이 **같은 것을 본다.** 하는 일이 같은 화면인데
 * 생김새가 다르면, 같은 주문을 두고 두 사람이 서로 다른 그림을 들고 이야기하게 된다.
 * 예전에는 관리자 쪽이 구획 없이 전부 한 덩어리였다.
 *
 * ⚠️ **끝난 주문은 진행 중에서 빠진다.** 예전에는 「수락한 것 전부」가 진행 중이라
 *    모든 단계를 끝낸 건도 계속 그 자리에 남아 있었다(제보). 끝난 것이 섞여 있으면
 *    「지금 할 일이 몇 건인가」를 목록에서 셀 수 없다.
 *
 * ⚠️ 어디에도 안 걸리는 상태는 **진행 중에 둔다.** 거부·취소로 되돌아간 건처럼
 *    예상 밖의 상태가 생겨도 목록에서 사라지지 않아야 한다 — 안 보이는 주문이 제일 나쁘다.
 */
export function OrderSections({ orders, onOpen, onPendingOpen }: {
  orders: ApiOrder[]
  /** 카드를 눌렀을 때 — 주문 상세를 연다 */
  onOpen: (id: number) => void
  /**
   * 수락 대기 카드만 다르게 열고 싶을 때(특장사는 발주서 팝업에서 수락·거부를 고른다).
   * 없으면 `onOpen` 을 쓴다 — 관리자는 그냥 상세를 연다.
   */
  onPendingOpen?: (id: number) => void
}) {
  /**
   * 접어 둔 구획. **끝난 것만 접힌 채로 시작한다** — 시간이 갈수록 완료만 쌓이는데,
   * 펼쳐 두면 화면 대부분이 이미 끝난 일로 채워져 정작 지금 할 일을 찾으려면 스크롤해야 한다.
   * 나머지 둘은 지금 손대야 하는 것이라 펼쳐 둔다.
   */
  const [closed, setClosed] = useState<Set<string>>(new Set(['완료']))
  const toggle = (key: string) => setClosed(prev => {
    const next = new Set(prev)
    next.has(key) ? next.delete(key) : next.add(key)
    return next
  })

  /**
   * 끝났는가 — **단계로 판정한다.**
   *
   * 견적 상태(`completed`)만 보면 안 된다. 실제로 15/15 단계를 다 끝내고 인도까지
   * 찍힌 주문이 견적 상태는 `confirmed` 로 남아 진행 중에 계속 떠 있었다(제보).
   * 카드에는 「모든 단계 완료」라고 적혀 있는데 구획은 진행 중이라, 화면이 스스로 모순됐다.
   *
   * 카드가 근거로 삼는 것과 **같은 값**을 쓴다 — 눈에 보이는 것과 분류가 어긋나지 않게.
   * (상태 전이가 새는 건은 서버에서 따로 고쳤다. 여기서는 그래도 화면이 옳게 보이게 한다.)
   */
  const finished = (o: ApiOrder) =>
    o.quote.status === 'completed'
    || (!!o.steps && o.steps.total > 0 && o.steps.done >= o.steps.total)

  const pending = orders.filter(o => o.quote.status === 'assigned' && !finished(o))
  const done    = orders.filter(finished)
  const active  = orders.filter(o => o.quote.status !== 'assigned' && !finished(o))

  if (orders.length === 0) return <div style={s.empty}>배정된 주문이 없습니다.</div>

  return (
    <>
      <Section title="수락 대기" open={!closed.has('수락 대기')} onToggle={() => toggle('수락 대기')} rows={pending}>
        <OrderStepsBoard
          orders={pending}
          mode="pending"
          lateInfo={o => {
            const from = new Date(o.assigned_at ?? o.created_at)
            return { days: daysSince(from, new Date()), late: isAcceptOverdue(from, new Date()) }
          }}
          onCardClick={onPendingOpen ?? onOpen}
        />
      </Section>

      <Section title="진행 중" open={!closed.has('진행 중')} onToggle={() => toggle('진행 중')} rows={active}>
        <OrderStepsBoard orders={active} onCardClick={onOpen} />
      </Section>

      <Section title="완료" open={!closed.has('완료')} onToggle={() => toggle('완료')} rows={done}>
        <OrderStepsBoard orders={done} onCardClick={onOpen} />
      </Section>
    </>
  )
}

/**
 * 구획 하나 — 머리를 누르면 접힌다.
 *
 * 건수는 **접혀 있어도 보인다.** 0 건이어도 줄은 남긴다 —
 * 「끝난 건이 어디로 갔나」를 묻지 않게 한다.
 *
 * ⚠️ **바깥에 선언한다.** 부모 안에서 선언하면 렌더마다 새 컴포넌트 타입이 되어
 *    React 가 트리를 통째로 다시 만든다 — 그 안의 입력칸은 글자 하나 칠 때마다
 *    초점을 잃는다. 이 저장소에는 그걸 막는 검사가 있고, 실제로 여기서 걸렸다.
 */
function Section({ title, rows, open, onToggle, children }: {
  title: string
  rows: ApiOrder[]
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <>
      <button type="button" style={s.head} onClick={onToggle} aria-expanded={open}>
        <span style={s.arrow}>{open ? '▾' : '▸'}</span>
        <span style={s.title}>{title}</span>
        <span style={s.count}>{rows.length}건</span>
      </button>
      {open && (rows.length > 0 ? children : <div style={s.empty}>해당하는 주문이 없습니다.</div>)}
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  /** 접고 펴는 줄 — 제목처럼 보이되, 누를 수 있다는 것은 화살표가 말한다 */
  head: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
    background: 'none', border: 'none', width: '100%', textAlign: 'left',
    padding: 'var(--sp-3) 0 var(--sp-2)', cursor: 'pointer',
  },
  arrow: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', width: 10 },
  title: {
    fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'],
    color: 'var(--muted)',
  },
  count: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  empty: { color: 'var(--muted)', fontSize: 'var(--fs-body)', padding: 'var(--sp-3) 0' },
}
