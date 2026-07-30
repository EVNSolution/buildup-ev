import { describe, it, expect, beforeAll } from "vitest";
import { calcLoad } from "./core.js";
import { loadVehicleModels, loadTires, loadPV5LoadCalcDefaults, type VehicleModel, type LoadCalcDefaults } from "./fixtures.js";

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

// ── DB 시드 기반 테스트 ───────────────────────────────────────────────────────
/**
 * db/seed/vehicle_model.csv + tire.csv 를 실제로 읽어서 돌리는 통합 픽스처 테스트.
 * 차종마스터의 공차 축하중·타이어 스펙이 코어 계산에 올바르게 연결되는지 확인.
 *
 * 기준값: docs/reference/PV5_하중계산기_TS모방.xlsx "하중계산(TS)" 시트
 *   공차 전/후축 부하율: 73.7 / 53.3 %  (타이어 215/65R16 = 750 kg × 2 기준)
 */
describe("calcLoad — DB 시드 데이터 기반 (vehicle_model + tire CSV)", () => {
  let pv5: VehicleModel;
  let tireAllowable: number;

  beforeAll(() => {
    const models = loadVehicleModels();
    const tires = loadTires();

    const found = models.find((m) => m.code === "PV5_OPENBED");
    if (!found) throw new Error("vehicle_model.csv 에 PV5_OPENBED 없음");
    pv5 = found;

    const load = tires.get(pv5.default_tire_front);
    if (!load) throw new Error(`tire.csv 에 ${pv5.default_tire_front} 없음`);
    tireAllowable = load;
  });

  it("CSV에서 PV5_OPENBED 로드 성공", () => {
    expect(pv5.code).toBe("PV5_OPENBED");
    expect(pv5.wheelbase_mm).toBe(2995);
    expect(pv5.curb_axle_front_kg).toBe(1105);
    expect(pv5.curb_axle_rear_kg).toBe(800);
  });

  it("215/65R16 타이어 허용하중 750 kg", () => {
    expect(tireAllowable).toBe(750);
  });

  it("공차 전축 부하율 73.7 % (실제 타이어 750×2 기준)", () => {
    const r = calcLoad({
      curb_axle_front_kg: pv5.curb_axle_front_kg,
      curb_axle_rear_kg: pv5.curb_axle_rear_kg,
      wheelbase_mm: pv5.wheelbase_mm,
      tire_front: { allowable_load_kg: tireAllowable, wheels: 2 },
      tire_rear: { allowable_load_kg: tireAllowable, wheels: 2 },
    });
    // 1105 / (750×2) × 100 = 73.67 → 73.7
    expect(r.tire_load_rate.curb_front_pct).toBe(73.7);
  });

  it("공차 후축 부하율 53.3 % (실제 타이어 750×2 기준)", () => {
    const r = calcLoad({
      curb_axle_front_kg: pv5.curb_axle_front_kg,
      curb_axle_rear_kg: pv5.curb_axle_rear_kg,
      wheelbase_mm: pv5.wheelbase_mm,
      tire_front: { allowable_load_kg: tireAllowable, wheels: 2 },
      tire_rear: { allowable_load_kg: tireAllowable, wheels: 2 },
    });
    // 800 / (750×2) × 100 = 53.33 → 53.3
    expect(r.tire_load_rate.curb_rear_pct).toBe(53.3);
  });

  it("적차 전/후축 (cargo 600 kg + 정원 130 kg) — 총중량 보존", () => {
    const r = calcLoad({
      curb_axle_front_kg: pv5.curb_axle_front_kg,
      curb_axle_rear_kg: pv5.curb_axle_rear_kg,
      wheelbase_mm: pv5.wheelbase_mm,
      tire_front: { allowable_load_kg: tireAllowable, wheels: 2 },
      tire_rear: { allowable_load_kg: tireAllowable, wheels: 2 },
      cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
      crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 1500 }],
    });
    // 전축 + 후축 = 총중량 항상 성립
    expect(r.loaded.front_kg + r.loaded.rear_kg).toBe(r.gvw_kg);
    // 공차 1905 + 화물 600 + 정원 130 = 2635
    expect(r.gvw_kg).toBe(2635);
    // ceil5 검증: 적차 전축 = 1180 (동일 케이스)
    expect(r.loaded.front_kg).toBe(1180);
  });
});

// ── pv5-spec.json 기준입력 정답지 검증 ────────────────────────────────────────
/**
 * doc-templates/pv5-spec.json 하중계산_기준입력 을 실제로 읽어 계산.
 * 정원 위치 1850 mm(후축까지, 설계문서 §6 정정 — 기존 2995 는 오기) 기준.
 *
 * 기대값 (설계문서 §6 정정 정답지, 오픈베드):
 *   공차 전/후축   1105 / 800 kg
 *   적차 전/후축   1195 / 1440 kg   (ceil5(600·35/2995 + 130·1850/2995)=ceil5(87.3)=90 → 1105+90)
 *   타이어 부하율  73.7/53.3% (공차) / 79.7/96.0% (적차)  [750 kg × 2]
 */
describe("calcLoad — pv5-spec.json 하중계산_기준입력 기준 (정답지 검증)", () => {
  let pv5: VehicleModel;
  let tireLoad: number;
  let defs: LoadCalcDefaults;
  let cargoKg: number;
  let result: ReturnType<typeof calcLoad>;

  beforeAll(() => {
    const models = loadVehicleModels();
    const tires  = loadTires();
    defs = loadPV5LoadCalcDefaults();

    const found = models.find((m) => m.code === "PV5_OPENBED");
    if (!found) throw new Error("vehicle_model.csv 에 PV5_OPENBED 없음");
    pv5 = found;

    const load = tires.get(pv5.default_tire_front);
    if (!load) throw new Error(`tire.csv 에 ${pv5.default_tire_front} 없음`);
    tireLoad = load;

    // 적재량 = floor50(제작허용총중량 - 공차중량 - 정원중량), ≤ 1000 kg
    const gvw = pv5.gvw_limit_kg ?? 2680;
    cargoKg = Math.min(
      Math.floor(Math.max(0, gvw - pv5.curb_axle_front_kg - pv5.curb_axle_rear_kg - defs.crewWeight) / 50) * 50,
      1000
    );

    result = calcLoad({
      wheelbase_mm:       pv5.wheelbase_mm,
      curb_axle_front_kg: pv5.curb_axle_front_kg,
      curb_axle_rear_kg:  pv5.curb_axle_rear_kg,
      gvw_limit_kg:       pv5.gvw_limit_kg ?? undefined,
      tire_front: { allowable_load_kg: tireLoad, wheels: 2 },
      tire_rear:  { allowable_load_kg: tireLoad, wheels: 2 },
      cargo:      { weight_kg: cargoKg, dist_to_rear_axle_mm: defs.cargoDist },
      crew_items: [{ weight_kg: defs.crewWeight, dist_to_rear_axle_mm: defs.crewDist }],
    });
  });

  it("pv5-spec.json 정원 위치 1850 mm (후축까지, §6 정정)", () => expect(defs.crewDist).toBe(1850));
  it("적재량 자동계산 600 kg", () => expect(cargoKg).toBe(600));

  it("공차 전축 1105 kg", () => expect(result.curb.front_kg).toBe(1105));
  it("공차 후축 800 kg",  () => expect(result.curb.rear_kg).toBe(800));
  it("적차 전축 1195 kg", () => expect(result.loaded.front_kg).toBe(1195));
  it("적차 후축 1440 kg", () => expect(result.loaded.rear_kg).toBe(1440));
  it("차량총중량 2635 kg", () => expect(result.gvw_kg).toBe(2635));

  it("공차 전축 부하율 73.7 %", () => expect(result.tire_load_rate.curb_front_pct).toBe(73.7));
  it("공차 후축 부하율 53.3 %", () => expect(result.tire_load_rate.curb_rear_pct).toBe(53.3));
  it("적차 전축 부하율 79.7 %", () => expect(result.tire_load_rate.loaded_front_pct).toBe(79.7));
  it("적차 후축 부하율 96.0 %", () => expect(result.tire_load_rate.loaded_rear_pct).toBe(96.0));
  it("GVW 적합 (2635 ≤ 2680)",  () => expect(result.legal.within_gvw).toBe(true));
});
