import { describe, it, expect } from 'vitest';
import { calcTopWeightKg, type BodyKind, type DoorKind } from './top-weight.js';

// 중량시트 외측 특장치수
const DIMS = { 저상: [2540, 1910, 1290], 표준: [2540, 1910, 1590] } as const;

// option-weights-real.json / 중량시트 완성무게 (kg)
const EXPECT: Record<string, number> = {
  '냉동 저상 여닫이 기본': 396.7, '냉동 저상 슬라이딩 기본': 406.7,
  '냉동 저상 여닫이 4도어': 428.0, '냉동 저상 슬라이딩 4도어': 448.0,
  '냉동 표준 여닫이 기본': 426.4, '냉동 표준 슬라이딩 기본': 436.4,
  '냉동 표준 여닫이 4도어': 463.5, '냉동 표준 슬라이딩 4도어': 483.5,
  '내장 저상 여닫이 기본': 315.2, '내장 저상 슬라이딩 기본': 325.2,
  '내장 저상 여닫이 4도어': 341.7, '내장 저상 슬라이딩 4도어': 361.7,
  '내장 표준 여닫이 기본': 341.0, '내장 표준 슬라이딩 기본': 351.0,
  '내장 표준 여닫이 4도어': 372.2, '내장 표준 슬라이딩 4도어': 392.2,
};

describe('calcTopWeightKg — 탑 무게 수식 (중량시트 재현)', () => {
  const bodies: [string, BodyKind][] = [['냉동', 'reefer'], ['내장', 'dry']];
  const doors: [string, DoorKind][] = [['여닫이', 'swing'], ['슬라이딩', 'slide']];
  const adds: [string, boolean][] = [['기본', false], ['4도어', true]];

  for (const [bk, body] of bodies)
    for (const [size, dims] of Object.entries(DIMS))
      for (const [dk, doorType] of doors)
        for (const [ak, doorAdd] of adds) {
          const key = `${bk} ${size} ${dk} ${ak}`;
          it(`${key} → ${EXPECT[key]}kg (±1)`, () => {
            const w = calcTopWeightKg(dims[0], dims[1], dims[2], { body, doorType, doorAdd });
            expect(Math.abs(w - EXPECT[key]!)).toBeLessThanOrEqual(1);
          });
        }

  it('치수가 커지면 무게 증가 (단조성)', () => {
    const base = calcTopWeightKg(2540, 1910, 1290, { body: 'reefer', doorType: 'swing', doorAdd: false });
    const bigger = calcTopWeightKg(3000, 2000, 1500, { body: 'reefer', doorType: 'swing', doorAdd: false });
    expect(bigger).toBeGreaterThan(base);
  });
});
