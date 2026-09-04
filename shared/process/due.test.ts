import { describe, it, expect } from 'vitest';
import { dueInfo, dueNeedsAttention, DUE_SOON_DAYS } from './due';

/** 기준일을 고정해 둔다 — 「오늘」이 바뀌어도 테스트가 흔들리지 않게 */
const NOW = new Date(2026, 8, 4);   // 2026-09-04

describe('납기 상태', () => {
  it('🔴 지난 건 — 몇 일 경과인지 말한다', () => {
    expect(dueInfo('2026-09-01', NOW)).toMatchObject({ state: 'overdue', days: -3, label: '납기 3일 경과' });
    expect(dueInfo('2026-09-03', NOW).label).toBe('납기 1일 경과');
  });

  it('🔴 오늘은 「오늘」이라고 말한다 — 「0일 전」은 읽히지 않는다', () => {
    expect(dueInfo('2026-09-04', NOW)).toMatchObject({ state: 'soon', days: 0, label: '납기 오늘' });
  });

  it(`🔴 ${DUE_SOON_DAYS}일 전부터 알린다`, () => {
    expect(dueInfo('2026-09-05', NOW).label).toBe('납기 1일 전');
    expect(dueInfo('2026-09-07', NOW)).toMatchObject({ state: 'soon', label: '납기 3일 전' });
    // 나흘 남으면 아직 조용히 둔다 — 늘 빨가면 빨강이 뜻을 잃는다
    expect(dueInfo('2026-09-08', NOW)).toMatchObject({ state: 'normal', label: '' });
  });

  it('🔴 납기가 없으면 「없음」 — 화면이 깨지지 않는다', () => {
    for (const bad of [null, undefined, '', '언젠가', '2026/09/04']) {
      expect(dueInfo(bad as string | null, NOW).state, String(bad)).toBe('none');
    }
  });

  it('🔴 시각은 버리고 날짜만 본다 — 오후에 본다고 오늘이 지나지 않는다', () => {
    const evening = new Date(2026, 8, 4, 23, 59);
    expect(dueInfo('2026-09-04', evening)).toMatchObject({ state: 'soon', days: 0 });
    // ISO 문자열(시각 포함)도 날짜만 읽는다
    expect(dueInfo('2026-09-04T15:00:00.000Z', NOW).days).toBe(0);
  });
});

describe('정렬 — 급한 것이 위로', () => {
  it('🔴 많이 지난 것 → 조금 지난 것 → 오늘 → 하루 전 → … → 납기 없음', () => {
    const days = ['2026-09-01', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-10-01', null];
    const sorted = [...days]
      .sort((a, b) => dueInfo(a, NOW).sortKey - dueInfo(b, NOW).sortKey);
    expect(sorted).toEqual(days);   // 이미 급한 순 — 순서가 바뀌지 않아야 한다
  });

  it('🔴 지난 건은 **이틀 전보다도 위**에 온다', () => {
    const overdue = dueInfo('2026-09-03', NOW).sortKey;   // 1일 경과
    const twoDays = dueInfo('2026-09-06', NOW).sortKey;   // 2일 전
    expect(overdue).toBeLessThan(twoDays);
  });
});

describe('강조 여부', () => {
  it('🔴 지났거나 사흘 안이면 알린다', () => {
    expect(dueNeedsAttention(dueInfo('2026-09-01', NOW))).toBe(true);
    expect(dueNeedsAttention(dueInfo('2026-09-07', NOW))).toBe(true);
    expect(dueNeedsAttention(dueInfo('2026-09-08', NOW))).toBe(false);
    expect(dueNeedsAttention(dueInfo(null, NOW))).toBe(false);
  });
});
