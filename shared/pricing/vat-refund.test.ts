import { describe, it, expect } from 'vitest';
import { calcQuote } from './quote.js';
import { calcPrice } from './core.js';
import { noVatRefund, NO_VAT_REFUND_BIZ_TYPES, isIndividualBenefit } from './vat-refund.js';
import { QUOTE_PARAMS, REGRESSION_PARAMS } from './fixtures.js';
import type { BizType } from './types.js';

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

/**
 * 간이과세자도 세금계산서로 매입세액을 돌려받지 못한다 → 환급 없음.
 *
 * UI 에는 「간이과세자」 선택지가 처음부터 있었는데, 판정이 `=== 'consumer'` 로
 * 서버(quote-calc)와 화면(liveQuote) 두 곳에 흩어져 있어 **간이과세자가 환급을 받고 있었다.**
 * 규칙을 vat-refund.ts 한 곳으로 모으고, 여기서 지킨다.
 */
describe('환급 대상 판정 — 사업자 구분', () => {
  it('🔴 간이과세자는 환급 대상이 아니다', () => {
    expect(noVatRefund('simplified')).toBe(true);
  });

  it('일반구매자도 환급 대상이 아니다', () => {
    expect(noVatRefund('consumer')).toBe(true);
  });

  it('🔴 면세사업자는 환급 대상이 아니다', () => {
    expect(noVatRefund('vat_exempt')).toBe(true);
  });

  it('개인·법인 사업자는 환급 대상이다', () => {
    expect(noVatRefund('individual')).toBe(false);
    expect(noVatRefund('corporation')).toBe(false);
  });

  it('BizType 이 전부 둘 중 한쪽으로 판정된다 — 새 구분이 생기면 여기서 걸린다', () => {
    const all: BizType[] = ['individual', 'corporation', 'simplified', 'vat_exempt', 'consumer'];
    expect(all.filter(noVatRefund).sort()).toEqual([...NO_VAT_REFUND_BIZ_TYPES].sort());
  });
});

describe('Ver1.21 엔진(calcPrice) — 같은 규칙을 쓴다', () => {
  const withBiz = (biz: BizType) =>
    calcPrice({ ...REGRESSION_PARAMS, customer: { ...REGRESSION_PARAMS.customer, biz_type: biz } });

  it('🔴 간이과세자는 환급 차감이 없다', () => {
    const r = withBiz('simplified');
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.vat_refunded_price).toBe(r.applied_price);
  });

  it('일반구매자도 환급 차감이 없다', () => {
    const r = withBiz('consumer');
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.vat_refunded_price).toBe(r.applied_price);
  });

  it('개인사업자는 부가세만큼 차감된다', () => {
    const r = withBiz('individual');
    if (r.status !== 'ok') throw new Error('expected ok');
    expect(r.vat).toBeGreaterThan(0);
    expect(r.vat_refunded_price).toBe(r.applied_price - r.vat);
  });
});

/**
 * 면세사업자 = **개인사업자와 같은 혜택, 부가세 환급만 0원.**
 *
 * 부가세는 그대로 내고(공급가 10%), 보조금(국고·지방·소상공인·택배)도 개인사업자와 같다.
 * 그러니 실구매가는 정확히 「같은 조건의 개인사업자 + 부가세액」이어야 한다.
 */
describe('면세사업자', () => {
  it('🔴 개인사업자 혜택(택배 보조금) 대상이다 — 법인·간이·일반은 아니다', () => {
    expect(isIndividualBenefit('individual')).toBe(true);
    expect(isIndividualBenefit('vat_exempt')).toBe(true);
    expect(isIndividualBenefit('corporation')).toBe(false);
    expect(isIndividualBenefit('simplified')).toBe(false);
    expect(isIndividualBenefit('consumer')).toBe(false);
  });

  it('🔴 calcPrice — 보조금은 개인사업자와 같고, 실구매가는 부가세만큼 비싸다', () => {
    const run = (biz: BizType) => {
      const r = calcPrice({ ...REGRESSION_PARAMS, customer: { ...REGRESSION_PARAMS.customer, biz_type: biz } });
      if (r.status !== 'ok') throw new Error('expected ok');
      return r;
    };
    const ind = run('individual');
    const ex = run('vat_exempt');
    expect(ex.vat).toBe(ind.vat);
    expect(ex.vat).toBeGreaterThan(0);
    expect(ex.subsidy_total).toBe(ind.subsidy_total);
    expect(ex.subsidy_takbae).toBe(ind.subsidy_takbae);
    expect(ex.subsidy_takbae).toBeGreaterThan(0);
    expect(ex.vat_refunded_price).toBe(ex.applied_price);
    expect(ex.real_price).toBe(ind.real_price + ind.vat);
  });

  it('🔴 calcQuote — 개인사업자 파라미터에서 환급만 막으면 환급액 0, 실구매가는 그만큼 비싸다', () => {
    const ind = calcQuote({ ...QUOTE_PARAMS, is_individual: true, no_vat_refund: noVatRefund('individual') });
    const ex = calcQuote({ ...QUOTE_PARAMS, is_individual: isIndividualBenefit('vat_exempt'), no_vat_refund: noVatRefund('vat_exempt') });
    expect(ex.vat_refund_price).toBe(0);
    expect(ex.subsidy_total).toBe(ind.subsidy_total);
    expect(ex.real_price).toBeGreaterThan(ind.real_price);
  });
});
