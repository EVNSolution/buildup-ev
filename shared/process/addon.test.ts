import { describe, it, expect } from 'vitest';
import { ADDON_STEPS, ADDON_TRACKS, addonCanComplete, addonCanUndo, addonSpots } from './addon';

/** 부가작업 규칙(2026-09-14) — 작업 전 → 작업 중(순서 무관) → 고객 인도(순서대로) */
const all = (codes: string[]) => new Set(codes);

describe('부가작업 카탈로그', () => {
  it('🔴 트랙 셋과 단계 — 지시 그대로', () => {
    expect(ADDON_TRACKS).toEqual(['prep', 'work', 'handover']);
    const by = (tr: string) => ADDON_STEPS.filter(s => s.track === tr).map(s => s.label);
    expect(by('prep')).toEqual(['차량 도착']);
    expect(by('work')).toEqual(['배선/배관 작업', '외관 작업', '기타 작업']);
    expect(by('handover')).toEqual(['PDI', '차량 출발', '인도 완료']);
    expect(ADDON_STEPS.find(s => s.code === 'addon_delivered')!.dateLabel).toBe('인도일');
  });

  it('🔴 공장 출고 전에는 아무것도 못 한다', () => {
    expect(addonCanComplete('addon_car_arrived', all([]), false).ok).toBe(false);
  });

  it('🔴 작업 중 셋은 차량 도착 뒤 순서 상관없이', () => {
    const d = all(['addon_car_arrived']);
    for (const c of ['addon_wiring', 'addon_exterior', 'addon_etc']) expect(addonCanComplete(c, d, true).ok, c).toBe(true);
    expect(addonCanComplete('addon_etc', all(['addon_car_arrived', 'addon_wiring']), true).ok).toBe(true);
  });

  it('🔴 PDI 는 작업 셋이 다 끝나야, 출발·인도는 순서대로', () => {
    expect(addonCanComplete('addon_pdi', all(['addon_car_arrived', 'addon_wiring', 'addon_exterior']), true).ok).toBe(false);
    expect(addonCanComplete('addon_pdi', all(['addon_car_arrived', 'addon_wiring', 'addon_exterior', 'addon_etc']), true).ok).toBe(true);
    expect(addonCanComplete('addon_delivered', all(['addon_car_arrived', 'addon_wiring', 'addon_exterior', 'addon_etc', 'addon_pdi']), true).ok).toBe(false);
  });

  it('🔴 되돌리기는 뒤 단계가 끝났으면 막힌다', () => {
    expect(addonCanUndo('addon_car_arrived', all(['addon_car_arrived', 'addon_etc'])).ok).toBe(false);
    expect(addonCanUndo('addon_etc', all(['addon_car_arrived', 'addon_etc'])).ok).toBe(true);
  });

  it('🔴 현황판 칸 — 작업 중 트랙은 남은 첫 작업, 고객 인도는 작업이 다 끝나야 선다', () => {
    const rows = (codes: string[]) => codes.map(code => ({ code, status: 'done', done_at: '2026-09-12T00:00:00Z' }));
    const a = addonSpots(rows(['addon_car_arrived', 'addon_wiring']), '2026-09-10T00:00:00Z');
    expect(a.prep).toBeNull();
    expect(a.work?.code).toBe('addon_exterior');
    expect(a.handover).toBeNull();
    const b = addonSpots([], '2026-09-10T00:00:00Z');
    expect(b.prep?.code).toBe('addon_car_arrived');
    expect(b.prep?.since).toBe('2026-09-10T00:00:00.000Z');
  });
});
