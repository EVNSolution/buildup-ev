/**
 * 화면 금액을 만든 입력을 **저장 요청의 필드 이름으로** 옮긴다.
 *
 * 이 파일이 있는 이유 — 화면 계산(`buildLiveTotal`)은 카멜케이스 상태를 쓰고
 * 저장 요청과 DB 는 스네이크케이스를 쓴다. 두 이름을 저장 함수에서 손으로 옮겨 적다가
 * 하나를 빠뜨리면 **화면에는 반영됐는데 저장된 견적에는 없는** 상태가 된다.
 * 계산 테스트는 이걸 못 잡는다 — 계산은 멀쩡하고 값이 거기까지 가지 못한 것뿐이라
 * 실제로 프로모션이 통째로 사라진 채 배포됐다(#182).
 *
 * 그래서 옮기는 일을 한 곳에 모으고, 항목이 늘면 컴파일이 막도록 한다.
 * 저장 함수는 이 결과를 펼쳐 넣기만 한다.
 */

/** 저장 요청·DB inputs 에 들어가는 이름 그대로. */
export interface QuotePriceExtras {
  /** 프로모션: 0원 처리할 특장옵션 그룹코드 */
  promotion_zeroed: string[];
  /** 프로모션: 금액 할인(원, VAT 포함) — 특장 가격에서 뺀다 */
  promotion_discount: number;
  /** 지방보조금 미적용(예산 소진 — 이 견적에만) */
  local_subsidy_off: boolean;
}

/** 영업 화면이 들고 있는 상태 그대로. */
export interface QuotePriceExtrasState {
  promotionZeroed: Iterable<string>;
  promotionDiscount: number;
  localSubsidyOff: boolean;
}

/**
 * ⚠️ **금액을 바꾸는 입력을 새로 만들면 여기에도 넣어야 한다.**
 * `QuotePriceExtras` 에 항목을 더하면 이 함수와 quote-request.test.ts 의
 * 완전성 검사가 함께 깨진다 — 저장에서 빠뜨린 채 배포되는 걸 그때 막는다.
 */
export function quotePriceExtras(s: QuotePriceExtrasState): QuotePriceExtras {
  return {
    promotion_zeroed: [...s.promotionZeroed],
    // 음수·소수·NaN 이 그대로 저장되지 않게 한다(서버도 같은 방어를 한다)
    promotion_discount: Math.max(0, Math.round(s.promotionDiscount) || 0),
    local_subsidy_off: s.localSubsidyOff,
  };
}
