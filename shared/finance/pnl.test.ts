import { describe, it, expect } from 'vitest';
import { vatOf, grossOf, payDiffOf, deriveP, sumP, monthBounds, isYearMonth, supplyFromGross } from './pnl';

/**
 * **엑셀과 같은 숫자가 나오는가.**
 *
 * 정답지는 지금 쓰는 엑셀(차량판매_손익_양식.xlsx)의 실제 줄이다 —
 * 26년8월 전진영: 공급가액 18,960,000 · VAT 1,896,000 · 공급대가 20,856,000 ·
 * 계약금 400,000 · 캐피탈 20,450,000 · 입금 차액 6,000.
 *
 * 금액 셈이 화면과 서버에서 갈리면 합계와 줄이 어긋난다. 그래서 함수는 한 벌이고, 여기서 못 박는다.
 */
describe('손익 셈 — 엑셀 재현', () => {
  it('🔴 전진영 줄이 엑셀과 같다', () => {
    const row = { supply_amount: 18_960_000, deposit: 400_000, capital: 20_450_000 };
    expect(vatOf(row.supply_amount)).toBe(1_896_000);
    expect(grossOf(row.supply_amount)).toBe(20_856_000);
    expect(payDiffOf(row.supply_amount, row.deposit, row.capital)).toBe(6_000);
  });

  it('🔴 캐피탈 전에는 입금 차액이 음수로 남는다 — 아직 안 들어온 돈이다', () => {
    // 26년9월 (주)화이트축산: 공급가액 0 · 계약금 400,000 → −400,000
    expect(payDiffOf(0, 400_000, 0)).toBe(-400_000);
  });

  it('🔴 VAT 는 반올림이 아니라 **버림**이다 — ROUNDDOWN(E*10%,0)', () => {
    expect(vatOf(1_000_005)).toBe(100_000);   // 100,000.5 → 100,000
    expect(vatOf(1_000_009)).toBe(100_000);
    expect(vatOf(0)).toBe(0);
  });

  it('🔴 수익은 **VAT 를 뺀 공급가액** 기준이다 — VAT 는 받아서 내는 돈이다', () => {
    const d = deriveP({ supply_amount: 10_000_000, deposit: 0, capital: 0, cost: 7_500_000 });
    expect(d.profit).toBe(2_500_000);
    expect(d.margin).toBeCloseTo(0.25, 10);
  });

  it('🔴 공급가액이 0이면 수익률은 없다 — 0% 로 쓰면 「손해」로 읽힌다', () => {
    expect(deriveP({ supply_amount: 0, deposit: 0, capital: 0 }).margin).toBeNull();
  });

  it('🔴 합계는 줄과 같은 함수로 낸다 — 엑셀 20행', () => {
    const rows = [
      { supply_amount: 18_960_000, deposit: 400_000, capital: 20_450_000 },
      { supply_amount: 0, deposit: 400_000, capital: 0 },
      { supply_amount: 0, deposit: 400_000, capital: 0 },
      { supply_amount: 0, deposit: 400_000, capital: 0 },
      { supply_amount: 0, deposit: 400_000, capital: 0 },
    ];
    const z = sumP(rows);
    expect(z.count).toBe(5);
    expect(z.supply_amount).toBe(18_960_000);
    expect(z.vat).toBe(1_896_000);
    expect(z.gross).toBe(20_856_000);
    expect(z.capital).toBe(20_450_000);
    // 엑셀 J20 = −1,594,000
    expect(z.pay_diff).toBe(-1_594_000);
  });
});

describe('계약서 금액에서 공급가액 되짚기', () => {
  it('🔴 그냥 1.1 로 나누면 1원이 샌다 — 딱 맞는 값을 고른다', () => {
    // 실제 견적의 특장 결제금액. round(/1.1) 은 18,463,636 이고 그 공급대가는 20,309,999 다
    expect(Math.round(20_310_000 / 1.1)).toBe(18_463_636);
    expect(grossOf(18_463_636)).toBe(20_309_999);
    expect(supplyFromGross(20_310_000)).toBe(18_463_637);
    expect(grossOf(supplyFromGross(20_310_000))).toBe(20_310_000);
  });

  it('🔴 엑셀에 적힌 값과도 맞는다', () => {
    expect(supplyFromGross(20_856_000)).toBe(18_960_000);
    expect(supplyFromGross(0)).toBe(0);
  });

  it('🔴 어떤 금액이든 되짚은 값의 공급대가가 1원 넘게 벌어지지 않는다', () => {
    for (const g of [1_100_000, 21_619_000, 33_333_333, 7, 999_999]) {
      expect(Math.abs(grossOf(supplyFromGross(g)) - g), String(g)).toBeLessThanOrEqual(1);
    }
  });
});

describe('달 가르기', () => {
  it('🔴 12월 다음은 다음 해 1월이다', () => {
    expect(monthBounds('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-10-01' });
  });

  it('🔴 주소로 들어온 달 값을 믿지 않는다', () => {
    for (const ok of ['2026-01', '2026-12']) expect(isYearMonth(ok)).toBe(true);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '', null, undefined, 42, '2026-09-01']) {
      expect(isYearMonth(bad), String(bad)).toBe(false);
    }
  });
});
