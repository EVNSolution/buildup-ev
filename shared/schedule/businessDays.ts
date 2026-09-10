/**
 * 영업일 계산 — 발주 납기 한도를 서버와 화면이 **같은 답으로** 낸다.
 *
 * 발주서 특이사항: 「납기일자: 발주일로부터 15일 이내 (영업일 기준)」.
 * 화면에서 고를 수 있는 마지막 날과 서버가 받아 주는 마지막 날이 다르면,
 * 사용자는 고를 수 있는 날짜를 골랐는데 저장이 거부되는 상황을 만난다.
 * 그래서 계산을 shared 에 한 벌만 둔다(견적 계산과 같은 원칙).
 *
 * **주말과 공휴일을 뺀다.** 공휴일 달력은 여기에 **주입한다**(`setHolidays`) —
 * 코드에 박으면 임시공휴일 하나에 배포를 해야 하고, 해마다 사람이 코드를 고쳐야 한다.
 * 정본은 DB 의 `holiday` 표이고, 서버와 화면이 **같은 목록**을 받아 같은 답을 낸다.
 *
 * ⚠️ 주입하지 않으면 예전처럼 **주말만** 뺀다. 목록을 못 받았을 때 계산이 멈추는 것보다
 *    한도가 짧게(빡빡하게) 나오는 편이 안전하다 — 한도는 넘기면 안 되는 쪽이다.
 */

/** 날짜만 남긴다(시각을 지운다). 하루 경계에서 하루가 밀리는 것을 막는다. */
function dayOnly(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** 토·일이면 true. */
export function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

/**
 * 공휴일 달력 — `YYYY-MM-DD` 집합. 주입 전에는 비어 있다(= 주말만 뺀다).
 *
 * 모듈 수준에 두는 이유: 영업일 계산은 화면 곳곳에서 불린다. 부를 때마다 목록을
 * 넘기게 하면 **한 군데만 빠뜨려도** 화면과 서버가 다른 답을 내고, 그건 예전에
 * 한 번 겪은 사고다(고를 수 있는데 저장이 거부된다).
 */
let HOLIDAYS: ReadonlySet<string> = new Set();

/** 달력을 갈아 끼운다. 서버는 DB 에서, 화면은 API 에서 받아 부른다. */
export function setHolidays(days: Iterable<string>): void {
  HOLIDAYS = new Set(days);
}

/** 지금 들고 있는 달력(검사·화면 표시용). */
export function holidaySet(): ReadonlySet<string> {
  return HOLIDAYS;
}

/** 공휴일인가 — 주말은 여기서 보지 않는다(`isWeekend` 와 나눠 둔다). */
export function isHoliday(d: Date): boolean {
  return HOLIDAYS.has(toDateInput(d));
}

/** 일할 수 있는 날인가 = 주말도 공휴일도 아니다. */
export function isBusinessDay(d: Date): boolean {
  return !isWeekend(d) && !isHoliday(d);
}

/**
 * `from` 으로부터 영업일 `n` 일 뒤. `from` 당일은 세지 않는다.
 * 예) 금요일 + 1영업일 = 다음 월요일.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const d = dayOnly(from);
  let left = n;
  /*
   * ⚠️ 상한을 둔다. 달력이 잘못 들어와 온 날이 공휴일이면(예: 잘못 넣은 범위)
   *    while 이 영원히 돈다 — 화면이 굳는 것보다 대충이라도 멈추는 편이 낫다.
   */
  let guard = n * 10 + 400;
  while (left > 0 && guard-- > 0) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) left--;
  }
  return d;
}

/** `from` 다음날부터 `to` 까지의 영업일 수(`to` 포함). 과거면 음수가 아니라 0. */
export function businessDaysBetween(from: Date, to: Date): number {
  const a = dayOnly(from);
  const b = dayOnly(to);
  if (b <= a) return 0;
  let n = 0;
  const d = new Date(a);
  while (d < b) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) n++;
  }
  return n;
}

/**
 * 수락 재촉 기준 — 발주 후 **7일이 지나도록 수락하지 않으면** 급한 건으로 본다.
 *
 * 납기 한도가 15영업일인데 수락 자체가 늦어지면 남는 제작 기간이 그만큼 줄고,
 * 어느 순간 한도 안에 넣을 수 없는 날짜만 남는다. 그 전에 눈에 띄게 한다 —
 * 목록에서 맨 위로 올리고 빨갛게 칠하며, 아침 알림에도 같은 기준으로 들어간다.
 * (달력일 기준이다 — 재촉은 「며칠째 방치됐나」의 문제라 주말도 흘러간 날이다)
 */
export const ACCEPT_URGENT_DAYS = 7;

/** 발주 후 며칠 지났나(달력일). */
export function daysSince(from: Date, now: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86400000));
}

/** 수락이 늦어 재촉해야 하는가. */
export function isAcceptOverdue(orderedAt: Date, now: Date): boolean {
  return daysSince(orderedAt, now) >= ACCEPT_URGENT_DAYS;
}

/**
 * 발주 납기 한도 — **제작 배정을 누른 날**로부터 20 영업일.
 *
 * ⚠️ 기산점은 수락일이 아니라 **배정일**(`order.assigned_at`)이다. 수락이 늦어지면
 *    남는 제작 기간이 그만큼 줄어든다 — 수락하면서 새로 20일이 열리는 것이 아니다.
 *
 * ⚠️ 이 숫자는 **주문마다 얼려 둔다**(`order.due_limit_days`). 여기 값은 새 배정의
 *    기본값일 뿐이다. 15일이던 시절에 나간 발주서에는 「15일 이내」가 문서로 찍혀
 *    있으므로, 상수만 바꾸면 이미 나간 서류를 우리가 소급해 고치는 셈이 된다.
 */
export const DELIVERY_DUE_BUSINESS_DAYS = 20;

/** 발주일 기준 납기 마감일(이 날까지 고를 수 있다). */
export function deliveryDueLimit(orderedAt: Date, days: number = DELIVERY_DUE_BUSINESS_DAYS): Date {
  return addBusinessDays(orderedAt, days);
}

/** `YYYY-MM-DD` 로 — 날짜 입력칸과 서버가 같은 문자열을 쓴다(시간대 때문에 하루 밀리지 않게). */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** `YYYY-MM-DD` → Date(로컬 자정). `new Date('2026-08-14')` 는 UTC 로 읽혀 하루 밀린다. */
export function fromDateInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * DATE 컬럼에 넣을 값 — **UTC 자정**으로 만든다.
 *
 * ⚠️ 여기서 하루가 밀린다. 영업일 판정은 로컬 시간으로 해야 맞지만(요일이 로컬 기준),
 *    로컬 자정 Date 를 Postgres DATE 에 그대로 넣으면 UTC 로 변환되면서 **전날**이 된다
 *    (KST 자정 = 전날 15:00 UTC). 실제로 2026-08-04 를 고르면 2026-08-03 이 저장됐다.
 *    납기는 계약상 날짜라 하루가 밀리면 안 된다 — 저장 직전에만 이 함수를 통과시킨다.
 */
export function toDbDate(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** DATE 컬럼에서 읽은 값 → `YYYY-MM-DD`. UTC 로 읽어야 넣을 때와 짝이 맞는다. */
export function fromDbDate(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())}`;
}

export type DueCheck = { ok: true } | { ok: false; reason: string };

/**
 * 납기일이 유효한가. **서버가 최종 판정**하고 화면은 같은 함수로 미리 막는다.
 */
export function checkDeliveryDue(
  due: Date, orderedAt: Date, days: number = DELIVERY_DUE_BUSINESS_DAYS,
): DueCheck {
  const d = dayOnly(due);
  const base = dayOnly(orderedAt);
  if (d <= base) return { ok: false, reason: '납기일은 발주일 이후여야 합니다' };
  if (isWeekend(d)) return { ok: false, reason: '납기일은 영업일만 고를 수 있습니다' };
  // 연휴에 납기를 잡으면 그날 받을 사람이 없다 — 달력에 있는 날은 고를 수 없다
  if (isHoliday(d)) return { ok: false, reason: '납기일은 공휴일이 아닌 날로 골라야 합니다' };
  const limit = deliveryDueLimit(base, days);
  if (d > limit) {
    return { ok: false, reason: `납기일은 발주일로부터 ${days}영업일 이내(${toDateInput(limit)}까지)여야 합니다` };
  }
  return { ok: true };
}
