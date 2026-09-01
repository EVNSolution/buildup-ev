/**
 * 부가세 환급 대상 판정 — **사업자 구분 하나로 정해진다.**
 *
 * 환급을 못 받는 쪽:
 *   · `consumer`   일반구매자(비사업자) — 매입세액공제 자체가 없다
 *   · `simplified` 간이과세자 — 세금계산서로 매입세액을 돌려받지 못한다
 *
 * ⚠️ 이 판정을 호출부에서 `biz === 'consumer'` 처럼 다시 쓰지 말 것.
 *    실제로 그렇게 두 곳(서버·화면)에 흩어져 있었고, 간이과세자를 넣을 때
 *    **양쪽 모두 빠뜨려 간이과세자가 환급을 받았다.** 규칙은 여기 한 곳에만 둔다.
 *    (Ver1.21 엔진 calcPrice 는 간이과세자의 `vat` 자체를 0으로 잡아 같은 결론에 닿는다.)
 */
import type { BizType } from './types.js';

/** 부가세 환급 대상이 아닌 사업자 구분 */
export const NO_VAT_REFUND_BIZ_TYPES: readonly BizType[] = ['consumer', 'simplified'];

/** 이 사업자 구분은 부가세를 환급받지 못하는가 */
export function noVatRefund(biz: BizType | string | null | undefined): boolean {
  return NO_VAT_REFUND_BIZ_TYPES.includes(biz as BizType);
}
