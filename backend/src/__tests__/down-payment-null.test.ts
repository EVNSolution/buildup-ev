import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **`null` 은 「0원」이 아니라 「금액 기준을 푼 것」이다.**
 *
 * 선수금을 금액이 아니라 비율로 되돌리면, 저장할 때 `down_payment_amount: null` 을 보내
 * 값을 지운다. 그래서 **다시 열면 이 칸에 `null` 이 들어온다.**
 *
 * `!== undefined` 로 보면 그 `null` 이 「금액으로 정했다」로 읽혀 두 가지가 깨진다:
 *   · 화면 — 금액 칸에 **`String(null)` = 「null」이라는 글자**가 그대로 찍힌다(실제 제보)
 *   · 계산 — 선수금이 **0원**이 되어, 비율을 30% 로 되돌렸는데 견적서에 0원이 찍힌다
 *
 * 이 파일은 그 실수가 되살아나는 것을 막는다. 실제로 한 번은 계산에서 잡았는데
 * **화면 세 곳을 놓쳤다** — 그래서 「값을 읽는 모든 곳」을 훑는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 선수금 금액을 읽는 곳들 — 여기서 `undefined` 만 보면 `null` 이 새어 들어간다. */
const READERS = [
  'frontend/src/components/DownPaymentFields.tsx',
  'frontend/src/components/ConfirmQuoteModal.tsx',
  'frontend/src/components/QuoteEditModal.tsx',
  'shared/pricing/quote.ts',
  'backend/src/services/quote-calc.ts',
];

describe('선수금 금액의 null 처리', () => {
  it('🔴 금액을 읽는 곳 어디에서도 `!== undefined` 로 판정하지 않는다', () => {
    const bad: string[] = [];
    for (const f of READERS) {
      /*
       * 주석에는 「`!== undefined` 로 보면 안 된다」고 적을 수 있어야 한다 —
       * 왜 이렇게 했는지가 코드 옆에 남아야 다음 사람이 되돌리지 않는다.
       * 그래서 **주석을 걷어내고 실제 코드만** 본다.
       */
      const src = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      for (const line of src.split('\n')) {
        if (!/down_payment_amount|(?<![\w])amount(?![\w])/.test(line)) continue;
        if (/!==\s*undefined/.test(line)) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad, `null 이 새는 곳:\n${bad.join('\n')}`).toEqual([]);
  });

  it('화면이 저장값을 되읽을 때 null 을 「기준 없음」으로 본다', () => {
    for (const f of READERS.slice(0, 3)) {
      const src = read(f);
      expect(src, f).toMatch(/amount'?\]?\s*!=\s*null/);
    }
  });

  it('계산도 같은 규칙을 쓴다', () => {
    expect(read('shared/pricing/quote.ts')).toContain('p.down_payment_amount != null');
    expect(read('backend/src/services/quote-calc.ts')).toContain('extra?.down_payment_amount != null');
  });

  it('타입이 null 을 허용한다 — 안 그러면 어딘가에서 강제 캐스팅으로 덮인다', () => {
    expect(read('shared/pricing/quote.ts')).toMatch(/down_payment_amount\?:\s*number \| null/);
    expect(read('frontend/src/components/DownPaymentFields.tsx')).toMatch(/amount\?:\s*number \| null/);
  });
});
