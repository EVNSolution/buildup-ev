/**
 * 옵션 선택 → 탈거/설치 BOM 자동 산출.
 * 무게·CG_x 값은 전부 doc-templates/option-weights-real.json 을 런타임에 읽어서 사용한다
 * (코드에 하드코딩 금지 — 두 소스가 어긋나면 조용히 넘어가지 않고 throw).
 *
 * 좌표계: CG_x = 전축 기준 거리 (mm)
 * load-calc 입력 dist_to_rear_axle_mm = 축간거리(2995) − CG_x
 */
// 무게·CG 단일소스. 정적 import 로 번들에 포함 — 프론트(vite 브라우저)·백엔드(tsx) 양쪽에서
// 동작(과거 node:fs readFileSync 는 브라우저 번들을 깨뜨려 프론트 빌드 실패의 원인이었음).
import BOM_SOURCE_JSON from '../../doc-templates/option-weights-real.json';
import type { WeightItem } from '../load-calc/types.js';
import type { BomResult } from './types.js';

const WHEELBASE_MM = 2995;
const CURB_BASE_KG = 1905;

function cgxToRear(cg_x: number): number {
  return WHEELBASE_MM - cg_x;
}

// ── option-weights-real.json 단일소스 로드 ────────────────────────────────────

interface TopEntry {
  무게: number;
  최대적재량_kg: number;
}
interface TopCategory {
  _적재함유형코드: string;
  CG_x_전축기준_mm: number;
  [topType: string]: unknown; // 저상/표준 → Record<도어구성키, TopEntry>
}
interface RemoveEntry {
  명칭: string;
  무게_저상: number;
  무게_표준: number;
  CG_x_전축기준_mm: number;
}
interface IndivOptEntry {
  명칭: string;
  무게: number;
  무게계산_포함: boolean;
  CG_x_전축기준_mm?: number;
}
interface BomSource {
  기본_탈거: RemoveEntry[];
  탑_설치: Record<string, TopCategory>;
  개별_옵션_항목: Record<string, IndivOptEntry>;
}

function loadBomSource(): BomSource {
  const raw = BOM_SOURCE_JSON as unknown as Record<string, unknown>;
  if (!Array.isArray(raw['기본_탈거']) || (raw['기본_탈거'] as unknown[]).length === 0) {
    throw new Error('option-weights-real.json: 기본_탈거 섹션이 없거나 비어있습니다');
  }
  if (!raw['탑_설치'] || typeof raw['탑_설치'] !== 'object') {
    throw new Error('option-weights-real.json: 탑_설치 섹션이 없습니다');
  }
  if (!raw['개별_옵션_항목'] || typeof raw['개별_옵션_항목'] !== 'object') {
    throw new Error('option-weights-real.json: 개별_옵션_항목 섹션이 없습니다');
  }
  return raw as unknown as BomSource;
}

const SRC = loadBomSource();

// ── 옵션코드 ↔ BOM 한글 키 매핑 (코드 사전 — 값은 전부 위 SRC 에서 읽음) ─────────
// 탑종류코드는 JSON의 _적재함유형코드에서 역매핑(단일소스), TOP/DOOR 코드사전은
// 앱 옵션코드 체계 ↔ BOM 한글키 간 고정 번역표라 자주 바뀌지 않아 코드에 둠.

const BODY_TYPE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(SRC.탑_설치).map(([korName, cat]) => [cat._적재함유형코드, korName])
);

const TOP_TYPE_MAP: Record<string, string> = {
  TOP_LOW: '저상',
  TOP_STD: '표준',
};

// DOORTYPE + DOORADD → 도어구성 키 (양문/쿠팡미닫이는 DOORADD 무관, 내장 전용)
// DOOR_COUPANG(쿠팡미닫이) = 양문미닫이 동일 상품 — 내장탑에서만 유효.
const DOOR_CONFIG_MAP: Record<string, string> = {
  'DOOR_SWING+ADD_NONE':   '기본_여닫이',
  'DOOR_SLIDE+ADD_NONE':   '기본_슬라이딩',
  'DOOR_SWING+ADD_DRIVER': '4도어_여닫이',
  'DOOR_SLIDE+ADD_DRIVER': '4도어_슬라이딩',
  'DOOR_FOLD':             '양문미닫이',
  'DOOR_COUPANG':          '양문미닫이',
};

// ── 공개 API ──────────────────────────────────────────────────────────────────

/**
 * 주문 옵션 선택값(groupCode → valueCode)으로 BOM 자동 산출.
 * BODYTYPE·TOP·DOORTYPE 미선택이거나 유효하지 않은 조합(예: 냉동탑+양문미닫이)이면 null 반환.
 * option-weights-real.json 구조 자체가 깨져있으면(무게계산_포함=true인데 CG_x 누락 등) throw.
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

  const doorKey    = (doorCode === 'DOOR_FOLD' || doorCode === 'DOOR_COUPANG') ? doorCode : `${doorCode}+${addCode}`;
  const doorConfig = DOOR_CONFIG_MAP[doorKey];
  if (!doorConfig) return null;

  const topCategory = SRC.탑_설치[bodyType];
  if (!topCategory) throw new Error(`option-weights-real.json: 탑_설치.${bodyType} 없음`);

  const topTypeEntries = topCategory[topType] as Record<string, TopEntry> | undefined;
  const topEntry = topTypeEntries?.[doorConfig];
  if (!topEntry) return null; // 조합 자체가 존재하지 않음(옵션 제약 위반) — 정상 케이스

  const topCgX = topCategory.CG_x_전축기준_mm;

  // 탈거: 기본_탈거[0](오픈베드 데크) — topType(저상/표준)별 무게 선택
  // TODO(정확도): 무게_저상/무게_표준(252kg)은 역산 추정값(option-weights-real.json 기본_탈거._주 참조).
  //   실측 무게 확보 전까지 '구조변경 후' 계산 결과를 최종 서류로 신뢰하지 말 것.
  const deck = SRC.기본_탈거[0]!;
  const deckWeight = topType === '저상' ? deck.무게_저상 : deck.무게_표준;
  const removeItems = [
    { label: deck.명칭, weight_kg: deckWeight, cg_x_mm: deck.CG_x_전축기준_mm },
  ];

  // 설치: 탑 완성무게 (개별 옵션은 전부 무게계산_포함=false → 아래에서 서류표기 라벨만 추가)
  const installItems = [
    { label: `${bodyType}(${topType}) 완성`, weight_kg: topEntry.무게, cg_x_mm: topCgX },
  ];

  // 개별 옵션: 무게계산_포함=true 인 것만 install에 반영, false는 서류 표기용 라벨만
  const selectedValues = new Set(Object.values(selections));
  const extraLabels: string[] = [];
  for (const [valueCode, opt] of Object.entries(SRC.개별_옵션_항목)) {
    if (!selectedValues.has(valueCode)) continue;
    if (opt.무게계산_포함) {
      if (opt.CG_x_전축기준_mm === undefined) {
        throw new Error(
          `option-weights-real.json: 개별_옵션_항목.${valueCode} 는 무게계산_포함=true인데 CG_x_전축기준_mm 누락`
        );
      }
      installItems.push({ label: opt.명칭, weight_kg: opt.무게, cg_x_mm: opt.CG_x_전축기준_mm });
    } else {
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
