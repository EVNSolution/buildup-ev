/**
 * 무게계산 DB 상수 — 단일 소스.
 *
 * 설계: doc-templates/서류자동생성_변수수식_설계.md §2
 *  - 플래닝고가 주는 치수만 "변수", 나머지는 전부 "상수"(이 파일).
 *  - 이 상수들은 weight_constant 테이블로 이관되어 관리자 CRUD로 숫자만 바꾸면 재계산.
 *  - WEIGHT_CONSTANT_SEED = seed(DB 초기투입) + 프론트 번들 기본값의 단일 소스.
 *  - 백엔드 런타임은 DB rows → buildWeightConstants() 로 구조화(누락 키 있으면 throw).
 *
 * 표현: DB 테이블은 flat (key, category, value). 다층(바닥/후문)·바디별 구조는
 *   "수식의 형태"라 코드가 갖고, 각 층의 밀도·단중 등 "숫자"만 상수로 둔다.
 */

export interface WeightConstantRow {
  key: string;
  category: string;
  value: number;
  unit: string;
  description: string;
}

// ── 단일 소스 (seed + 기본값) ────────────────────────────────────────────────
export const WEIGHT_CONSTANT_SEED: WeightConstantRow[] = [
  // 2-1. 차종 기준값
  { key: 'wheelbase',        category: 'vehicle', value: 2995, unit: 'mm', description: '축간거리 WB' },
  { key: 'curb_base_front',  category: 'vehicle', value: 1105, unit: 'kg', description: '오픈베드 공차 전축' },
  { key: 'curb_base_rear',   category: 'vehicle', value: 800,  unit: 'kg', description: '오픈베드 공차 후축' },
  { key: 'curb_base',        category: 'vehicle', value: 1905, unit: 'kg', description: '오픈베드 공차중량' },
  { key: 'gvw',              category: 'vehicle', value: 2635, unit: 'kg', description: '차량총중량(적차, 불변)' },
  { key: 'gvw_limit',        category: 'vehicle', value: 2680, unit: 'kg', description: '제작허용총중량' },
  { key: 'hadae_offset',     category: 'vehicle', value: 35,   unit: 'mm', description: '하대 옵셋트' },
  { key: 'payload_step',     category: 'vehicle', value: 50,   unit: 'kg', description: '최대적재량 내림 단위' },

  // 2-2. 항목별 무게·위치 (후축까지거리)
  { key: 'deck_w',   category: 'item', value: 300,  unit: 'kg', description: '오픈베드 데크 탈거 무게(실측)' },
  { key: 'deck_d',   category: 'item', value: 35,   unit: 'mm', description: '데크 후축까지거리' },
  { key: 'reefer_w', category: 'item', value: 50,   unit: 'kg', description: '냉동기 설치 무게(탑무게와 분리)' },
  { key: 'reefer_d', category: 'item', value: -300, unit: 'mm', description: '냉동기 후축까지거리(후축 뒤쪽)' },
  { key: 'top_d',    category: 'item', value: 35,   unit: 'mm', description: '탑 후축까지거리(=offset)' },
  { key: 'crew_w',   category: 'item', value: 130,  unit: 'kg', description: '정원 1열 무게' },
  { key: 'crew_d',   category: 'item', value: 1850, unit: 'mm', description: '정원 후축까지거리(실물정답지)' },
  { key: 'cargo_d',  category: 'item', value: 35,   unit: 'mm', description: '적재 후축까지거리' },

  // 2-3. 타이어
  { key: 'tire_allow',  category: 'tire', value: 850, unit: 'kg', description: '타이어 허용하중(215/65R16)' },
  { key: 'tire_wheels', category: 'tire', value: 2,   unit: 'ea', description: '축당 바퀴수' },

  // 2-4. 탑무게 수식 상수 — 프레임(공통)
  { key: 'top.frame.steel_unit', category: 'topframe', value: 5.14, unit: 'kg/m', description: 'Main Frame(Steel) 단중' },
  { key: 'top.frame.steel_qty',  category: 'topframe', value: 2,    unit: 'ea',   description: 'Main Frame 수량' },
  { key: 'top.frame.steel_off',  category: 'topframe', value: 10,   unit: 'mm',   description: 'Main Frame 길이여백(L-off)' },
  { key: 'top.frame.al1_unit',   category: 'topframe', value: 2.33, unit: 'kg/m', description: 'Sub Bracket1(AL) 단중' },
  { key: 'top.frame.al1_qty',    category: 'topframe', value: 6,    unit: 'ea',   description: 'Sub Bracket1 수량' },
  { key: 'top.frame.al1_off',    category: 'topframe', value: 40,   unit: 'mm',   description: 'Sub Bracket1 폭여백(W-off)' },
  { key: 'top.frame.al2_unit',   category: 'topframe', value: 0.71, unit: 'kg/m', description: 'Sub Bracket2(AL) 단중' },
  { key: 'top.frame.al2_qty',    category: 'topframe', value: 2,    unit: 'ea',   description: 'Sub Bracket2 수량' },
  { key: 'top.frame.al2_off',    category: 'topframe', value: 45,   unit: 'mm',   description: 'Sub Bracket2 길이여백(L-off)' },
  { key: 'top.frame.hardware',   category: 'topframe', value: 9.3,  unit: 'kg',   description: '프레임 하드웨어 상수' },
  { key: 'top.bottom_inset_l',   category: 'topframe', value: 0.06, unit: 'm',    description: '바닥 내측 길이여백' },
  { key: 'top.bottom_inset_w',   category: 'topframe', value: 0.12, unit: 'm',    description: '바닥 내측 폭여백' },
  { key: 'top.sidedoor_width',   category: 'topframe', value: 0.85, unit: 'm',    description: '사이드도어 폭(고정)' },

  // 2-4. 탑무게 — 냉동(reefer) 바디
  { key: 'top.reefer.panel_wall',     category: 'topreefer', value: 5.22,  unit: 'kg/m2', description: '벽/천장 면적밀도' },
  { key: 'top.reefer.bottom_al',      category: 'topreefer', value: 5.2,   unit: 'kg/m2', description: '바닥 AL' },
  { key: 'top.reefer.bottom_xps',     category: 'topreefer', value: 1.146, unit: 'kg/m2', description: '바닥 XPS(냉동 전용)' },
  { key: 'top.reefer.bottom_plywood', category: 'topreefer', value: 8.0,   unit: 'kg/m2', description: '바닥 합판' },
  { key: 'top.reefer.bottom_grp',     category: 'topreefer', value: 3.0,   unit: 'kg/m2', description: '바닥 GRP(외측)' },
  { key: 'top.reefer.guard_low_side', category: 'topreefer', value: 0.884, unit: 'kg/m',  description: '가드 하부 사이드' },
  { key: 'top.reefer.guard_low_front',category: 'topreefer', value: 0.884, unit: 'kg/m',  description: '가드 하부 전면' },
  { key: 'top.reefer.guard_side',     category: 'topreefer', value: 0.904, unit: 'kg/m',  description: '가드 사이드(수직)' },
  { key: 'top.reefer.guard_top_side', category: 'topreefer', value: 0.799, unit: 'kg/m',  description: '가드 상부 사이드' },
  { key: 'top.reefer.guard_top_front',category: 'topreefer', value: 0.799, unit: 'kg/m',  description: '가드 상부 전면' },
  { key: 'top.reefer.rear_frame',     category: 'topreefer', value: 8.0,   unit: 'kg/m2', description: '후문 프레임' },
  { key: 'top.reefer.rear_outer',     category: 'topreefer', value: 9.7,   unit: 'kg/m2', description: '후문 외피' },
  { key: 'top.reefer.rear_inner',     category: 'topreefer', value: 4.3,   unit: 'kg/m2', description: '후문 내피(냉동 전용)' },
  { key: 'top.reefer.rear_parts',     category: 'topreefer', value: 15.0,  unit: 'kg',    description: '후문 부속' },
  { key: 'top.reefer.sidedoor_coef',  category: 'topreefer', value: 23.0,  unit: 'kg/m2', description: '사이드도어 면적밀도합' },
  { key: 'top.reefer.sidedoor_parts', category: 'topreefer', value: 6.0,   unit: 'kg',    description: '사이드도어 부속' },
  { key: 'top.reefer.etc',            category: 'topreefer', value: 10.0,  unit: 'kg',    description: '부대비' },
  { key: 'top.reefer.slide_per_door', category: 'topreefer', value: 10.0,  unit: 'kg',    description: '슬라이딩 가산/도어' },

  // 2-4. 탑무게 — 내장(dry) 바디 (XPS·후문내피 없음)
  { key: 'top.dry.panel_wall',     category: 'topdry', value: 5.02,  unit: 'kg/m2', description: '벽/천장 면적밀도' },
  { key: 'top.dry.bottom_al',      category: 'topdry', value: 5.2,   unit: 'kg/m2', description: '바닥 AL' },
  { key: 'top.dry.bottom_plywood', category: 'topdry', value: 8.0,   unit: 'kg/m2', description: '바닥 합판' },
  { key: 'top.dry.bottom_grp',     category: 'topdry', value: 3.0,   unit: 'kg/m2', description: '바닥 GRP(외측)' },
  { key: 'top.dry.guard_low_side', category: 'topdry', value: 0.884, unit: 'kg/m',  description: '가드 하부 사이드' },
  { key: 'top.dry.guard_low_front',category: 'topdry', value: 0.884, unit: 'kg/m',  description: '가드 하부 전면' },
  { key: 'top.dry.guard_side',     category: 'topdry', value: 0.904, unit: 'kg/m',  description: '가드 사이드(수직)' },
  { key: 'top.dry.guard_top_side', category: 'topdry', value: 0.799, unit: 'kg/m',  description: '가드 상부 사이드' },
  { key: 'top.dry.guard_top_front',category: 'topdry', value: 0.799, unit: 'kg/m',  description: '가드 상부 전면' },
  { key: 'top.dry.rear_frame',     category: 'topdry', value: 8.0,   unit: 'kg/m2', description: '후문 프레임' },
  { key: 'top.dry.rear_outer',     category: 'topdry', value: 9.7,   unit: 'kg/m2', description: '후문 외피' },
  { key: 'top.dry.rear_parts',     category: 'topdry', value: 15.0,  unit: 'kg',    description: '후문 부속' },
  { key: 'top.dry.sidedoor_coef',  category: 'topdry', value: 18.7,  unit: 'kg/m2', description: '사이드도어 면적밀도합' },
  { key: 'top.dry.sidedoor_parts', category: 'topdry', value: 6.0,   unit: 'kg',    description: '사이드도어 부속' },
  { key: 'top.dry.etc',            category: 'topdry', value: 10.0,  unit: 'kg',    description: '부대비' },
  { key: 'top.dry.slide_per_door', category: 'topdry', value: 10.0,  unit: 'kg',    description: '슬라이딩 가산/도어' },
];

// ── 구조화 타입 ──────────────────────────────────────────────────────────────
export interface GuardConst {
  lowSide: number; lowFront: number; side: number; topSide: number; topFront: number;
}
export interface TopBodyConst {
  panelWall: number;
  bottom: [number, boolean][]; // [면적밀도, 내측여부]
  guard: GuardConst;
  rear: [number, number][];    // [면적밀도, 여백m]
  rearParts: number;
  sideDoorCoef: number;
  sideDoorParts: number;
  etc: number;
  slidePerDoor: number;
}
export interface TopFrameConst {
  steelUnit: number; steelQty: number; steelOff: number;
  al1Unit: number; al1Qty: number; al1Off: number;
  al2Unit: number; al2Qty: number; al2Off: number;
  hardware: number;
}
export interface TopWeightConstants {
  frame: TopFrameConst;
  bottomInsetL_m: number;
  bottomInsetW_m: number;
  sideDoorWidth_m: number;
  reefer: TopBodyConst;
  dry: TopBodyConst;
}
export interface WeightConstants {
  wheelbase_mm: number;
  curb_base_front_kg: number;
  curb_base_rear_kg: number;
  curb_base_kg: number;
  gvw_kg: number;
  gvw_limit_kg: number;
  hadae_offset_mm: number;
  payload_step_kg: number;
  deck_w_kg: number; deck_d_mm: number;
  reefer_w_kg: number; reefer_d_mm: number;
  top_d_mm: number;
  crew_w_kg: number; crew_d_mm: number;
  cargo_d_mm: number;
  tire_allow_kg: number;
  tire_wheels: number;
  top: TopWeightConstants;
}

// ── flat rows → 구조화 (누락 키 있으면 throw) ─────────────────────────────────
function makeGet(rows: WeightConstantRow[]): (key: string) => number {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  return (key: string) => {
    const v = map.get(key);
    if (v === undefined) throw new Error(`weight_constant: 필수 상수 '${key}' 누락`);
    return v;
  };
}

function buildTopBody(g: (k: string) => number, ns: string, insetL: number, insetW: number, xps: boolean, rearInner: boolean): TopBodyConst {
  const bottom: [number, boolean][] = [[g(`${ns}.bottom_al`), true]];
  if (xps) bottom.push([g(`${ns}.bottom_xps`), true]);
  bottom.push([g(`${ns}.bottom_plywood`), true], [g(`${ns}.bottom_grp`), false]);

  const rear: [number, number][] = [[g(`${ns}.rear_frame`), 0], [g(`${ns}.rear_outer`), insetL]];
  if (rearInner) rear.push([g(`${ns}.rear_inner`), insetW]);

  return {
    panelWall: g(`${ns}.panel_wall`),
    bottom,
    guard: {
      lowSide: g(`${ns}.guard_low_side`), lowFront: g(`${ns}.guard_low_front`),
      side: g(`${ns}.guard_side`), topSide: g(`${ns}.guard_top_side`), topFront: g(`${ns}.guard_top_front`),
    },
    rear,
    rearParts: g(`${ns}.rear_parts`),
    sideDoorCoef: g(`${ns}.sidedoor_coef`),
    sideDoorParts: g(`${ns}.sidedoor_parts`),
    etc: g(`${ns}.etc`),
    slidePerDoor: g(`${ns}.slide_per_door`),
  };
}

export function buildWeightConstants(rows: WeightConstantRow[]): WeightConstants {
  const g = makeGet(rows);
  const insetL = g('top.bottom_inset_l');
  const insetW = g('top.bottom_inset_w');
  return {
    wheelbase_mm: g('wheelbase'),
    curb_base_front_kg: g('curb_base_front'),
    curb_base_rear_kg: g('curb_base_rear'),
    curb_base_kg: g('curb_base'),
    gvw_kg: g('gvw'),
    gvw_limit_kg: g('gvw_limit'),
    hadae_offset_mm: g('hadae_offset'),
    payload_step_kg: g('payload_step'),
    deck_w_kg: g('deck_w'), deck_d_mm: g('deck_d'),
    reefer_w_kg: g('reefer_w'), reefer_d_mm: g('reefer_d'),
    top_d_mm: g('top_d'),
    crew_w_kg: g('crew_w'), crew_d_mm: g('crew_d'),
    cargo_d_mm: g('cargo_d'),
    tire_allow_kg: g('tire_allow'),
    tire_wheels: g('tire_wheels'),
    top: {
      frame: {
        steelUnit: g('top.frame.steel_unit'), steelQty: g('top.frame.steel_qty'), steelOff: g('top.frame.steel_off'),
        al1Unit: g('top.frame.al1_unit'), al1Qty: g('top.frame.al1_qty'), al1Off: g('top.frame.al1_off'),
        al2Unit: g('top.frame.al2_unit'), al2Qty: g('top.frame.al2_qty'), al2Off: g('top.frame.al2_off'),
        hardware: g('top.frame.hardware'),
      },
      bottomInsetL_m: insetL,
      bottomInsetW_m: insetW,
      sideDoorWidth_m: g('top.sidedoor_width'),
      reefer: buildTopBody(g, 'top.reefer', insetL, insetW, true, true),
      dry: buildTopBody(g, 'top.dry', insetL, insetW, false, false),
    },
  };
}

/** 코드 기본값(seed 기반) — 프론트 번들·테스트 픽스처. 백엔드는 DB rows 로 override. */
export const DEFAULT_WEIGHT_CONSTANTS: WeightConstants = buildWeightConstants(WEIGHT_CONSTANT_SEED);

/**
 * 최대적재량(kg) = floor((제작허용총중량 − 차량중량_후 − 정원) / 단위) × 단위.
 * 설계문서 §4. 오픈베드: floor((2680−1905−130)/50)×50 = 600. E9721: (2680−2205−130) → 300.
 */
export function maxPayloadKg(curbWeightAfterKg: number, C: WeightConstants): number {
  const step = C.payload_step_kg;
  return Math.floor((C.gvw_limit_kg - curbWeightAfterKg - C.crew_w_kg) / step) * step;
}
