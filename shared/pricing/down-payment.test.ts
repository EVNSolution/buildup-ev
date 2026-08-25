import { describe, it, expect } from 'vitest';
import { calcQuote } from './quote.js';
import { QUOTE_PARAMS } from './fixtures.js';

/**
 * **선수금 + 할부원금 = 나눠 가질 몫.** 절삭해도 반드시 맞아야 한다.
 *
 * 예전에는 선수금을 소수점째로 두고 표시할 때만 반올림했다. 그래서 견적서에 찍힌
 * 「선수금 + 할부원금」이 합계와 **1원 어긋나는** 일이 생겼다.
 */
const P = { ...QUOTE_PARAMS, installment_months: 36 };

/** 선수금과 할부원금이 나눠 갖는 몫 */
function splittable(r: ReturnType<typeof calcQuote>) {
  return r.car_payment + r.body_payment - r.car_deposit - r.body_deposit;
}

describe('선수금 — 비율로 정할 때', () => {
  // 나누어떨어지지 않는 비율만 골랐다. 딱 떨어지면 절삭 버그가 드러나지 않는다.
  for (const rate of [0.03, 0.07, 0.13, 0.29, 0.31, 0.37, 0.63, 0.77]) {
    it(`${(rate * 100).toFixed(0)}% — 선수금+할부원금이 몫과 정확히 같다`, () => {
      const r = calcQuote({ ...P, down_payment_rate: rate });
      expect(r.down_payment + r.total_installment).toBe(splittable(r));
    });
  }

  it('선수금은 원 단위 정수다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0.333 });
    expect(Number.isInteger(r.down_payment)).toBe(true);
  });

  it('올리지 않고 **내린다** — 고객이 낼 돈이 멋대로 늘면 안 된다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0.3 });
    expect(r.down_payment).toBeLessThanOrEqual(splittable(r) * 0.3);
  });
});

describe('선수금 — 금액으로 정할 때', () => {
  it('넣은 금액이 그대로 선수금이 된다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0.3, down_payment_amount: 15_000_000 });
    expect(r.down_payment).toBe(15_000_000);
  });

  it('금액을 넣으면 비율은 무시된다 — 둘이 싸우지 않는다', () => {
    const a = calcQuote({ ...P, down_payment_rate: 0.9, down_payment_amount: 12_345_678 });
    const b = calcQuote({ ...P, down_payment_rate: 0.1, down_payment_amount: 12_345_678 });
    expect(a.down_payment).toBe(b.down_payment);
  });

  it('금액으로 정해도 합계는 맞는다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0, down_payment_amount: 12_345_678 });
    expect(r.down_payment + r.total_installment).toBe(splittable(r));
  });

  it('🔴 나눠 가질 몫보다 크게 넣어도 넘지 않는다 — 할부원금이 음수가 되면 안 된다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0, down_payment_amount: 999_999_999 });
    expect(r.down_payment).toBe(splittable(r));
    expect(r.total_installment).toBe(0);
  });

  it('음수를 넣어도 0 아래로 내려가지 않는다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0, down_payment_amount: -5_000_000 });
    expect(r.down_payment).toBe(0);
  });

  it('금액에 맞는 비율이 함께 나온다 — 견적서에 둘 다 적는다', () => {
    const r = calcQuote({ ...P, down_payment_rate: 0, down_payment_amount: 15_000_000 });
    expect(r.down_payment_ratio).toBeCloseTo(15_000_000 / splittable(r), 10);
  });
});

describe('실구매가는 선수금에 흔들리지 않는다', () => {
  it('선수금을 바꿔도 실구매가는 같다 — 낼 시점이 갈릴 뿐 총액은 같다', () => {
    const a = calcQuote({ ...P, down_payment_rate: 0 });
    const b = calcQuote({ ...P, down_payment_rate: 0.5 });
    const c = calcQuote({ ...P, down_payment_rate: 0, down_payment_amount: 9_876_543 });
    expect(b.real_price).toBe(a.real_price);
    expect(c.real_price).toBe(a.real_price);
  });
});

describe('금액 기준을 풀 때', () => {
  it('🔴 `null` 은 「0원」이 아니라 「비율로 되돌린다」는 뜻이다', () => {
    /*
     * 화면이 금액 기준을 풀 때 `down_payment_amount: null` 을 보내 저장값을 지운다.
     * 이걸 「금액 0원」으로 읽으면, 비율을 30% 로 되돌렸는데 견적서에는 0원이 찍힌다.
     */
    const withNull = calcQuote({ ...P, down_payment_rate: 0.3, down_payment_amount: null });
    const byRate = calcQuote({ ...P, down_payment_rate: 0.3 });
    expect(withNull.down_payment).toBe(byRate.down_payment);
    expect(withNull.down_payment).toBeGreaterThan(0);
  });

  it('금액 0원은 진짜 0원이다 — `null` 과 구분된다', () => {
    const zero = calcQuote({ ...P, down_payment_rate: 0.3, down_payment_amount: 0 });
    expect(zero.down_payment).toBe(0);
  });
});
