import type {
  LoadCalcInput,
  LoadCalcResult,
  WeightItem,
  DimensionLimit,
  ActualDimension,
} from "./types.js";

// ── 내부 유틸 ────────────────────────────────────────────────────────────────

/** 전축 분담 = W × a / L  (a = 후축까지거리, L = 축간거리) */
function frontShare(item: WeightItem, wheelbase_mm: number): number {
  return (item.weight_kg * item.dist_to_rear_axle_mm) / wheelbase_mm;
}

/** 5kg 단위 올림 (cyberts TS튜닝알리고 방식)
 *  ceil5(72.12) = 75, ceil5(0) = 0, ceil5(-10.5) = -10 */
function ceil5(kg: number): number {
  return Math.ceil(kg / 5) * 5;
}

function sumWeights(items: WeightItem[]): number {
  return items.reduce((s, it) => s + it.weight_kg, 0);
}

function sumFrontShares(items: WeightItem[], L: number): number {
  return items.reduce((s, it) => s + frontShare(it, L), 0);
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function checkDimensions(
  limit: DimensionLimit | undefined,
  actual: ActualDimension | undefined
): boolean {
  if (!limit || !actual) return true;
  if (limit.max_length_mm !== undefined && actual.length_mm !== undefined) {
    if (actual.length_mm > limit.max_length_mm) return false;
  }
  if (limit.max_width_mm !== undefined && actual.width_mm !== undefined) {
    if (actual.width_mm > limit.max_width_mm) return false;
  }
  if (limit.max_height_mm !== undefined && actual.height_mm !== undefined) {
    if (actual.height_mm > limit.max_height_mm) return false;
  }
  return true;
}

// ── 공개 API ─────────────────────────────────────────────────────────────────

/**
 * 하중계산 코어.
 *
 * 무게값은 호출자가 제공 (BOM 연산 결과 또는 수동입력).
 * 이 함수는 순수 함수 — 같은 입력이면 항상 같은 결과.
 */
export function calcLoad(input: LoadCalcInput): LoadCalcResult {
  const L = input.wheelbase_mm;
  const install = input.install_items ?? [];
  const remove = input.remove_items ?? [];
  const crew = input.crew_items ?? [];

  // ── 1. 공차 변경후 ────────────────────────────────────────────────────────
  // 설치·탈거 전축 순기여(raw) → 5kg 올림
  const netInstallFrontRaw = sumFrontShares(install, L) - sumFrontShares(remove, L);
  const netInstallWeight = sumWeights(install) - sumWeights(remove);

  const curbFront = input.curb_axle_front_kg + ceil5(netInstallFrontRaw);
  const curbTotalWeight =
    input.curb_axle_front_kg + input.curb_axle_rear_kg + netInstallWeight;
  const curbRear = curbTotalWeight - curbFront;

  // ── 2. 적차 변경후 ────────────────────────────────────────────────────────
  // 적재·정원 전축 기여(raw) → 5kg 올림
  const loadedFrontRaw =
    (input.cargo ? frontShare(input.cargo, L) : 0) +
    sumFrontShares(crew, L);

  const additionalWeight =
    (input.cargo?.weight_kg ?? 0) + sumWeights(crew);

  const loadedFront = curbFront + ceil5(loadedFrontRaw);
  const gvw = curbTotalWeight + additionalWeight;
  const loadedRear = gvw - loadedFront;

  // ── 3. 타이어 부하율 ──────────────────────────────────────────────────────
  const capFront =
    input.tire_front.allowable_load_kg * input.tire_front.wheels;
  const capRear =
    input.tire_rear.allowable_load_kg * input.tire_rear.wheels;

  const tireLoadRate = {
    curb_front_pct: round1((curbFront / capFront) * 100),
    curb_rear_pct: round1((curbRear / capRear) * 100),
    loaded_front_pct: round1((loadedFront / capFront) * 100),
    loaded_rear_pct: round1((loadedRear / capRear) * 100),
  };

  // ── 4. 조향륜 하중분포율 ─────────────────────────────────────────────────
  const steeringRatio = round1((loadedFront / gvw) * 100);

  // ── 5. 법규 체크 ─────────────────────────────────────────────────────────
  const withinGvw =
    input.gvw_limit_kg !== undefined ? gvw <= input.gvw_limit_kg : true;
  const withinDimensions = checkDimensions(
    input.dimension_limit,
    input.actual_dimension
  );

  return {
    curb: { front_kg: curbFront, rear_kg: curbRear },
    loaded: { front_kg: loadedFront, rear_kg: loadedRear },
    gvw_kg: gvw,
    tire_load_rate: tireLoadRate,
    steering_axle_ratio_pct: steeringRatio,
    legal: {
      within_gvw: withinGvw,
      within_dimensions: withinDimensions,
      compliant: withinGvw && withinDimensions,
    },
  };
}
