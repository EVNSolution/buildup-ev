import { describe, it, expect } from 'vitest';
import { calcQuote } from './shared/pricing/quote.js';
import { priceBarView as bar } from './shared/pricing/pricebar.js';
import { QUOTE_PARAMS } from './shared/pricing/fixtures.js';

/**
 * 가격바 표시 규칙 — 화면에 보이는 사칙연산이 실제로 맞아떨어지는지.
 * 식은 shared/pricing/pricebar.ts 한 곳에만 있다(화면·앱·이 테스트가 같은 것을 본다).
 */

describe('가격바 — 실구매가는 부가세 환급까지, 등록·기타는 별도', () => {
  it('사업자: 화면 흐름대로 계산하면 실구매가와 일치', () => {
    const q = calcQuote(QUOTE_PARAMS); const b = bar(q);
    const flow = b.start + q.purchase_benefit + q.subsidy_total - b.vatRefund;
    expect(flow).toBe(b.netPrice);
  });
  it('일반구매자: 환급 0 이어도 흐름이 맞는다', () => {
    const q = calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true }); const b = bar(q);
    expect(b.vatRefund).toBe(0);
    expect(b.start + q.purchase_benefit + q.subsidy_total - b.vatRefund).toBe(b.netPrice);
  });
  it('실구매가 + 등록·기타 = 기존 총액(real_price)', () => {
    const q = calcQuote(QUOTE_PARAMS); const b = bar(q);
    expect(b.netPrice + b.regEtc).toBe(q.real_price);
  });
  it('일반구매자가 사업자보다 비싸다(환급 못 받음)', () => {
    expect(bar(calcQuote({ ...QUOTE_PARAMS, no_vat_refund: true })).netPrice)
      .toBeGreaterThan(bar(calcQuote(QUOTE_PARAMS)).netPrice);
  });
});
