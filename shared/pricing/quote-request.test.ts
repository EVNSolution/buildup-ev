import { describe, it, expect } from 'vitest';
import { quotePriceExtras, type QuotePriceExtras } from './quote-request.js';
import { calcQuote } from './quote.js';
import { assembleOptionSum } from './assemble.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * **저장 요청이 화면 금액의 근거를 다 싣고 있는가.**
 *
 * #182 의 재발 방지. 그때 깨진 건 계산이 아니라 **전달**이었다 —
 * 화면은 프로모션을 반영해 금액을 보여주는데 저장 요청에 그 값이 없어서,
 * 저장된 견적과 견적서에는 아무것도 반영되지 않았다.
 * 계산 테스트 190건이 전부 통과한 채로 그 버그가 배포됐다.
 *
 * 그래서 여기서 확인하는 건 두 가지다.
 *   1. 금액을 바꾸는 입력이 **실제로** 금액을 바꾸는가 (아래 「근거」)
 *   2. 그 입력이 저장 요청 필드로 **하나도 빠짐없이** 옮겨지는가 (아래 「완전성」)
 */

const PRICES: Record<string, number> = {
  TRIM_PLUS: 45_136_364, TOP_REEFER_LOW: 17_563_636, TEMP_O: 450_000, PART_LOW_MOVE: 600_000,
};
const price = (c: string) => PRICES[c] ?? 0;
const SEL = { TRIM: 'TRIM_PLUS', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW', TEMP: 'TEMP_O', PARTITION: 'PART_REEFER' };

describe('저장 요청 — 이름 옮기기', () => {
  it('세 값이 그대로 옮겨진다', () => {
    expect(quotePriceExtras({
      promotionZeroed: new Set(['TEMP', 'PARTITION']),
      promotionDiscount: 200_000,
      localSubsidyOff: true,
    })).toEqual({
      promotion_zeroed: ['TEMP', 'PARTITION'],
      promotion_discount: 200_000,
      local_subsidy_off: true,
    });
  });

  it('Set 을 배열로 편다 — JSON 으로 보내면 Set 은 {} 가 된다', () => {
    const r = quotePriceExtras({ promotionZeroed: new Set(['TOP']), promotionDiscount: 0, localSubsidyOff: false });
    expect(Array.isArray(r.promotion_zeroed)).toBe(true);
    expect(JSON.parse(JSON.stringify(r)).promotion_zeroed).toEqual(['TOP']);
  });

  it('아무것도 안 걸린 상태도 빈 값으로 싣는다 — 키를 빼지 않는다', () => {
    expect(quotePriceExtras({ promotionZeroed: [], promotionDiscount: 0, localSubsidyOff: false }))
      .toEqual({ promotion_zeroed: [], promotion_discount: 0, local_subsidy_off: false });
  });

  it('음수·소수·NaN 은 저장되기 전에 막는다', () => {
    const bad = (n: number) => quotePriceExtras({ promotionZeroed: [], promotionDiscount: n, localSubsidyOff: false }).promotion_discount;
    expect(bad(-50_000)).toBe(0);
    expect(bad(1234.7)).toBe(1235);
    expect(bad(NaN)).toBe(0);
  });
});

describe('저장 요청 — 완전성', () => {
  /**
   * ⚠️ **이 표가 이 파일의 핵심이다.**
   * `QuotePriceExtras` 에 항목이 늘면 이 객체가 컴파일되지 않는다 →
   * 새 항목을 저장 요청에 싣는 걸 잊은 채로는 빌드가 통과하지 못한다.
   */
  const MUST_CARRY: Record<keyof QuotePriceExtras, true> = {
    promotion_zeroed: true,
    promotion_discount: true,
    local_subsidy_off: true,
  };

  it('선언한 항목을 전부 내보낸다', () => {
    const out = quotePriceExtras({ promotionZeroed: ['TEMP'], promotionDiscount: 1, localSubsidyOff: true });
    expect(Object.keys(out).sort()).toEqual(Object.keys(MUST_CARRY).sort());
  });

  it('내보낸 항목 중 값이 통째로 빠진 게 없다', () => {
    const out = quotePriceExtras({ promotionZeroed: ['TEMP'], promotionDiscount: 1, localSubsidyOff: true });
    for (const k of Object.keys(MUST_CARRY) as (keyof QuotePriceExtras)[]) {
      expect(out[k], `${k} 가 저장 요청에서 빠졌다`).toBeDefined();
    }
  });
});

describe('저장 요청 — 근거: 이 값들은 실제로 금액을 바꾼다', () => {
  const base = assembleOptionSum(SEL, price);
  const quote = (opts: { zeroed?: string[]; promotion?: number }) => {
    const a = assembleOptionSum(SEL, price, opts.zeroed);
    return calcQuote({
      ...QUOTE_PARAMS,
      body_price: Math.round(a.option_sum * 1.1),
      promotion: opts.promotion ?? 0,
    });
  };

  it('무상제공(0원 처리)이 실구매가를 바꾼다', () => {
    expect(quote({ zeroed: ['TEMP'] }).real_price).toBeLessThan(quote({}).real_price);
    expect(assembleOptionSum(SEL, price, ['TEMP']).option_sum).toBe(base.option_sum - 450_000);
  });

  it('금액 할인이 실구매가를 바꾼다', () => {
    expect(quote({ promotion: 300_000 }).real_price).toBeLessThan(quote({}).real_price);
  });

  it('둘은 서로 다른 값이라 함께 걸면 함께 반영된다', () => {
    const both = quote({ zeroed: ['TEMP'], promotion: 300_000 }).real_price;
    expect(both).toBeLessThan(quote({ zeroed: ['TEMP'] }).real_price);
    expect(both).toBeLessThan(quote({ promotion: 300_000 }).real_price);
  });

  it('기본값이면 아무 영향도 없다 — 안 쓰는 견적의 금액은 그대로다', () => {
    expect(quote({ zeroed: [], promotion: 0 }).real_price).toBe(quote({}).real_price);
  });
});
