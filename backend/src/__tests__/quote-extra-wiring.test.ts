import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { quoteExtraFromInputs } from '../services/quote-calc.js';

/**
 * **저장된 견적을 다시 계산할 때 넘기는 입력은 `quoteExtraFromInputs` 한 곳에서 만든다.**
 *
 * 예전에는 호출부마다 손으로 골라 담았고, 자리마다 담는 항목이 달랐다. 그래서
 *   · 메모만 고쳐도 특장만 견적의 final_price 가 차량+특장으로 되돌아갔고(10,019,640 → 43,619,640)
 *   · 선택을 바꿔도 같았고
 *   · 차량만 견적의 견적서 부가세 환급액이 특장을 포함해 나왔다(32,725,910 → 41,809,550)
 *
 * 항목을 하나 더 넣는 식으로는 또 빠뜨린다. 조립 자체를 한 곳으로 묶고, 여기서 지킨다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const CALLERS = [
  'backend/src/routes/quotes.ts',
  'backend/src/services/quote-pdf.ts',
  'backend/src/services/contract-docgen.ts',
  'backend/src/scripts/recalc-quotes.ts',
];

/** `buildQuoteParams( … )` 호출 전체를 괄호 짝으로 잘라 낸다 */
function calls(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/buildQuoteParams\(/g)) {
    let i = m.index! + m[0].length - 1;
    let depth = 0;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    out.push(src.slice(m.index!, i + 1));
  }
  return out;
}

/** 저장된 견적(quote.inputs / merged)에서 조립하는 호출인가 */
const fromStoredInputs = (call: string) =>
  /\b(inp|merged)\[/.test(call) || /quoteExtraFromInputs\(/.test(call);

describe('저장된 견적의 재계산 입력', () => {
  it('🔴 quote.inputs 로 재계산하는 호출부는 전부 quoteExtraFromInputs 를 쓴다', () => {
    const handRolled: string[] = [];
    let checked = 0;
    for (const f of CALLERS) {
      for (const c of calls(read(f))) {
        if (!fromStoredInputs(c)) continue;   // 요청 본문으로 만드는 호출은 대상이 아니다
        checked++;
        if (!c.includes('quoteExtraFromInputs(')) {
          handRolled.push(`${f} — ${c.slice(0, 70).replace(/\s+/g, ' ')}…`);
        }
      }
    }
    expect(checked, 'inputs 기반 호출을 못 찾았다 — 파일 목록이 낡았다').toBeGreaterThan(4);
    expect(handRolled, `손으로 조립한 곳:\n${handRolled.join('\n')}`).toEqual([]);
  });

  it('🔴 조립 함수가 견적의 성격(특장만·차량만)을 담는다', () => {
    const bodyOnly = quoteExtraFromInputs({ body_only: true });
    expect(bodyOnly.body_only).toBe(true);
    expect(bodyOnly.vehicle_only).toBe(false);

    const vehicleOnly = quoteExtraFromInputs({ vehicle_only: true });
    expect(vehicleOnly.body_only).toBe(false);
    expect(vehicleOnly.vehicle_only).toBe(true);

    const plain = quoteExtraFromInputs({});
    expect(plain.body_only).toBe(false);
    expect(plain.vehicle_only).toBe(false);
  });

  it('🔴 둘 다 참이면 특장만이 이긴다 — 저장할 때 쓰는 규칙과 같다', () => {
    const both = quoteExtraFromInputs({ body_only: true, vehicle_only: true });
    expect(both.body_only).toBe(true);
    expect(both.vehicle_only).toBe(false);
  });

  it('🔴 금액을 바꾸는 입력을 하나도 빠뜨리지 않는다', () => {
    const e = quoteExtraFromInputs({
      down_payment_rate: 0.3, down_payment_amount: 5_000_000, installment_months: 36,
      promotion_zeroed: ['SPOILER'], promotion_discount: 1_000_000,
      local_subsidy_off: true, car_price_override: 47_000_000,
    });
    expect(e).toMatchObject({
      down_payment_rate: 0.3, down_payment_amount: 5_000_000, installment_months: 36,
      promotion_zeroed: ['SPOILER'], promotion_discount: 1_000_000,
      local_subsidy_off: true, car_price_override: 47_000_000,
    });
  });

  it('🔴 차량 가격 직접 입력의 null 은 「0원」이 아니라 「안 씀」이다', () => {
    expect(quoteExtraFromInputs({}).car_price_override).toBeNull();
    expect(quoteExtraFromInputs({ car_price_override: null }).car_price_override).toBeNull();
    expect(quoteExtraFromInputs({ car_price_override: 0 }).car_price_override).toBe(0);
  });

  it('🔴 컨피규레이터에 있는 칸은 수정 팝업에도 있다 — 저장 후 못 고치는 값이 생기면 안 된다', () => {
    const edit = read('frontend/src/components/QuoteEditModal.tsx');
    // 차량 가격 직접 입력 · 트림명 — 컨피규레이터와 **같은 조각**을 쓴다
    expect(edit).toMatch(/CarPriceOverrideBlock/);
    // 저장할 때 두 값을 실어 보낸다(안 보내면 서버 merge 로 옛 값이 남는다)
    expect(edit).toMatch(/car_price_override:/);
    expect(edit).toMatch(/car_trim_label:/);
    // 메모·프로모션도 같은 조각이어야 한다
    expect(edit).toMatch(/QuoteExtras/);
  });

  it('🔴 화면도 같은 규칙(resolveCarPrice)을 쓴다 — 직접 곱하지 않는다', () => {
    const live = read('frontend/src/lib/liveQuote.ts');
    expect(live).toMatch(/car_price:\s*resolveCarPrice\(/);
    expect(live).not.toMatch(/car_price:\s*Math\.round\(trim_price \* 1\.1\)/);
  });
});
