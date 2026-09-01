import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **부가세 환급 대상 판정은 `shared/pricing/vat-refund.ts` 한 곳에서만 한다.**
 *
 * 예전에는 `biz === 'consumer'` 라는 같은 식이 서버(quote-calc)와 화면(liveQuote)에
 * 따로 적혀 있었다. 그래서 간이과세자를 「환급 불가」로 넣을 때 **두 곳 다 빠뜨렸고**,
 * UI 에는 선택지가 있는데 계산은 환급을 해 주는 상태로 한동안 굴러갔다.
 *
 * 이 파일은 그 갈래가 다시 생기는 것을 막는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** calcQuote 에 넘길 `no_vat_refund` 를 만드는 곳들 */
const BUILDERS = ['backend/src/services/quote-calc.ts', 'frontend/src/lib/liveQuote.ts'];

/** 주석은 걷어낸다 — 「이렇게 쓰면 안 된다」는 설명은 코드 옆에 남아 있어야 한다 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('부가세 환급 판정의 단일 출처', () => {
  it('🔴 파라미터 조립부는 사업자 구분을 직접 비교하지 않는다', () => {
    const bad: string[] = [];
    for (const f of BUILDERS) {
      const src = codeOnly(read(f));
      const line = src.split('\n').find((l) => l.includes('no_vat_refund'));
      expect(line, `${f} 에 no_vat_refund 가 없다`).toBeTruthy();
      if (/['"](consumer|simplified)['"]/.test(line!)) bad.push(`${f}: ${line!.trim()}`);
    }
    expect(bad, `noVatRefund() 를 쓰지 않고 직접 비교한다:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 두 곳 모두 noVatRefund() 를 거친다', () => {
    for (const f of BUILDERS) {
      expect(codeOnly(read(f)), `${f}`).toMatch(/no_vat_refund:\s*noVatRefund\(/);
    }
  });

  it('🔴 규칙 파일에 간이과세자가 들어 있다', () => {
    const rule = codeOnly(read('shared/pricing/vat-refund.ts'));
    expect(rule).toMatch(/'simplified'/);
    expect(rule).toMatch(/'consumer'/);
  });
});
