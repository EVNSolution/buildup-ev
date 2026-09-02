import { describe, it, expect } from 'vitest';
import { resolveCarPrice, trimPriceVatIncluded } from './car-price.js';
import { calcQuote } from './quote.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * 영업이 상담 자리에서 차량 가격을 직접 적어 넣는다.
 * 적어 넣으면 그 금액이 차량가를 통째로 대체하고, 세금·환급·실구매가가 따라 움직인다.
 */
describe('차량 가격 직접 입력', () => {
  const TRIM_SUPPLY = 45_136_364;   // 공급가 — VAT 포함 ≈ 49,650,000

  it('안 적으면 트림 단가(VAT 포함)를 쓴다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, null)).toBe(trimPriceVatIncluded(TRIM_SUPPLY));
    expect(resolveCarPrice(TRIM_SUPPLY, undefined)).toBe(trimPriceVatIncluded(TRIM_SUPPLY));
  });

  it('적으면 그 금액을 그대로 쓴다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, 47_000_000)).toBe(47_000_000);
  });

  /**
   * 🔴 선수금에서 두 번 당한 실수 — `null` 은 「0원으로 정했다」가 아니라 「안 쓴다」다.
   * `!== undefined` 로 보면 직접 입력을 껐을 때 차량가가 0원이 된다.
   */
  it('🔴 null 은 「0원」이 아니라 「안 씀」이다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, null)).toBeGreaterThan(0);
    expect(resolveCarPrice(TRIM_SUPPLY, null)).not.toBe(0);
  });

  it('0 을 적으면 0 으로 본다 — null 과 구분된다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, 0)).toBe(0);
  });

  it('음수는 0 으로 눕힌다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, -5_000_000)).toBe(0);
  });

  it('소수점은 원 단위로 반올림한다', () => {
    expect(resolveCarPrice(TRIM_SUPPLY, 47_000_000.6)).toBe(47_000_001);
  });
});

describe('직접 입력이 총견적서 전체에 반영된다', () => {
  const base = calcQuote(QUOTE_PARAMS);
  const cheaper = calcQuote({ ...QUOTE_PARAMS, car_price: QUOTE_PARAMS.car_price - 3_000_000 });

  it('🔴 차량가를 낮추면 취득세·부가세환급·실구매가가 함께 내려간다', () => {
    expect(cheaper.car_payment).toBeLessThan(base.car_payment);
    expect(cheaper.car_acq_tax).toBeLessThan(base.car_acq_tax);
    expect(cheaper.vat_refund_price).toBeLessThan(base.vat_refund_price);
    expect(cheaper.real_price).toBeLessThan(base.real_price);
  });

  it('특장 금액은 건드리지 않는다', () => {
    expect(cheaper.body_payment).toBe(base.body_payment);
    expect(cheaper.body_acq_tax).toBe(base.body_acq_tax);
  });
});
