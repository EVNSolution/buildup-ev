import { describe, it, expect } from 'vitest';
import { calcBom } from './core.js';

// 냉동 표준 여닫이 기본 — option-weights JSON 완성무게 426.4 (냉동기 포함)
const REEFER = calcBom({ BODYTYPE: 'BODY_REEFER', TOP: 'TOP_STD', DOORTYPE: 'DOOR_SWING', DOORADD: 'ADD_NONE' })!;
const DRY = calcBom({ BODYTYPE: 'BODY_DRY', TOP: 'TOP_STD', DOORTYPE: 'DOOR_SWING', DOORADD: 'ADD_NONE' })!;

describe('calcBom — 냉동탑은 냉동기를 별도 설치항목으로 분리', () => {
  it('냉동 선택 시 설치항목 2개 (탑 + 냉동기)', () => {
    expect(REEFER.install_items.length).toBe(2);
    expect(REEFER.install_items[1]!.label).toBe('냉동기');
  });

  it('냉동기 무게 50kg, 후축까지거리 -300 (DB 상수)', () => {
    expect(REEFER.install_items[1]!.weight_kg).toBe(50);
    expect(REEFER.install_weight_items[1]!.dist_to_rear_axle_mm).toBe(-300);
  });

  it('총 설치중량 보존 — 이중계상 없음 (원 완성무게 426.4)', () => {
    const total = REEFER.install_items.reduce((s, i) => s + i.weight_kg, 0);
    expect(total).toBeCloseTo(426.4, 3);
  });

  it('내장탑은 냉동기 없음 (설치항목 1개)', () => {
    expect(DRY.install_items.length).toBe(1);
  });
});
