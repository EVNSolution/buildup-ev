// 상대 경로로 부른다 — 이 파일은 백엔드 시험(order-dashboard.test.ts)도 불러 쓰는데, 그쪽 빌드는 `@shared` 별칭을 모른다
import type { ApiOrder, ApiQuote } from '../../../shared/types/index'
import { dueInfo } from '../../../shared/process/due'
import { STEPS, TRACKS, type Track } from '../../../shared/process/steps'

/**
 * **주문 현황판의 분류** — 어느 주문을 어느 칸에 세는가. 화면(React)과 떼어 두어 시험할 수 있게 한다.
 *
 *   배정 대기 → 수락 대기 → 진행 중(트랙 4줄) → 인도 완료, 그리고 단계와 상관없이 「납기 지남」
 *
 * 규칙(2026-09-14 기획 확정):
 *   · **배정 대기** = 계약이 끝나 제작할 특장사를 정해야 하는 견적. 특장사가 **거부해 돌아온 건도 여기**
 *     (거부 표시를 붙인다) — 다시 배정해야 하는 일이라 칸을 따로 두지 않는다
 *   · **수락 대기** = 배정됐고 특장사가 아직 수락하지 않았다
 *   · **진행 중** = 수락했고 인도까지 끝나지 않았다. 트랙마다 지금 서 있는 단계에 한 번씩 센다(서버 `lanes`)
 *   · **인도 완료** = 단계를 다 끝냈다
 *   · **납기 지남** = 진행 중인데 납기가 지났다
 */
export type TileKey = 'assign' | 'pending' | 'active' | 'done' | 'late'

export type DashSelection =
  | { kind: 'tile'; key: TileKey }
  | { kind: 'step'; track: Track; code: string }

export interface WaitingItem {
  quote: ApiQuote
  /** 특장사가 거부해 돌아온 건이면 그 주문(사유·대화) */
  rejected: ApiOrder | null
}

export interface StepChip { code: string; label: string; orders: ApiOrder[]; late: number }

export interface Dashboard {
  assign: WaitingItem[]
  pending: ApiOrder[]
  active: ApiOrder[]
  done: ApiOrder[]
  late: ApiOrder[]
  lanes: Record<Track, StepChip[]>
}

/** 거부돼 돌아간 건 — 배정이 풀렸고 누가 거부했는지 남아 있다 */
export const isRejected = (o: ApiOrder) => o.maker_org_id == null && !!o.rejected_by_org

/** 끝났는가 — 주문 구획(OrderSections)과 같은 기준: 견적 완료이거나 단계를 다 끝냈다 */
export const isFinished = (o: ApiOrder) =>
  o.quote.status === 'completed'
  || o.steps?.finished === true
  || (!!o.steps && o.steps.total > 0 && o.steps.done >= o.steps.total)

export function buildDashboard(orders: ApiOrder[], contracted: ApiQuote[], now = new Date()): Dashboard {
  const live = orders.filter(o => !isRejected(o))
  const pending = live.filter(o => o.quote.status === 'assigned' && !isFinished(o))
  const done = live.filter(isFinished)
  const active = live.filter(o => o.quote.status !== 'assigned' && !isFinished(o))
  const late = active.filter(o => dueInfo(o.delivery_due, now).state === 'overdue')

  const rejectedByQuote = new Map(orders.filter(isRejected).map(o => [o.quote_id, o]))
  const assign = contracted
    .filter(q => q.status === 'contracted')
    .map(q => ({ quote: q, rejected: rejectedByQuote.get(q.id) ?? null }))

  const lanes = {} as Record<Track, StepChip[]>
  for (const track of TRACKS) {
    lanes[track] = STEPS.filter(d => d.track === track).map(d => {
      const here = active.filter(o => o.steps?.lanes?.[track]?.code === d.code)
      /*
       * 지연 = 그 단계의 약속일(검사 예정일 등)을 넘겼거나 **주문 납기가 지났다.**
       * 납기가 지난 주문이 어느 칸에 멈춰 있는지가 칩에 보여야 「납기 지남」 칸에서 찾은 것과 이어진다.
       */
      const late = here.filter(o => o.steps?.lanes?.[track]?.late || dueInfo(o.delivery_due, now).state === 'overdue').length
      return { code: d.code, label: d.label, orders: here, late }
    })
  }
  return { assign, pending, active, done, late, lanes }
}

/** 특장사로 거른다 — 배정 대기는 특장사가 없으니 거르지 않는다 */
export function filterByMaker(orders: ApiOrder[], maker: string | null): ApiOrder[] {
  return maker ? orders.filter(o => o.maker_org_id === maker) : orders
}

/** 날짜에서 오늘까지 며칠 — 「n일째」 */
export function daysFrom(iso: string | null | undefined, now = new Date()): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  return Math.max(0, Math.round((day(now) - day(d)) / 86_400_000))
}
