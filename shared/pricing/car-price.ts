/**
 * 차량 가격(VAT 포함) 결정 — **트림 단가에서 뽑을지, 영업이 적어 넣은 값을 쓸지.**
 *
 * 상담 자리에서 트림 단가와 다른 금액으로 파는 경우가 있다(특판·재고차 등).
 * 그때 영업이 차량 가격을 직접 적을 수 있게 하되, **적지 않으면 트림 단가를 그대로 쓴다.**
 *
 * 넣은 값은 car_price 를 통째로 대체한다 — 취득세·부가세 환급·실구매가가
 * 전부 이 금액을 따라 움직인다(입력한 대로 계산되어야 상담이 성립한다).
 *
 * ⚠️ 판정은 `!= null` 이다(`!== undefined` 가 아니다).
 *    직접 입력을 끄면 화면이 `car_price_override: null` 을 보내 저장값을 지운다.
 *    `!== undefined` 로 보면 그 `null` 이 「0원으로 정했다」로 읽혀 **차량가가 0원**이 된다.
 *    선수금에서 똑같은 실수를 두 번 했다 — 여기서는 처음부터 막는다.
 */

/** 트림 단가는 **공급가**로 저장된다 — 화면·견적서는 VAT 포함으로 쓴다 */
export function trimPriceVatIncluded(trimSupplyPrice: number): number {
  return Math.round(trimSupplyPrice * 1.1);
}

/**
 * @param trimSupplyPrice 트림 단가(공급가)
 * @param override        영업이 적어 넣은 차량 가격(VAT 포함). 비었으면 `null`/`undefined`
 */
export function resolveCarPrice(trimSupplyPrice: number, override?: number | null): number {
  if (override != null && Number.isFinite(override)) return Math.max(0, Math.round(override));
  return trimPriceVatIncluded(trimSupplyPrice);
}

/** 직접 입력한 트림명의 최대 길이 — 견적서 한 줄에 들어가야 한다 */
export const CAR_TRIM_LABEL_MAX = 40;

/**
 * 견적서에 적을 트림명.
 *
 * 차량 가격을 직접 적어 넣는 상담은 **트림도 단가표와 다른 경우가 많다**(특판·재고차).
 * 그때 「플러스(Plus)」처럼 고른 값이 그대로 나가면 서류가 실제와 다른 차를 가리킨다.
 * 그래서 직접 입력한 텍스트가 있으면 그것을 쓴다.
 *
 * ⚠️ **직접 입력을 켰을 때만** 쓴다. 끄면 고른 트림명으로 돌아가야 한다 —
 *    남아 있던 텍스트가 계속 서류에 찍히면 무엇이 진짜인지 알 수 없다.
 */
export function resolveTrimLabel(
  selectedTrimName: string,
  override: string | null | undefined,
  /** 차량 가격 직접 입력을 켰는가 */
  overrideOn: boolean,
): string {
  if (!overrideOn) return selectedTrimName;
  const t = (override ?? '').trim();
  return t === '' ? selectedTrimName : t.slice(0, CAR_TRIM_LABEL_MAX);
}
