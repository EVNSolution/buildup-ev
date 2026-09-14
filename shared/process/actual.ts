/**
 * **예정일과 실제 완료일** — 차량 도착 · 납기 · 고객 인도 칸이 같은 규칙으로 날짜와 색을 고른다(2026-09-14 지시).
 *
 *   · 끝났으면 **실제 날짜**를 보여 준다
 *       차량 도착 = 특장사가 「차량 도착」을 완료한 날
 *       납기     = 「출고」 날짜(출고할 때 적는 출고일)
 *       고객 인도 = 부가작업 「인도 완료」의 실제 인도일
 *   · 되돌리면 실제 날짜가 지워지므로(서버가 done_at·출고일·인도일을 비운다) **예정일 → 미정**으로 돌아간다
 *   · 색: 예정 = 검정, 실제 완료 = 초록, **예정일을 넘겨 완료** = 빨강
 *     (아직 안 끝났는데 예정일이 지난 것은 예전처럼 빨강 — 그건 지금 늦고 있다는 뜻이다)
 */

/** 시각 → 한국 날짜 `YYYY-MM-DD`. 서버는 UTC 로 돌 수 있어 로컬 시각으로 자르면 아침 9시 전 완료가 전날이 된다 */
export function kstDay(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  return new Date(x.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export type DateTone =
  /** 날짜 없음 — 「미정」 */
  | 'none'
  /** 예정일 — 검정 */
  | 'planned'
  /** 실제 완료 — 초록 */
  | 'done'
  /** 예정일을 넘겨 완료 — 빨강 */
  | 'done_late';

export interface ShownDate {
  /** 보여 줄 날짜(YYYY-MM-DD) — 끝났으면 실제 날짜, 아니면 예정일 */
  value: string | null;
  tone: DateTone;
}

/** 칸 하나의 날짜와 색. `actual` 이 있으면 끝난 것이다 */
export function shownDate(planned: string | null | undefined, actual: string | null | undefined): ShownDate {
  const p = planned ? planned.slice(0, 10) : null;
  const a = actual ? actual.slice(0, 10) : null;
  if (a) return { value: a, tone: p && a > p ? 'done_late' : 'done' };
  if (p) return { value: p, tone: 'planned' };
  return { value: null, tone: 'none' };
}

/**
 * 주문 단계 기록에서 실제 날짜 둘을 뽑는다 — 목록·상세 응답이 같은 함수를 쓴다.
 * 출고는 출고할 때 적은 날짜(planned_at)를 먼저 믿고, 없으면(옛 기록) 완료 시각의 한국 날짜.
 */
export function actualStepDates(
  rows: { code: string; status: string; planned_at?: Date | null; done_at: Date | null }[],
): { car_arrived_on: string | null; shipped_on: string | null } {
  const doneRow = (code: string) => rows.find(r => r.code === code && r.status === 'done');
  const car = doneRow('car_arrived');
  const ship = doneRow('delivered');
  return {
    car_arrived_on: car?.done_at ? kstDay(car.done_at) : null,
    shipped_on: ship
      ? (ship.planned_at ? ship.planned_at.toISOString().slice(0, 10) : ship.done_at ? kstDay(ship.done_at) : null)
      : null,
  };
}
