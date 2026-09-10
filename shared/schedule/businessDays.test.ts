import { describe, it, expect, afterEach } from 'vitest';
import {
  addBusinessDays, businessDaysBetween, checkDeliveryDue, deliveryDueLimit,
  fromDateInput, isWeekend, toDateInput, toDbDate, fromDbDate, DELIVERY_DUE_BUSINESS_DAYS,
  isAcceptOverdue, daysSince, setHolidays, isHoliday, isBusinessDay,
} from './businessDays';

/*
 * 달력은 모듈이 들고 있다 — 시험이 서로에게 새지 않게 매번 비운다.
 * (비우면 예전처럼 주말만 빼는 계산이 된다)
 */
afterEach(() => setHolidays([]));

// 2026-08-14 는 금요일. 이 날을 기준으로 요일 경계를 확인한다.
const FRI = new Date(2026, 7, 14);
const SAT = new Date(2026, 7, 15);
const SUN = new Date(2026, 7, 16);
const MON = new Date(2026, 7, 17);

describe('영업일 기본', () => {
  it('토·일만 주말이다', () => {
    expect(isWeekend(FRI)).toBe(false);
    expect(isWeekend(SAT)).toBe(true);
    expect(isWeekend(SUN)).toBe(true);
    expect(isWeekend(MON)).toBe(false);
  });

  it('금요일 +1영업일 = 다음 월요일 (주말을 건너뛴다)', () => {
    expect(toDateInput(addBusinessDays(FRI, 1))).toBe('2026-08-17');
  });

  it('당일은 세지 않는다', () => {
    expect(toDateInput(addBusinessDays(MON, 1))).toBe('2026-08-18');
  });

  it('15영업일 = 3주 뒤 같은 요일 (주말 6일을 건너뛴다)', () => {
    // 금 8/14 → 월 8/17 부터 세어 15영업일 → 9/4(금)
    expect(toDateInput(addBusinessDays(FRI, 15))).toBe('2026-09-04');
  });

  it('사이 영업일 수를 센다', () => {
    expect(businessDaysBetween(FRI, MON)).toBe(1);   // 토·일 제외
    expect(businessDaysBetween(FRI, FRI)).toBe(0);
    expect(businessDaysBetween(MON, FRI)).toBe(0);   // 과거는 0
  });
});

describe('납기 한도 — **배정일**로부터 20영업일', () => {
  it('한도는 20영업일이다', () => {
    /*
     * 기산점은 수락일이 아니라 **배정일**이다. 수락이 늦어지면 남는 제작 기간이
     * 그만큼 줄어든다 — 수락하면서 새로 20일이 열리는 것이 아니다.
     */
    expect(DELIVERY_DUE_BUSINESS_DAYS).toBe(20);
    expect(toDateInput(deliveryDueLimit(FRI))).toBe('2026-09-11');
  });

  it('한도는 주문마다 다를 수 있다 — 15일 시절 발주서는 15일 그대로', () => {
    // 상수를 올려도 이미 나간 발주서(「15일 이내」가 문서에 찍혀 있다)는 바뀌지 않는다
    expect(toDateInput(deliveryDueLimit(FRI, 15))).toBe('2026-09-04');
    expect(checkDeliveryDue(new Date(2026, 8, 7), FRI, 15).ok).toBe(false);
    expect(checkDeliveryDue(new Date(2026, 8, 7), FRI, 20).ok).toBe(true);
  });

  it('한도 당일은 통과한다', () => {
    expect(checkDeliveryDue(new Date(2026, 8, 11), FRI)).toEqual({ ok: true });
  });

  it('한도 다음 영업일은 거부한다', () => {
    const r = checkDeliveryDue(new Date(2026, 8, 14), FRI);   // 9/14 월
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('2026-09-11');
  });

  it('발주일 당일·과거는 거부한다', () => {
    expect(checkDeliveryDue(FRI, FRI).ok).toBe(false);
    expect(checkDeliveryDue(new Date(2026, 7, 13), FRI).ok).toBe(false);
  });

  it('주말은 거부한다', () => {
    const r = checkDeliveryDue(SAT, FRI);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('영업일');
  });
});

/*
 * ── 공휴일 ────────────────────────────────────────────────────────────────
 *
 * 주말만 빼고 세면 연휴가 낀 달에 한도가 실제보다 **짧게** 나온다. 특장사가
 * 고를 수 있는 날짜가 사라진다(제보: 추석이 코앞인데 납기를 못 찍는다).
 */
describe('공휴일', () => {
  /** 2026 추석 — 9/24(목)·9/25(금)·9/26(토). 연휴에 일요일이 없어 대체공휴일은 없다. */
  const CHUSEOK = ['2026-09-24', '2026-09-25', '2026-09-26'];

  it('주입하기 전에는 주말만 뺀다 — 목록을 못 받아도 계산이 멈추지 않는다', () => {
    expect(isHoliday(new Date(2026, 8, 25))).toBe(false);
    expect(isBusinessDay(new Date(2026, 8, 25))).toBe(true);
  });

  it('🔴 연휴만큼 한도가 뒤로 밀린다', () => {
    const base = new Date(2026, 8, 10);            // 2026-09-10 목 — 배정일
    const before = toDateInput(deliveryDueLimit(base));
    setHolidays(CHUSEOK);
    const after = toDateInput(deliveryDueLimit(base));
    /*
     * 추석 사흘 중 **평일은 이틀**(9/24 목·9/25 금)이다. 9/26 은 토요일이라
     * 원래도 영업일이 아니었다 — 그래서 한도는 이틀만큼 밀린다.
     */
    expect(before).toBe('2026-10-08');
    expect(after).toBe('2026-10-12');
  });

  it('🔴 연휴 당일은 납기로 고를 수 없다', () => {
    setHolidays(CHUSEOK);
    const r = checkDeliveryDue(new Date(2026, 8, 25), new Date(2026, 8, 10));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('공휴일');
  });

  it('🔴 연휴는 영업일 수에서 빠진다', () => {
    const a = new Date(2026, 8, 23);   // 수
    const b = new Date(2026, 8, 28);   // 다음 월
    expect(businessDaysBetween(a, b)).toBe(3);   // 목·금·월
    setHolidays(CHUSEOK);
    expect(businessDaysBetween(a, b)).toBe(1);   // 월 하나만 남는다
  });

  it('달력이 통째로 잘못 들어와도 멈추지 않는다', () => {
    // 온 날이 공휴일이면 「다음 영업일」을 영원히 찾게 된다 — 상한을 두고 멈춘다
    const all: string[] = [];
    for (let i = 0; i < 800; i++) {
      const d = new Date(2026, 8, 10); d.setDate(d.getDate() + i);
      all.push(toDateInput(d));
    }
    setHolidays(all);
    const t0 = Date.now();
    expect(() => deliveryDueLimit(new Date(2026, 8, 10))).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});

describe('수락 재촉 — 7일', () => {
  it('7일 전에는 재촉하지 않는다', () => {
    expect(isAcceptOverdue(new Date(2026, 7, 10), new Date(2026, 7, 16))).toBe(false);
  });
  it('7일째부터 재촉한다', () => {
    expect(isAcceptOverdue(new Date(2026, 7, 10), new Date(2026, 7, 17))).toBe(true);
  });
  it('지난 일수는 달력일로 센다 (주말도 흘러간 날이다)', () => {
    expect(daysSince(new Date(2026, 7, 14), new Date(2026, 7, 17))).toBe(3);
    expect(daysSince(new Date(2026, 7, 17), new Date(2026, 7, 14))).toBe(0);
  });
});

describe('DATE 컬럼 왕복 — 하루가 밀리면 안 된다', () => {
  it('로컬 자정 Date 를 UTC 자정으로 옮긴다', () => {
    const d = fromDateInput('2026-08-04')!;
    const db = toDbDate(d);
    expect(db.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('넣은 날짜와 읽은 날짜가 같다 (실제로 8/4 → 8/3 으로 밀렸던 버그)', () => {
    for (const s of ['2026-08-04', '2026-01-01', '2026-12-31', '2026-03-01']) {
      expect(fromDbDate(toDbDate(fromDateInput(s)!))).toBe(s);
    }
  });

  it('DB 가 문자열로 돌려줘도 같은 날짜를 읽는다', () => {
    expect(fromDbDate('2026-08-04T00:00:00.000Z')).toBe('2026-08-04');
  });
});

describe('날짜 문자열', () => {
  it('YYYY-MM-DD 를 로컬 자정으로 읽는다 (UTC 로 읽어 하루 밀리면 안 된다)', () => {
    const d = fromDateInput('2026-08-14');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7);
    expect(d!.getDate()).toBe(14);
  });

  it('형식이 아니면 null', () => {
    expect(fromDateInput('2026/08/14')).toBeNull();
    expect(fromDateInput('')).toBeNull();
  });

  it('왕복해도 같다', () => {
    expect(toDateInput(fromDateInput('2026-09-04')!)).toBe('2026-09-04');
  });
});
