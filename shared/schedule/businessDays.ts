/**
 * 영업일 계산 — 발주 납기 한도를 서버와 화면이 **같은 답으로** 낸다.
 *
 * 발주서 특이사항: 「납기일자: 발주일로부터 15일 이내 (영업일 기준)」.
 * 화면에서 고를 수 있는 마지막 날과 서버가 받아 주는 마지막 날이 다르면,
 * 사용자는 고를 수 있는 날짜를 골랐는데 저장이 거부되는 상황을 만난다.
 * 그래서 계산을 shared 에 한 벌만 둔다(견적 계산과 같은 원칙).
 *
 * ⚠️ **주말만 제외한다. 공휴일은 아직 반영하지 않는다.**
 *    공휴일 표가 없어 지금은 넣을 수 없다 — 넣는 순간 매년 갱신해야 하는 데이터가 되므로
 *    필요해지면 DB 표로 만들어 여기에 주입한다(달력을 코드에 하드코딩하지 않는다).
 *    지금 계산은 실제보다 **짧게(빡빡하게)** 나온다 — 한도이므로 안전한 방향이다.
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
 * `from` 으로부터 영업일 `n` 일 뒤. `from` 당일은 세지 않는다.
 * 예) 금요일 + 1영업일 = 다음 월요일.
 */
export function addBusinessDays(from: Date, n: number): Date {
  const d = dayOnly(from);
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isWeekend(d)) left--;
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
    if (!isWeekend(d)) n++;
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

/** 발주 납기 한도 — 발주일로부터 15 영업일. */
export const DELIVERY_DUE_BUSINESS_DAYS = 15;

/** 발주일 기준 납기 마감일(이 날까지 고를 수 있다). */
export function deliveryDueLimit(orderedAt: Date): Date {
  return addBusinessDays(orderedAt, DELIVERY_DUE_BUSINESS_DAYS);
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
export function checkDeliveryDue(due: Date, orderedAt: Date): DueCheck {
  const d = dayOnly(due);
  const base = dayOnly(orderedAt);
  if (d <= base) return { ok: false, reason: '납기일은 발주일 이후여야 합니다' };
  if (isWeekend(d)) return { ok: false, reason: '납기일은 영업일만 고를 수 있습니다' };
  const limit = deliveryDueLimit(base);
  if (d > limit) {
    return { ok: false, reason: `납기일은 발주일로부터 ${DELIVERY_DUE_BUSINESS_DAYS}영업일 이내(${toDateInput(limit)}까지)여야 합니다` };
  }
  return { ok: true };
}
