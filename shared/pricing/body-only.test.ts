import { describe, it, expect } from 'vitest';
import { calcQuote } from './quote.js';
import { bodyOnlyParams } from './body-only.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * **특장만 견적** — 차를 이미 가진 고객에게 특장만 얹어 파는 경우.
 *
 * 여기서 지키는 것은 하나다: **차량에 딸린 금액이 하나도 남지 않되, 특장 쪽은 그대로일 것.**
 * 한 줄이라도 새어 나오면 고객이 사지도 않은 차의 세금이나 보조금이 견적서에 찍힌다.
 */
describe('특장만 견적', () => {
  const full = calcQuote(QUOTE_PARAMS);
  const body = calcQuote(bodyOnlyParams(QUOTE_PARAMS));

  it('차량에 딸린 금액이 하나도 남지 않는다', () => {
    expect(body.car_price).toBe(0);
    expect(body.delivery_fee).toBe(0);
    expect(body.car_payment).toBe(0);
    expect(body.car_reg_cost).toBe(0);
    expect(body.car_initial).toBe(0);
  });

  it('EV 보조금이 붙지 않는다 — 차량 구매 보조금이다', () => {
    expect(body.subsidy_total).toBe(0);
    // 소상공인·택배 보조금은 국고에 비례하므로 국고가 0이면 따라서 0이다
    expect(full.subsidy_total).not.toBe(0);
  });

  /**
   * ⚠️ 이게 이 파일에서 가장 중요한 항목이다.
   * 차량 취득세는 0인데 감면(−140만)만 남으면 **음수 세금**이 되어 실구매가를 깎는다.
   * 차를 안 샀는데 세금을 돌려받는 셈이라 말이 안 된다.
   */
  it('차량 취득세가 음수가 되지 않는다 — 감면만 남으면 안 된다', () => {
    expect(body.car_acq_tax).toBe(0);
    expect(body.car_acq_tax).not.toBeLessThan(0);
    expect(body.real_price).toBeGreaterThan(0);
  });

  it('특장 쪽은 그대로다 — 특장가·취득세·등록부대비용', () => {
    expect(body.body_price).toBe(full.body_price);
    expect(body.body_payment).toBe(full.body_payment);
    expect(body.body_acq_tax).toBe(full.body_acq_tax);
    expect(body.etc_fee).toBe(full.etc_fee);
    expect(body.structure_change_fee).toBe(full.structure_change_fee);
    expect(body.body_reg_cost).toBe(full.body_reg_cost);
  });

  /**
   * 선수금은 원래 차량측에 붙는다. 차량이 없으면 존재하지 않는 인도금에 금액이 잡히므로
   * 특장측으로 보낸다 — 받은 돈이 사라지거나 엉뚱한 칸에 찍히면 안 된다.
   */
  it('선수금이 특장측으로 간다 — 차량 인도금에 남지 않는다', () => {
    expect(body.car_delivery).toBe(0);
    expect(body.body_delivery).toBeGreaterThanOrEqual(body.body_deposit);
    // 받은 돈의 총액은 보존된다
    expect(body.car_delivery + body.body_delivery).toBe(body.body_deposit + body.down_payment);
  });

  it('실구매가는 특장 쪽만으로 이뤄진다', () => {
    expect(body.real_price).toBe(body.vat_refund_price + body.body_reg_cost);
    expect(body.real_price).toBeLessThan(full.real_price);
  });

  /** 차량을 사는 기존 견적은 **한 값도** 달라지지 않아야 한다. */
  it('차량 포함 견적은 영향을 받지 않는다', () => {
    expect(calcQuote(QUOTE_PARAMS)).toEqual(full);
    expect(full.car_acq_tax).not.toBe(0);
  });
});

describe('특장만 — 할부(캐피탈)는 없다', () => {
  it('선수금과 할부 개월수를 0으로 누른다', () => {
    // 캐피탈은 차량과 묶어 실행한다 — 차를 안 사면 실행할 것이 없다
    const p = bodyOnlyParams({ ...QUOTE_PARAMS, down_payment_rate: 0.3, installment_months: 36 });
    expect(p.down_payment_rate).toBe(0);
    expect(p.installment_months).toBe(0);
  });

  it('선수금·월 납입금·할부이자가 모두 0이다', () => {
    const r = calcQuote(bodyOnlyParams({ ...QUOTE_PARAMS, down_payment_rate: 0.3, installment_months: 36 }));
    expect(r.down_payment).toBe(0);
    expect(r.monthly_payment).toBe(0);
    expect(r.installment_months).toBe(0);
  });

  it('선수금을 0으로 눌러도 실구매가는 달라지지 않는다', () => {
    // 실구매가는 결제금액 + 등록/부대비용이라 할부 조건과 무관하다 — 눌러도 금액이 안 흔들려야 한다
    const a = calcQuote(bodyOnlyParams({ ...QUOTE_PARAMS, down_payment_rate: 0.3, installment_months: 36 }));
    const b = calcQuote(bodyOnlyParams({ ...QUOTE_PARAMS, down_payment_rate: 0, installment_months: 0 }));
    expect(a.real_price).toBe(b.real_price);
  });
});
