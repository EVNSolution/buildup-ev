import { describe, it, expect } from 'vitest';
import { calcQuote } from './quote.js';
import { vehicleOnlyParams } from './vehicle-only.js';
import { bodyOnlyParams } from './body-only.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * **차량만 견적** — 특장을 얹지 않고 차량만 판다. `bodyOnlyParams` 의 거울상이다.
 *
 * 여기서 지키는 것은 「특장 금액이 0」만이 아니다. **차량 쪽은 하나도 안 깎여야** 한다 —
 * 보조금·할부가 빠지면 차량만 견적이 성립하지 않는다.
 */
const P = { ...QUOTE_PARAMS, down_payment_rate: 0.3, installment_months: 36 };
const v = (over = {}) => calcQuote(vehicleOnlyParams({ ...P, ...over }));
const full = calcQuote(P);

describe('차량만 — 특장 쪽이 전부 빠진다', () => {
  it('특장 금액이 0이다', () => {
    const r = v();
    expect(r.body_price).toBe(0);
    expect(r.body_payment).toBe(0);
  });

  it('특장 계약금·취득세·등록부대비용이 0이다', () => {
    const r = v();
    expect(r.body_deposit).toBe(0);
    expect(r.body_acq_tax).toBe(0);
    expect(r.body_reg_cost).toBe(0);
  });

  it('🔴 구조변경 비용이 빠진다 — 구조변경 자체를 하지 않는다', () => {
    // 특장을 안 얹으면 구조를 바꿀 일이 없다. 남겨 두면 없는 작업에 돈을 받는 셈이다
    const r = v({ structure_change_fee: 400_000, etc_fee: 50_000 });
    expect(r.body_reg_cost).toBe(0);
  });

  it('프로모션도 빠진다 — 특장 옵션에 붙는 할인이다', () => {
    const r = v({ promotion: 1_000_000 });
    expect(r.promotion).toBe(0);
  });
});

describe('차량만 — 차량 쪽은 하나도 깎이지 않는다', () => {
  it('차량가·탁송료가 그대로다', () => {
    const r = v();
    expect(r.car_price).toBe(full.car_price);
    expect(r.delivery_fee).toBe(full.delivery_fee);
  });

  it('🔴 EV 보조금이 그대로 붙는다 — 차를 사는 거래다', () => {
    const r = v();
    expect(r.subsidy_total).toBe(full.subsidy_total);
    // 보조금은 **차감액이라 음수**로 담긴다 — 0 이 아니라는 것이 요점이다
    expect(Math.abs(r.subsidy_total)).toBeGreaterThan(0);
  });

  it('🔴 할부(캐피탈)가 그대로 걸린다 — 특장만 견적과 정반대다', () => {
    const r = v();
    expect(r.installment_months).toBe(36);
    expect(r.down_payment).toBeGreaterThan(0);
    expect(r.monthly_payment).toBeGreaterThan(0);
  });

  it('차량 취득세·등록비가 그대로다', () => {
    const r = v();
    expect(r.car_acq_tax).toBe(full.car_acq_tax);
    expect(r.car_reg_cost).toBe(full.car_reg_cost);
  });
});

describe('특장만 견적과 정확히 반대다', () => {
  it('둘을 합치면 원래 견적의 결제금액이 된다', () => {
    /*
     * 차량만 결제금액 + 특장만 결제금액 = 원래 결제금액.
     * 한쪽 변환이 남의 몫까지 건드리면 이 등식이 깨진다.
     */
    const onlyV = calcQuote(vehicleOnlyParams(P));
    const onlyB = calcQuote(bodyOnlyParams(P));
    expect(onlyV.car_payment + onlyB.body_payment).toBe(full.car_payment + full.body_payment);
  });

  it('할부는 서로 반대다', () => {
    expect(calcQuote(vehicleOnlyParams(P)).installment_months).toBe(36);
    expect(calcQuote(bodyOnlyParams(P)).installment_months).toBe(0);
  });
});

describe('선수금 합계는 여기서도 맞는다', () => {
  it('선수금 + 할부원금 = 나눠 가질 몫', () => {
    const r = v();
    expect(r.down_payment + r.total_installment).toBe(
      r.car_payment + r.body_payment - r.car_deposit - r.body_deposit,
    );
  });
});
