/**
 * 가격바 표시값 — 화면이 보여주는 흐름을 **계산이 아니라 조회**로 만들기 위한 파생값.
 *
 *   차량+특장 − 구매혜택 − 보조금 − 부가세환급 = 실구매가   (등록·기타는 흐름 밖)
 *
 * 이 사칙연산이 컴포넌트 안에 있으면, 앱을 만들 때 같은 식을 한 벌 더 쓰게 된다.
 * 계산은 `shared/` 한 곳에만 둔다(docs/app-plan.md §1-1) — 화면은 결과를 표시만 한다.
 *
 * ⚠️ 여기서 새 금액을 만들지 않는다. calcQuote(총견적서 규칙)가 낸 값을 **묶어서 보여줄 뿐**이다.
 *    실구매가는 real_price 에서 등록·기타를 빼서 얻는다 — 따로 더해 만들면 견적서와 어긋난다.
 */
import type { QuoteResult } from './quote.js';

export interface PriceBarView {
  /** ① 차량 + 특장 (VAT 포함, **탁송료 포함**) */
  start: number;
  /** ⑥ 별도 비용 = 차량 등록/부대 + 특장 등록/부대 (흐름 밖, 별도 표기 — 탁송료는 제외) */
  regEtc: number;
  /** ④ 부가세 환급액. 환급 대상이 아니면 0 */
  vatRefund: number;
  /** 환급 대상이 아닌가(일반구매자) */
  noRefund: boolean;
  /** ⑤ 실구매가 — 부가세 환급까지. 등록·기타는 포함하지 않는다 */
  netPrice: number;
  /** 실구매가 + 등록·기타 (= real_price). 「합계」로 곁들여 보여준다 */
  grandTotal: number;
}

export function priceBarView(q: QuoteResult): PriceBarView {
  /*
   * ⚠️ 탁송료는 **차량값 쪽**이다. 부가세 환급 계산이 (차량가 + 탁송료 + 구매혜택) 기준이라
   *    화면에서만 '별도 비용'으로 빼 두면, 같은 돈이 계산과 표시에서 다른 자리에 있게 된다.
   *    그래서 시작 금액(차량+특장)에 녹이고 별도 비용에서는 뺀다.
   */
  const regEtc = q.car_reg_cost + q.body_reg_cost;
  // 일반구매자(비사업자)는 환급 자체가 없다 — vat_refund_price 가 0 으로 내려온다.
  // 이때 차액을 그대로 쓰면 결제금액 전체가 환급액으로 보이므로 0 으로 둔다.
  const noRefund = q.vat_refund_price === 0;
  const vatRefund = noRefund ? 0 : (q.car_payment + q.body_payment) - q.vat_refund_price;
  const netPrice = q.real_price - regEtc;
  return {
    start: q.car_price + q.body_price + q.delivery_fee,
    regEtc,
    vatRefund,
    noRefund,
    netPrice,
    grandTotal: q.real_price,
  };
}
