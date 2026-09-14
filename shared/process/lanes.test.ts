import { describe, it, expect } from 'vitest';
import { laneSpots, stepsFor, STEPS } from './steps';

/**
 * 주문 현황판 — 트랙마다 **지금 서 있는 한 칸**(2026-09-14 기획).
 * 줄마다 한 번씩만 센다. 다른 트랙이 안 끝나 못 여는 트랙에는 세지 않는다.
 */
const done = (code: string, at: string) => ({ code, status: 'done', done_at: at });
const START = '2026-09-01T00:00:00.000Z';

describe('laneSpots', () => {
  it('🔴 막 수락한 주문 — 차량은 「차량 도착」, 특장은 「제작 착수」, 튜닝·출고는 아직 못 연다', () => {
    const r = laneSpots(STEPS, [], START);
    expect(r.vehicle?.code).toBe('car_arrived');
    expect(r.body?.code).toBe('build_started');
    expect(r.tuning, '번호판·등록증 전인데 튜닝 줄에 섰다').toBeNull();
    expect(r.merged, '차량·특장 전인데 출고 줄에 섰다').toBeNull();
    // 선행이 없는 단계는 시작 시각부터 센다
    expect(r.vehicle?.since).toBe(START);
  });

  it('🔴 트랙 안에서는 한 칸 — 선행을 끝낸 첫 단계, 「며칠째」는 선행을 끝낸 날부터', () => {
    const r = laneSpots(STEPS, [done('car_arrived', '2026-09-05T03:00:00.000Z')], START);
    expect(r.vehicle?.code).toBe('temp_plate_returned');
    expect(r.vehicle?.since).toBe('2026-09-05T03:00:00.000Z');
  });

  it('🔴 차량·특장이 끝나야 출고 줄에 선다 — 선행이 여럿이면 가장 늦게 끝낸 날부터', () => {
    const rows = [done('car_arrived', '2026-09-05T00:00:00.000Z'), done('build_started', '2026-09-02T00:00:00.000Z'), done('build_done', '2026-09-08T00:00:00.000Z')];
    const r = laneSpots(STEPS, rows, START);
    expect(r.merged?.code).toBe('mounted');
    expect(r.merged?.since).toBe('2026-09-08T00:00:00.000Z');
    expect(r.body, '특장 트랙을 다 끝냈는데 남았다').toBeNull();
  });

  it('🔴 특장만 주문은 차량 도착 뒤 바로 튜닝 줄에 선다', () => {
    const r = laneSpots(stepsFor(true), [done('car_arrived', '2026-09-05T00:00:00.000Z')], START);
    expect(r.tuning?.code).toBe('tuning_drafted');
    expect(r.vehicle, '특장만 주문의 차량 트랙은 도착 하나뿐').toBeNull();
  });

  it('🔴 전부 끝낸 주문은 어느 줄에도 없다', () => {
    const r = laneSpots(STEPS, STEPS.map(s => done(s.code, '2026-09-10T00:00:00.000Z')), START);
    expect(Object.values(r).every(v => v === null)).toBe(true);
  });
});
