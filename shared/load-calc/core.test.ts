import { describe, it, expect } from "vitest";
import { calcLoad } from "./core.js";

/**
 * 검증 기준: docs/reference/PV5_하중계산기_TS모방.xlsx "검증_PV5" 시트
 * 차량: PV5 96버3164 / 출처: cyberts.kr TS튜닝알리고 (2026-06-16 실측)
 *
 * 입력
 *   축간거리          2995 mm
 *   공차 전/후축     1105 / 800 kg
 *   타이어 허용하중   1000 kg × 2 (전·후 동일)
 *   적재량           600 kg, 하대옵셋트 35 mm (후축까지거리)
 *   정원 1열         130 kg @ 후축까지거리 1500 mm
 *
 * 기대 출력 (cyberts 서버값과 전 항목 일치 확인)
 *   공차 전/후축     1105 / 800 kg
 *   적차 전/후축     1180 / 1455 kg
 *   공차 부하율      55.3 / 40.0 %
 *   적차 부하율      59.0 / 72.8 %
 *   조향륜분포율     44.8 %
 */

const PV5_BASE = {
  curb_axle_front_kg: 1105,
  curb_axle_rear_kg: 800,
  wheelbase_mm: 2995,
  tire_front: { allowable_load_kg: 1000, wheels: 2 },
  tire_rear: { allowable_load_kg: 1000, wheels: 2 },
} as const;

describe("calcLoad — PV5 검증 케이스 (cyberts 실측 기준)", () => {
  const result = calcLoad({
    ...PV5_BASE,
    cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
    crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 1500 }],
  });

  it("공차 전축 1105 kg", () => expect(result.curb.front_kg).toBe(1105));
  it("공차 후축 800 kg", () => expect(result.curb.rear_kg).toBe(800));
  it("적차 전축 1180 kg", () => expect(result.loaded.front_kg).toBe(1180));
  it("적차 후축 1455 kg", () => expect(result.loaded.rear_kg).toBe(1455));
  it("차량총중량 2635 kg", () => expect(result.gvw_kg).toBe(2635));

  it("공차 전축 부하율 55.3 %", () =>
    expect(result.tire_load_rate.curb_front_pct).toBe(55.3));
  it("공차 후축 부하율 40.0 %", () =>
    expect(result.tire_load_rate.curb_rear_pct).toBe(40));
  it("적차 전축 부하율 59.0 %", () =>
    expect(result.tire_load_rate.loaded_front_pct).toBe(59));
  it("적차 후축 부하율 72.8 %", () =>
    expect(result.tire_load_rate.loaded_rear_pct).toBe(72.8));

  it("조향륜 하중분포율 44.8 %", () =>
    expect(result.steering_axle_ratio_pct).toBe(44.8));
});

describe("calcLoad — 설치/탈거 없을 때 공차 변경 없음", () => {
  const result = calcLoad({ ...PV5_BASE });

  it("공차 전축 변화 없음", () => expect(result.curb.front_kg).toBe(1105));
  it("공차 후축 변화 없음", () => expect(result.curb.rear_kg).toBe(800));
  it("적차 = 공차 (적재·정원 없음)", () => {
    expect(result.loaded.front_kg).toBe(1105);
    expect(result.loaded.rear_kg).toBe(800);
  });
});

describe("calcLoad — ceil5 동작 (5kg 올림)", () => {
  it("raw 72.12 → ceil5 → 75 → 적차 전축 1180", () => {
    // 600×35/2995 + 130×1500/2995 = 7.012 + 65.108 = 72.12
    const r = calcLoad({
      ...PV5_BASE,
      cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
      crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 1500 }],
    });
    expect(r.loaded.front_kg).toBe(1105 + 75); // 1180
  });

  it("raw 0 → ceil5 → 0 (변화 없음)", () => {
    const r = calcLoad({ ...PV5_BASE });
    expect(r.loaded.front_kg).toBe(1105);
  });
});

describe("calcLoad — 법규 체크", () => {
  it("GVW 이내 → compliant true", () => {
    const r = calcLoad({
      ...PV5_BASE,
      cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
      crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 1500 }],
      gvw_limit_kg: 3500,
    });
    expect(r.legal.within_gvw).toBe(true);
    expect(r.legal.compliant).toBe(true);
  });

  it("GVW 초과 → compliant false", () => {
    const r = calcLoad({
      ...PV5_BASE,
      cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
      gvw_limit_kg: 2000, // 총중량 2635 > 2000 → 초과
    });
    expect(r.legal.within_gvw).toBe(false);
    expect(r.legal.compliant).toBe(false);
  });

  it("제원 초과 → within_dimensions false", () => {
    const r = calcLoad({
      ...PV5_BASE,
      dimension_limit: { max_length_mm: 5000 },
      actual_dimension: { length_mm: 5500 },
    });
    expect(r.legal.within_dimensions).toBe(false);
  });

  it("제원 이내 → within_dimensions true", () => {
    const r = calcLoad({
      ...PV5_BASE,
      dimension_limit: { max_length_mm: 6000 },
      actual_dimension: { length_mm: 5040 },
    });
    expect(r.legal.within_dimensions).toBe(true);
  });
});
