import { describe, it, expect } from 'vitest';
import { calcQuote } from './quote.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * 일반구매자(비사업자)는 **부가세를 환급받을 수 없다.**
 *
 * 견적서에는 「해당 없음」으로 적지만(0 원이라고 쓰면 「공짜」로 읽힌다),
 * **계산 자체는 손대지 않는다** — 환급을 못 받으니 실제로 더 낸다.
 */
describe('부가세 환급', () => {
  it('일반구매자는 환급액이 0 이다', () => {
    expect(calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true }).vat_refund_price).toBe(0);
  });

  it('사업자는 환급 후 금액이 나온다', () => {
    expect(calcQuote({ ...QUOTE_PARAMS, no_vat_refund: false }).vat_refund_price).toBeGreaterThan(0);
  });

  it('🔴 환급을 못 받으면 실구매가가 그만큼 비싸다 — 표기만 바꾸지 금액은 안 건드린다', () => {
    const biz = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: false });
    const consumer = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true });
    expect(consumer.real_price).toBeGreaterThan(biz.real_price);
  });
});
