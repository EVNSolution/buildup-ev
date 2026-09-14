import { describe, it, expect } from 'vitest';
import { shownDate, kstDay, actualStepDates } from './actual';

describe('예정일 · 실제 완료일 — 날짜 줄의 값과 색', () => {
  it('🔴 끝났으면 실제 날짜(초록), 예정일을 넘겨 끝났으면 빨강', () => {
    expect(shownDate('2026-09-10', '2026-09-09')).toEqual({ value: '2026-09-09', tone: 'done' });
    expect(shownDate('2026-09-10', '2026-09-10')).toEqual({ value: '2026-09-10', tone: 'done' });   // 당일 = 제때
    expect(shownDate('2026-09-10', '2026-09-11')).toEqual({ value: '2026-09-11', tone: 'done_late' });
    expect(shownDate(null, '2026-09-11')).toEqual({ value: '2026-09-11', tone: 'done' });            // 예정이 없었으면 늦었다고 할 수 없다
  });

  it('🔴 안 끝났으면(되돌려 실제 날짜가 비면) 예정일(검정) → 없으면 미정', () => {
    expect(shownDate('2026-09-10T00:00:00.000Z', null)).toEqual({ value: '2026-09-10', tone: 'planned' });
    expect(shownDate(null, null)).toEqual({ value: null, tone: 'none' });
    expect(shownDate(undefined, undefined)).toEqual({ value: null, tone: 'none' });
  });

  it('🔴 완료 시각은 한국 날짜로 자른다 — 아침 9시 전 완료가 전날로 밀리지 않는다', () => {
    expect(kstDay(new Date('2026-09-10T20:30:00Z'))).toBe('2026-09-11');   // KST 9/11 05:30
    expect(kstDay('2026-09-10T14:59:00Z')).toBe('2026-09-10');              // KST 9/10 23:59
  });

  it('🔴 차량 도착 = 완료 시각, 출고 = 출고일(없으면 완료 시각) — 안 끝난 단계는 null', () => {
    const at = new Date('2026-09-10T01:00:00Z');
    expect(actualStepDates([
      { code: 'car_arrived', status: 'done', done_at: at },
      { code: 'delivered', status: 'done', done_at: at, planned_at: new Date('2026-09-12T00:00:00Z') },
    ])).toEqual({ car_arrived_on: '2026-09-10', shipped_on: '2026-09-12' });
    expect(actualStepDates([
      { code: 'car_arrived', status: 'pending', done_at: null },
      { code: 'delivered', status: 'done', done_at: at, planned_at: null },
    ])).toEqual({ car_arrived_on: null, shipped_on: '2026-09-10' });
    expect(actualStepDates([])).toEqual({ car_arrived_on: null, shipped_on: null });
  });
});
