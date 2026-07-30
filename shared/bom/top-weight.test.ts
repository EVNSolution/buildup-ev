import { describe, it, expect } from 'vitest';
import { calcTopWeightKg, type BodyKind, type DoorKind } from './top-weight.js';
import { DEFAULT_WEIGHT_CONSTANTS } from './weight-constants.js';

// 중량시트 외측 특장치수
const DIMS = { 저상: [2540, 1910, 1290], 표준: [2540, 1910, 1590] } as const;

// 중량시트 완성무게(kg)에서 냉동기 60kg 제외한 "순수 탑" 무게.
// (설계문서 §3: 냉동기는 별도 설치항목. 냉동 바디는 -60, 내장 바디는 원래 냉동기 없음 → 그대로.)
const EXPECT_TOP: Record<string, number> = {
  '냉동 저상 여닫이 기본': 336.7, '냉동 저상 슬라이딩 기본': 346.7,
  '냉동 저상 여닫이 4도어': 368.0, '냉동 저상 슬라이딩 4도어': 388.0,
  '냉동 표준 여닫이 기본': 366.4, '냉동 표준 슬라이딩 기본': 376.4,
  '냉동 표준 여닫이 4도어': 403.5, '냉동 표준 슬라이딩 4도어': 423.5,
  '내장 저상 여닫이 기본': 315.2, '내장 저상 슬라이딩 기본': 325.2,
  '내장 저상 여닫이 4도어': 341.7, '내장 저상 슬라이딩 4도어': 361.7,
  '내장 표준 여닫이 기본': 341.0, '내장 표준 슬라이딩 기본': 351.0,
  '내장 표준 여닫이 4도어': 372.2, '내장 표준 슬라이딩 4도어': 392.2,
};

describe('calcTopWeightKg — 순수 탑 무게 수식 (냉동기 제외, 중량시트 재현)', () => {
  const bodies: [string, BodyKind][] = [['냉동', 'reefer'], ['내장', 'dry']];
  const doors: [string, DoorKind][] = [['여닫이', 'swing'], ['슬라이딩', 'slide']];
  const adds: [string, boolean][] = [['기본', false], ['4도어', true]];

  for (const [bk, body] of bodies)
    for (const [size, dims] of Object.entries(DIMS))
      for (const [dk, doorType] of doors)
        for (const [ak, doorAdd] of adds) {
          const key = `${bk} ${size} ${dk} ${ak}`;
          it(`${key} → ${EXPECT_TOP[key]}kg (±1)`, () => {
            const w = calcTopWeightKg(dims[0], dims[1], dims[2], { body, doorType, doorAdd });
            expect(Math.abs(w - EXPECT_TOP[key]!)).toBeLessThanOrEqual(1);
          });
        }

  // 설계문서 §3 정답지: E9721 외측 2590×1910×1590, 냉동/여닫이/4도어 → 407.1 (냉동기 제외)
  it('E9721 외측 2590×1910×1590 냉동/여닫이/4도어 → 407.1kg (±1)', () => {
    const w = calcTopWeightKg(2590, 1910, 1590, { body: 'reefer', doorType: 'swing', doorAdd: true });
    expect(Math.abs(w - 407.1)).toBeLessThanOrEqual(1);
  });

  it('치수가 커지면 무게 증가 (단조성)', () => {
    const base = calcTopWeightKg(2540, 1910, 1290, { body: 'reefer', doorType: 'swing', doorAdd: false });
    const bigger = calcTopWeightKg(3000, 2000, 1500, { body: 'reefer', doorType: 'swing', doorAdd: false });
    expect(bigger).toBeGreaterThan(base);
  });

  // 상수 변경 → 결과 변화 (DB 상수 주입 동작 검증). 프레임 하드웨어 +5kg → 결과 정확히 +5kg.
  it('weight_constant 값 변경 시 결과가 따라 변함 (하드웨어 +5 → +5)', () => {
    const dims: [number, number, number] = [2540, 1910, 1590];
    const opts = { body: 'reefer' as BodyKind, doorType: 'swing' as DoorKind, doorAdd: false };
    const base = calcTopWeightKg(...dims, opts);
    const bumped = {
      ...DEFAULT_WEIGHT_CONSTANTS.top,
      frame: { ...DEFAULT_WEIGHT_CONSTANTS.top.frame, hardware: DEFAULT_WEIGHT_CONSTANTS.top.frame.hardware + 5 },
    };
    const after = calcTopWeightKg(...dims, opts, bumped);
    expect(after - base).toBeCloseTo(5, 6);
  });
});
