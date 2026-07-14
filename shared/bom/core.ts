/**
 * 옵션 선택 → 탈거/설치 BOM 자동 산출 (option-weights-real.json 데이터 inline)
 *
 * 좌표계: CG_x = 전축 기준 거리 (mm)
 * load-calc 입력 dist_to_rear_axle_mm = 축간거리(2995) − CG_x
 */
import type { WeightItem } from '../load-calc/types.js';
import type { BomResult } from './types.js';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const WHEELBASE_MM = 2995;
const CURB_BASE_KG = 1905;
const DECK_WEIGHT_KG = 252;
const DECK_CG_X = 3050;
const TOP_CG_X = 3050;

function cgxToRear(cg_x: number): number {
  return WHEELBASE_MM - cg_x;
}

// ── 옵션코드 → 한국어 매핑 ────────────────────────────────────────────────────

const BODY_TYPE_MAP: Record<string, string> = {
  BODY_REEFER: '냉동탑',
  BODY_DRY: '내장탑',
};

const TOP_TYPE_MAP: Record<string, string> = {
  TOP_LOW: '저상',
  TOP_STD: '표준',
};

// DOORTYPE + DOORADD → 도어구성 키 (DOOR_FOLD는 DOORADD 무관)
const DOOR_CONFIG_MAP: Record<string, string> = {
  'DOOR_SWING+ADD_NONE':   '기본_여닫이',
  'DOOR_SLIDE+ADD_NONE':   '기본_슬라이딩',
  'DOOR_SWING+ADD_DRIVER': '4도어_여닫이',
  'DOOR_SLIDE+ADD_DRIVER': '4도어_슬라이딩',
  'DOOR_FOLD':             '양문미닫이',
};

// ── 탑 설치 데이터 (option-weights-real.json 탑_설치) ─────────────────────────

const TOP_DATA: Record<string, Record<string, Record<string, { 무게: number; 최대적재량_kg: number }>>> = {
  냉동탑: {
    저상: {
      기본_여닫이:    { 무게: 396.7, 최대적재량_kg: 500 },
      기본_슬라이딩:  { 무게: 406.7, 최대적재량_kg: 500 },
      '4도어_여닫이': { 무게: 428.0, 최대적재량_kg: 440 },
      '4도어_슬라이딩': { 무게: 448.0, 최대적재량_kg: 420 },
    },
    표준: {
      기본_여닫이:    { 무게: 426.4, 최대적재량_kg: 440 },
      기본_슬라이딩:  { 무게: 436.4, 최대적재량_kg: 430 },
      '4도어_여닫이': { 무게: 463.5, 최대적재량_kg: 400 },
      '4도어_슬라이딩': { 무게: 483.5, 최대적재량_kg: 390 },
    },
  },
  내장탑: {
    저상: {
      기본_여닫이:    { 무게: 315.2, 최대적재량_kg: 550 },
      기본_슬라이딩:  { 무게: 325.2, 최대적재량_kg: 550 },
      '4도어_여닫이': { 무게: 341.7, 최대적재량_kg: 500 },
      '4도어_슬라이딩': { 무게: 361.7, 최대적재량_kg: 500 },
      양문미닫이:     { 무게: 435.8, 최대적재량_kg: 400 },
    },
    표준: {
      기본_여닫이:    { 무게: 341.0, 최대적재량_kg: 500 },
      기본_슬라이딩:  { 무게: 351.0, 최대적재량_kg: 500 },
      '4도어_여닫이': { 무게: 372.2, 최대적재량_kg: 500 },
      '4도어_슬라이딩': { 무게: 392.2, 최대적재량_kg: 500 },
      양문미닫이:     { 무게: 449.1, 최대적재량_kg: 400 },
    },
  },
};

// ── 개별 옵션 데이터 (option-weights-real.json 개별_옵션_항목) ─────────────────

interface IndivOpt {
  명칭: string;
  무게: number;
  무게계산_포함: boolean;
  CG_x?: number;
}

// 출처: doc-templates/option-weights-real.json 개별_옵션_항목 (전 항목 무게계산_포함=false, 사용자 결정 2026-07)
const INDIV_OPTS: Record<string, IndivOpt> = {
  TEMP_O:      { 명칭: '온도기록계',     무게: 0,  무게계산_포함: false },
  PART_NET:    { 명칭: '격벽(그물망)',   무게: 0,  무게계산_포함: false },
  PART_REEFER: { 명칭: '격벽(냉동격벽)', 무게: 0,  무게계산_포함: false },
  SPOILER_O:   { 명칭: '스포일러',       무게: 0,  무게계산_포함: false },
  DECAL_O:     { 명칭: '데칼',           무게: 5,  무게계산_포함: false },
  TINT_O:      { 명칭: '썬팅',           무게: 3,  무게계산_포함: false },
  BLACKBOX_O:  { 명칭: '블랙박스',       무게: 1,  무게계산_포함: false },
  SUPPLYKIT_O: { 명칭: '지급품 키트',    무게: 10, 무게계산_포함: false },
};

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 주문 옵션 선택값(groupCode → valueCode)으로 BOM 자동 산출.
 * BODYTYPE·TOP·DOORTYPE 미선택 시 null 반환.
 */
export function calcBom(selections: Record<string, string>): BomResult | null {
  const bodyCode = selections['BODYTYPE'];
  const topCode  = selections['TOP'];
  const doorCode = selections['DOORTYPE'];
  const addCode  = selections['DOORADD'] ?? 'ADD_NONE';

  if (!bodyCode || !topCode || !doorCode) return null;

  const bodyType = BODY_TYPE_MAP[bodyCode];
  const topType  = TOP_TYPE_MAP[topCode];
  if (!bodyType || !topType) return null;

  const doorKey    = doorCode === 'DOOR_FOLD' ? 'DOOR_FOLD' : `${doorCode}+${addCode}`;
  const doorConfig = DOOR_CONFIG_MAP[doorKey];
  if (!doorConfig) return null;

  const topEntry = TOP_DATA[bodyType]?.[topType]?.[doorConfig];
  if (!topEntry) return null;

  // 탈거
  const removeItems = [
    { label: '오픈베드 데크(적재함)', weight_kg: DECK_WEIGHT_KG, cg_x_mm: DECK_CG_X },
  ];

  // 설치 (탑)
  const installItems = [
    { label: `${bodyType}(${topType}) 완성`, weight_kg: topEntry.무게, cg_x_mm: TOP_CG_X },
  ];

  // 개별 옵션 처리
  const selectedValues = new Set(Object.values(selections));
  const extraLabels: string[] = [];

  for (const [valueCode, opt] of Object.entries(INDIV_OPTS)) {
    if (!selectedValues.has(valueCode)) continue;
    if (opt.무게계산_포함 && opt.CG_x !== undefined) {
      installItems.push({ label: opt.명칭, weight_kg: opt.무게, cg_x_mm: opt.CG_x });
    } else if (!opt.무게계산_포함) {
      extraLabels.push(opt.명칭);
    }
  }

  const removeTotal  = removeItems.reduce((s, i) => s + i.weight_kg, 0);
  const installTotal = installItems.reduce((s, i) => s + i.weight_kg, 0);

  const toWeightItem = (i: { weight_kg: number; cg_x_mm: number }): WeightItem => ({
    weight_kg:            i.weight_kg,
    dist_to_rear_axle_mm: cgxToRear(i.cg_x_mm),
  });

  const extraStr = extraLabels.length ? `, ${extraLabels.join('·')} 추가` : '';
  const tuning   = `오픈베드 데크 탈거 후 ${bodyType}(${topType}, ${doorConfig}) 설치${extraStr}`;

  return {
    body_type:             bodyType,
    top_type:              topType,
    door_config:           doorConfig,
    remove_items:          removeItems,
    install_items:         installItems,
    extra_option_labels:   extraLabels,
    curb_weight_after_kg:  CURB_BASE_KG - removeTotal + installTotal,
    max_payload_kg:        topEntry.최대적재량_kg,
    tuning_summary:        tuning,
    remove_weight_items:   removeItems.map(toWeightItem),
    install_weight_items:  installItems.map(toWeightItem),
  };
}
