/** 무게 항목 하나 (설치·탈거·정원·적재 공통) */
export interface WeightItem {
  weight_kg: number;
  /** 후축까지거리 (mm). 후축보다 뒤쪽이면 음수. */
  dist_to_rear_axle_mm: number;
}

export interface TireConfig {
  allowable_load_kg: number;
  wheels: number;
}

export interface DimensionLimit {
  max_length_mm?: number;
  max_width_mm?: number;
  max_height_mm?: number;
}

export interface ActualDimension {
  length_mm?: number;
  width_mm?: number;
  height_mm?: number;
}

export interface LoadCalcInput {
  // ── 공차 축하중 (측정값 또는 차종마스터) ──────────────────
  curb_axle_front_kg: number;
  curb_axle_rear_kg: number;

  // ── 차량 제원 ────────────────────────────────────────────
  wheelbase_mm: number;

  // ── 타이어 (전·후 개별) ──────────────────────────────────
  tire_front: TireConfig;
  tire_rear: TireConfig;

  // ── 설치/탈거 (공차 변경분, 무게 출처: BOM 또는 수동입력) ──
  install_items?: WeightItem[];
  remove_items?: WeightItem[];

  // ── 적재 화물 (무게중심 ~ 후축 거리 = 하대옵셋트) ─────────
  cargo?: WeightItem;

  // ── 승차정원 (좌석별) ─────────────────────────────────────
  crew_items?: WeightItem[];

  // ── 법규 체크 (없으면 체크 생략) ─────────────────────────
  gvw_limit_kg?: number;
  dimension_limit?: DimensionLimit;
  actual_dimension?: ActualDimension;
}

export interface AxleLoads {
  front_kg: number;
  rear_kg: number;
}

export interface TireLoadRate {
  curb_front_pct: number;
  curb_rear_pct: number;
  loaded_front_pct: number;
  loaded_rear_pct: number;
}

export interface LegalCheck {
  within_gvw: boolean;
  within_dimensions: boolean;
  compliant: boolean;
}

export interface LoadCalcResult {
  /** 공차 축하중 (설치·탈거 반영 후) */
  curb: AxleLoads;
  /** 적차 축하중 (공차 + 적재 + 정원) */
  loaded: AxleLoads;
  /** 차량총중량 kg */
  gvw_kg: number;
  /** 타이어 부하율 (%) */
  tire_load_rate: TireLoadRate;
  /** 조향륜 하중분포율 (%) */
  steering_axle_ratio_pct: number;
  /** 법규 적합 여부 */
  legal: LegalCheck;
}
