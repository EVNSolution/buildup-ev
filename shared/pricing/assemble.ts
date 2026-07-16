/**
 * 옵션 선택값 → 견적 입력(trim_price, option_sum) 조립.
 * 옵션DB 복합키(탑 높이 종속)를 value_code 세분화 코드로 조회 — 백엔드 라우트·프론트 실시간계산 공용.
 * (쿠팡→EV미닫이, 스포일러 저상 등은 시드(option_price) 단계에서 반영됨)
 */

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

/** selections + 가격조회함수 → { trim_price, option_sum } (견적서 D13, D15:D20) */
export function assembleOptionSum(
  sel: Record<string, string>,
  price: (code: string) => number,
): { trim_price: number; option_sum: number } {
  const body = BODY[sel['BODYTYPE'] ?? ''] ?? '';
  const top  = TOP[sel['TOP'] ?? ''] ?? '';
  const door = DOOR[sel['DOORTYPE'] ?? ''] ?? '';
  const partKind = PART[sel['PARTITION'] ?? ''] ?? '';

  const topPrice  = body && top ? price(`TOP_${body}_${top}`) : 0;                  // 탑 D15
  const doorOpt   = body && top && door ? price(`DOPT_${body}_${top}_${door}`) : 0; // 도어옵션 D17
  const doorAdd   = sel['DOORADD'] === 'ADD_DRIVER' && body && top && door
    ? price(`DADD_${body}_${top}_${door}`) : 0;                                     // 도어추가 D18
  const spoiler   = sel['SPOILER'] === 'SPOILER_O' && top ? price(`SPL_${top}`) : 0; // 스포일러 D16
  const partition = partKind && top ? price(`PART_${top}_${partKind}`) : 0;         // 격벽 D20
  const temp      = sel['TEMP'] === 'TEMP_O' ? price('TEMP_O') : 0;                  // 온도기록계 D19

  return {
    trim_price: price(sel['TRIM'] ?? ''),
    option_sum: topPrice + doorOpt + doorAdd + spoiler + partition + temp,
  };
}
