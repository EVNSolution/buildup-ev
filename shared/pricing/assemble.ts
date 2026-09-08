/**
 * 옵션 선택값 → 견적 입력(trim_price, option_sum) 조립.
 * 옵션DB 복합키(탑 높이 종속)를 value_code 세분화 코드로 조회 — 백엔드 라우트·프론트 실시간계산 공용.
 * (쿠팡→EV미닫이, 스포일러 저상 등은 시드(option_price) 단계에서 반영됨)
 */

import { customOptionsSupplySum, type CustomOption } from './custom-options.js';

/** 택배업 보조금율 (국고 대비) — 견적서 D31 */
export const TAKBAE_RATE = 0.1;
/** 경유차 유지 후 전기차 전환 보조금 (음수) — 견적서 D30 */
export const DIESEL_CONVERSION_SUBSIDY = -500_000;

const BODY: Record<string, string> = { BODY_REEFER: 'REEFER', BODY_DRY: 'DRY' };
const TOP:  Record<string, string> = { TOP_LOW: 'LOW', TOP_STD: 'STD' };
const DOOR: Record<string, string> = {
  DOOR_SWING: 'SWING', DOOR_SLIDE: 'SLIDE', DOOR_EVSLIDE: 'EVSLIDE', DOOR_COUPANG: 'COUPANG',
};
const PART: Record<string, string> = { PART_NET: 'NET', PART_REEFER: 'MOVE' };

/**
 * 단가 조회기 — **없는 단가와 0원을 구분한다.**
 *
 * ⚠️ 예전에는 `map[code] ?? 0` 이었다. 단가표에 **행이 없는** 사양도 0원으로 계산돼
 *    견적이 그대로 나갔다. 실제로 미닫이(`DOPT_*_COUPANG`)와 저상 스포일러(`SPL_LOW`)는
 *    운영 DB 에 행이 없어, 고르면 그 값이 **0원으로 고객에게 나가고 있었다.**
 *
 *    0원과 「정해지지 않음」은 다른 말이다. 0원은 0으로 **정해 둔 것**이고(계약상 무상 등),
 *    행이 없는 것은 **아직 아무도 값을 정하지 않은 것**이다. 앞은 팔 수 있고 뒤는 팔 수 없다.
 *
 * 조회한 것 중 행이 없던 코드를 `missing` 에 모은다. 화면과 서버가 **같은 함수**를 쓴다 —
 * 한쪽만 막으면 「화면엔 금액이 보이는데 저장은 거부되는」 견적이 된다.
 */
export function makePriceLookup(map: Record<string, number>): {
  price: (code: string) => number;
  missing: string[];
} {
  const missing: string[] = [];
  const price = (code: string): number => {
    // 고르지 않은 항목은 조회 자체가 아니다 — 빈 코드로 들어온다
    if (!code) return 0;
    const v = map[code];
    if (v === undefined) {
      if (!missing.includes(code)) missing.push(code);
      return 0;
    }
    return v;
  };
  return { price, missing };
}

/**
 * 단가 복합코드가 **어느 문항에서 나왔는지** — 사람에게 무엇이 미책정인지 말하려면 필요하다.
 * 「DOPT_REEFER_LOW_COUPANG 단가 없음」은 영업이 읽고 고칠 수 없는 말이다.
 */
export function groupOfPriceCode(code: string): string {
  if (code.startsWith('TOP_'))  return 'TOP';
  if (code.startsWith('DOPT_')) return 'DOORTYPE';
  if (code.startsWith('DADD_')) return 'DOORADD';
  if (code.startsWith('PART_')) return 'PARTITION';
  if (code.startsWith('SPL_'))  return 'SPOILER';
  if (code === 'TEMP_O')        return 'TEMP';
  return 'TRIM';
}

/**
 * 개별 옵션값의 '자체 공급단가'(부가세 별도). 표시용 — ×1.1 하면 부가세 포함가.
 * 탑 높이 종속 옵션은 현재 선택(body/top)을 반영해 복합코드로 조회.
 */
export function valueUnitPrice(
  groupCode: string, valueCode: string,
  sel: Record<string, string>, price: (code: string) => number,
): number {
  const body = BODY[sel['BODYTYPE'] ?? ''] ?? '';
  const top  = TOP[sel['TOP'] ?? ''] ?? '';
  switch (groupCode) {
    case 'TRIM': return price(valueCode);
    case 'TOP': { const t = TOP[valueCode] ?? ''; return body && t ? price(`TOP_${body}_${t}`) : 0; }
    case 'DOORTYPE': { const d = DOOR[valueCode] ?? ''; return body && top && d ? price(`DOPT_${body}_${top}_${d}`) : 0; }
    case 'SPOILER': return valueCode === 'SPOILER_O' && top ? price(`SPL_${top}`) : 0;
    case 'PARTITION': { const k = PART[valueCode] ?? ''; return k && top ? price(`PART_${top}_${k}`) : 0; }
    case 'TEMP': return valueCode === 'TEMP_O' ? price('TEMP_O') : 0;
    default: return 0;
  }
}

/** 도어추가(운전석측) 단가 — 도어종류별. 부가세 별도. */
export function doorAddUnitPrice(
  doorTypeCode: string, sel: Record<string, string>, price: (code: string) => number,
): number {
  const body = BODY[sel['BODYTYPE'] ?? ''] ?? '';
  const top  = TOP[sel['TOP'] ?? ''] ?? '';
  const d = DOOR[doorTypeCode] ?? '';
  return body && top && d ? price(`DADD_${body}_${top}_${d}`) : 0;
}

/**
 * 특장 옵션 그룹별 '자체 공급단가' 분해 (견적서 D15:D20). 부가세 별도.
 * assembleOptionSum(합계) + 프로모션(0원 처리 항목) 계산이 공유.
 * key = 옵션그룹코드(TOP/SPOILER/DOORTYPE/DOORADD/TEMP/PARTITION).
 */
export function optionBreakdown(
  sel: Record<string, string>,
  price: (code: string) => number,
  zeroed?: readonly string[],
): Record<string, number> {
  const body = BODY[sel['BODYTYPE'] ?? ''] ?? '';
  const top  = TOP[sel['TOP'] ?? ''] ?? '';
  const door = DOOR[sel['DOORTYPE'] ?? ''] ?? '';
  const partKind = PART[sel['PARTITION'] ?? ''] ?? '';

  const bd: Record<string, number> = {
    TOP:       body && top ? price(`TOP_${body}_${top}`) : 0,                    // 탑 D15
    SPOILER:   sel['SPOILER'] === 'SPOILER_O' && top ? price(`SPL_${top}`) : 0,  // 스포일러 D16
    DOORTYPE:  body && top && door ? price(`DOPT_${body}_${top}_${door}`) : 0,   // 도어옵션 D17
    DOORADD:   sel['DOORADD'] === 'ADD_DRIVER' && body && top && door
      ? price(`DADD_${body}_${top}_${door}`) : 0,                               // 도어추가 D18
    TEMP:      sel['TEMP'] === 'TEMP_O' ? price('TEMP_O') : 0,                   // 온도기록계 D19
    PARTITION: partKind && top ? price(`PART_${top}_${partKind}`) : 0,          // 격벽 D20
  };
  // 영업 재량할인(프로모션): 선택은 유지하되 가격만 0 — 모든 계산·표시 경로가 이 결과를 공유한다.
  for (const g of zeroed ?? []) if (g in bd) bd[g] = 0;
  return bd;
}

/**
 * selections + 가격조회함수 → { trim_price, option_sum } (견적서 D13, D15:D20)
 * zeroed = 재량할인으로 0원 처리할 옵션그룹코드(TOP/DOORTYPE/…).
 *
 * ⚠️ `custom` 은 **필수 인자**다. 단가표에 없는 사양을 영업이 직접 적어 넣는 줄인데,
 *    빠뜨리면 화면에는 금액이 보이는데 저장·서류에서만 조용히 빠진다. 없으면 `[]` 를
 *    넘겨 「없다」를 분명히 적는다 — 타입이 모든 호출부에서 한 번씩 묻게 한다.
 */
export function assembleOptionSum(
  sel: Record<string, string>,
  price: (code: string) => number,
  zeroed: readonly string[] | undefined,
  custom: readonly CustomOption[],
): { trim_price: number; option_sum: number } {
  const bd = optionBreakdown(sel, price, zeroed);
  return {
    trim_price: price(sel['TRIM'] ?? ''),
    option_sum: Object.values(bd).reduce((a, b) => a + b, 0) + customOptionsSupplySum(custom),
  };
}
