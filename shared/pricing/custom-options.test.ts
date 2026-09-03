import { describe, it, expect } from 'vitest';
import {
  rowState, checkCustomOptions, readCustomOptions,
  customOptionSupply, customOptionsSupplySum,
  CUSTOM_OPTION_MAX_ROWS, CUSTOM_OPTION_NAME_MAX,
} from './custom-options';
import { assembleOptionSum } from './assemble';

/**
 * **커스텀 특장 옵션** — 단가표에 없는 사양을 영업이 직접 적어 넣는 줄.
 *
 * 사고가 날 지점은 둘이다.
 *   ① 반쪽만 적힌 줄이 저장돼 「무엇인지 모르는 금액」 또는 「금액 모르는 항목」이 서류로 나가는 것
 *   ② 금액이 특장 가격에 안 더해져 화면과 서류가 어긋나는 것
 */
describe('줄 상태 — 반쪽짜리를 가려낸다', () => {
  it('🔴 둘 다 비면 「없는 줄」 — + 만 누르고 안 적은 경우다', () => {
    expect(rowState({ name: '', price: null })).toBe('empty');
    expect(rowState({ name: '   ', price: null })).toBe('empty');
  });

  it('🔴 한쪽만 적히면 partial — 저장을 막아야 하는 상태', () => {
    expect(rowState({ name: '작업등', price: null })).toBe('partial');
    expect(rowState({ name: '', price: 500_000 })).toBe('partial');
    expect(rowState({ name: '  ', price: 500_000 })).toBe('partial');
  });

  it('🔴 0원도 「적은 것」이다 — 빈칸(null)과 다르다', () => {
    // 무상 제공을 0원으로 적을 수 있어야 한다. `0` 을 빈칸으로 취급하면 그게 막힌다.
    expect(rowState({ name: '서비스 품목', price: 0 })).toBe('ok');
  });
});

describe('저장 전 검사 — 화면과 서버가 같은 답을 낸다', () => {
  it('🔴 빈 줄은 조용히 버린다 — 없는 것과 같다', () => {
    const r = checkCustomOptions([{ name: '', price: null }, { name: '작업등', price: 500_000 }]);
    expect(r.ok).toBe(true);
    expect(r.options).toEqual([{ name: '작업등', price: 500_000 }]);
  });

  it('🔴 반쪽 줄이 하나라도 있으면 막는다 — 임시저장도 마찬가지다', () => {
    const r = checkCustomOptions([{ name: '작업등', price: null }]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('1번째 줄');
    // 막을 때는 아무것도 저장하지 않는다 — 「일부만 저장」이 제일 나쁘다
    expect(r.options).toEqual([]);
  });

  it('🔴 몇 번째 줄이 문제인지 짚어 준다', () => {
    const r = checkCustomOptions([
      { name: '작업등', price: 500_000 },
      { name: '', price: null },
      { name: '', price: 300_000 },
    ]);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('3번째 줄');   // 2번째는 빈 줄이라 건너뛴다
  });

  it('🔴 이름 공백은 다듬는다', () => {
    expect(checkCustomOptions([{ name: '  작업등  ', price: 500_000 }]).options)
      .toEqual([{ name: '작업등', price: 500_000 }]);
  });

  it('🔴 음수는 막는다 — 할인은 프로모션 칸이 따로 있다', () => {
    expect(checkCustomOptions([{ name: '깎기', price: -100 }]).ok).toBe(false);
  });

  it('🔴 줄 수·이름 길이·금액 상한을 넘으면 막는다', () => {
    const many = Array.from({ length: CUSTOM_OPTION_MAX_ROWS + 1 }, () => ({ name: 'x', price: 1 }));
    expect(checkCustomOptions(many).ok).toBe(false);
    expect(checkCustomOptions([{ name: 'x'.repeat(CUSTOM_OPTION_NAME_MAX + 1), price: 1 }]).ok).toBe(false);
    expect(checkCustomOptions([{ name: 'x', price: 999_999_999 }]).ok).toBe(false);
  });
});

describe('금액 — 화면은 VAT 포함, 계산은 공급가', () => {
  it('🔴 옵션DB 와 같은 규칙으로 되돌린다', () => {
    // 옵션DB 실제 값: 46,530,000(VAT포함) ↔ 42,300,000(공급가)
    expect(customOptionSupply(46_530_000)).toBe(42_300_000);
    expect(customOptionSupply(500_000)).toBe(454_545);
  });

  it('🔴 되돌린 값으로는 적은 금액을 정확히 복원할 수 없다 — 그래서 견적서는 적은 값을 찍는다', () => {
    /*
     * 50,000원은 `round(s × 1.1) = 50,000` 을 만족하는 **정수 공급가 s 가 없다.**
     * 부가세 10% 를 정수로 쪼개는 이상 피할 수 없다.
     * 그래서 견적서 행은 되돌린 값이 아니라 **영업이 적은 값**을 찍는다
     * (quote-pdf.ts — 고객에게 말한 숫자가 바뀌면 안 된다).
     * 이 테스트는 그 전제가 사라지면(반올림 규칙이 바뀌면) 알려 주는 자리다.
     */
    expect(Math.round(customOptionSupply(50_000) * 1.1)).toBe(50_001);
    // 합계 경로는 한 번만 반올림하므로 이 어긋남을 겪지 않는다
    expect(Math.round(customOptionsSupplySum([{ name: 'x', price: 50_000 }]) * 1.1)).toBe(50_001);
    // 대부분의 금액은 그대로 돌아온다 — 그래서 세금 계산 쪽은 이 규칙을 그대로 쓴다
    for (const p of [10_000, 100_000, 300_000, 500_000, 1_200_000]) {
      expect(Math.round(customOptionSupply(p) * 1.1), `${p}원`).toBe(p);
    }
  });

  it('🔴 합계는 **한 번만** 반올림한다 — 줄마다 깎으면 견적서 세로 합이 안 맞는다', () => {
    /*
     * 줄마다 반올림하면 454,545 + 272,727 = 727,272 이고, 여기에 기본 특장 공급가를
     * 더해 ×1.1 하면 ⑦ 이 **21,274,999원** 이 된다 — 견적서에 찍힌 줄들의 세로 합
     * 21,275,000원과 1원 어긋난다(실제 PDF 로 확인).
     */
    expect(customOptionsSupplySum([{ name: 'a', price: 500_000 }, { name: 'b', price: 300_000 }]))
      .toBe(727_273);
    expect(454_545 + 272_727).toBe(727_272);   // 줄마다 깎았을 때의 값 — 1원 작다
  });

  it('🔴 그래서 ⑦ 특장 가격이 찍힌 줄들의 세로 합과 맞는다', () => {
    // 기본 특장(공급가) + 커스텀 → ×1.1 한 값이, 각 줄에 찍히는 금액의 합과 같아야 한다
    const baseSupply = 17_563_636 + 450_000 + 600_000;      // 탑 · 온도기록계 · 격벽
    const baseRows = [17_563_636, 450_000, 600_000].reduce((a, s) => a + Math.round(s * 1.1), 0);
    const custom = [{ name: '작업등', price: 500_000 }, { name: '사이드스텝', price: 300_000 }];
    const seven = Math.round((baseSupply + customOptionsSupplySum(custom)) * 1.1);
    expect(seven).toBe(baseRows + 500_000 + 300_000);
  });
});

describe('특장 합계에 실제로 더해진다', () => {
  const sel = { TRIM: 'TRIM_BASIC', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW' };
  const price = (c: string) => (c === 'TRIM_BASIC' ? 42_300_000 : c === 'TOP_REEFER_LOW' ? 17_563_636 : 0);

  it('🔴 option_sum 이 커스텀 공급가만큼 늘어난다', () => {
    const base = assembleOptionSum(sel, price, [], []);
    const with2 = assembleOptionSum(sel, price, [], [{ name: '작업등', price: 500_000 }]);
    expect(with2.option_sum - base.option_sum).toBe(454_545);
    // 차량 트림가는 건드리지 않는다 — 특장 쪽 금액이다
    expect(with2.trim_price).toBe(base.trim_price);
  });

  it('🔴 커스텀이 없으면 예전과 완전히 같다 — 옛 견적 금액이 움직이면 안 된다', () => {
    expect(assembleOptionSum(sel, price, [], [])).toEqual({
      trim_price: 42_300_000, option_sum: 17_563_636,
    });
  });
});

describe('저장된 값 읽기 — 옛 견적·손댄 JSON 에도 안 깨진다', () => {
  it('🔴 없으면 빈 목록', () => {
    expect(readCustomOptions(undefined)).toEqual([]);
    expect(readCustomOptions(null)).toEqual([]);
    expect(readCustomOptions('아무거나')).toEqual([]);
  });

  it('🔴 형태가 깨진 줄은 버린다', () => {
    expect(readCustomOptions([
      { name: '작업등', price: 500_000 },
      { name: '이름만' },
      { price: 100 },
      { name: '', price: 100 },
      null,
    ])).toEqual([{ name: '작업등', price: 500_000 }]);
  });

  it('🔴 줄 수 상한을 넘겨 저장돼 있어도 잘라 읽는다', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `o${i}`, price: 1 }));
    expect(readCustomOptions(many)).toHaveLength(CUSTOM_OPTION_MAX_ROWS);
  });
});
