import type { QuoteParams } from './quote.js';

/**
 * **특장만 견적** — 고객이 차를 이미 갖고 있어 특장만 얹는다.
 *
 * 차량에 딸린 입력을 **한 곳에서** 0으로 만든다. 화면·백엔드가 각자 0을 채우면
 * 한쪽만 빠뜨렸을 때 금액이 조용히 어긋난다(견적서와 화면이 다른 값을 말하게 된다).
 *
 * 무엇이 차량에 딸린 것인가 —
 *   · 차량가·탁송료          차를 안 사니 없다
 *   · 구매혜택(커머셜·파트너십) 차량 할인이라 없다
 *   · EV 보조금(국고·지방·소상공인·택배) 차량 구매 보조금이라 없다
 *     (소상공인·택배는 국고에 비례하므로 국고가 0이면 따라서 0이 된다)
 *   · 차량 취득세·공채·번호판·증지대·의무보험·등록대행  이미 등록된 차라 없다
 *
 * **남는 것** — 특장 취득세(2%)·등록부가수수료·구조변경 비용.
 * 구조변경 절차에 드는 비용이라 차를 어디서 샀는지와 무관하다.
 *
 * **할부(캐피탈)도 없다.** 캐피탈은 차량과 특장을 묶어 실행하는 것이라, 차를 안 사면
 * 실행할 것이 없다. 선수금 비율·할부 개월수를 0으로 눌러 두지 않으면 존재하지 않는
 * 할부에 선수금이 잡히고 월 납입금이 찍힌다.
 */
export function bodyOnlyParams(p: QuoteParams): QuoteParams {
  return {
    ...p,
    body_only: true,
    car_price: 0,
    delivery_fee: 0,
    commercial_discount: 0,
    partnership_rate: 0,
    subsidy_national: 0,
    subsidy_local: 0,
    diesel_deduction: 0,
    car_deposit: 0,
    // 캐피탈은 차량과 묶어 실행한다 — 차가 없으면 할부도 없다
    down_payment_rate: 0,
    installment_months: 0,
    /*
     * ⚠️ 감면을 0으로 두는 것이 중요하다. 차량 취득세는 0인데 감면(−140만)만 남으면
     *    **음수 세금**이 되어 실구매가를 깎는다. calcQuote 도 body_only 면 0으로 막지만,
     *    입력 자체를 지워 두 겹으로 막는다.
     */
    acq_tax_relief: 0,
    bond_discount: 0,
    plate: 0,
    stamp: 0,
    insurance: 0,
    reg_agency: 0,
  };
}
