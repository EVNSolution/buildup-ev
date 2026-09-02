import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **직접 입력한 차량 가격은 buildQuoteParams 를 부르는 모든 곳에 실려야 한다.**
 *
 * 하나라도 빠지면 그 경로만 트림 단가로 되돌아간다 — 화면에는 4,700만원인데
 * 견적서 PDF 에는 4,965만원이 찍히는 식이다. 실제로 `vehicle_only` 가
 * quote-pdf·contract-docgen 에 실리지 않은 채로 남아 있었다(#309).
 *
 * 새 호출부가 생기면 여기서 걸린다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const CALLERS = [
  'backend/src/routes/quotes.ts',
  'backend/src/services/quote-pdf.ts',
  'backend/src/services/contract-docgen.ts',
  'backend/src/scripts/recalc-quotes.ts',
];

/** `buildQuoteParams( ... )` 호출 전체를 괄호 짝으로 잘라 낸다 */
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

describe('차량 가격 직접 입력의 배선', () => {
  it('🔴 buildQuoteParams 호출부가 모두 car_price_override 를 넘긴다', () => {
    const missing: string[] = [];
    let total = 0;
    for (const f of CALLERS) {
      const src = read(f);
      for (const c of calls(src)) {
        total++;
        if (!c.includes('car_price_override')) {
          missing.push(`${f} — ${c.slice(0, 60).replace(/\s+/g, ' ')}…`);
        }
      }
    }
    expect(total, 'buildQuoteParams 호출을 하나도 못 찾았다 — 파일 목록이 낡았다').toBeGreaterThan(5);
    expect(missing, `car_price_override 를 안 넘기는 호출부:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 저장·복원이 `!= null` 로 판정한다 — `null` 을 0원으로 읽으면 안 된다', () => {
    for (const f of ['backend/src/routes/quotes.ts', 'backend/src/services/quote-pdf.ts']) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const line of code.split('\n').filter((l) => l.includes('car_price_override'))) {
        expect(line, `${f}: ${line.trim()}`).not.toMatch(/!==\s*undefined/);
      }
    }
  });

  it('🔴 화면도 같은 규칙(resolveCarPrice)을 쓴다 — 직접 곱하지 않는다', () => {
    const live = read('frontend/src/lib/liveQuote.ts');
    expect(live).toMatch(/car_price:\s*resolveCarPrice\(/);
    expect(live).not.toMatch(/car_price:\s*Math\.round\(trim_price \* 1\.1\)/);
  });
});
