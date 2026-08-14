import { describe, it, expect } from 'vitest';
import {
  addBusinessDays, businessDaysBetween, checkDeliveryDue, deliveryDueLimit,
  fromDateInput, isWeekend, toDateInput, toDbDate, fromDbDate, DELIVERY_DUE_BUSINESS_DAYS,
} from './businessDays';

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

describe('납기 한도 — 발주일로부터 15영업일', () => {
  it('한도는 15영업일이다', () => {
    expect(DELIVERY_DUE_BUSINESS_DAYS).toBe(15);
    expect(toDateInput(deliveryDueLimit(FRI))).toBe('2026-09-04');
  });

  it('한도 당일은 통과한다', () => {
    expect(checkDeliveryDue(new Date(2026, 8, 4), FRI)).toEqual({ ok: true });
  });

  it('한도 다음 영업일은 거부한다', () => {
    const r = checkDeliveryDue(new Date(2026, 8, 7), FRI);   // 9/7 월
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('2026-09-04');
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
