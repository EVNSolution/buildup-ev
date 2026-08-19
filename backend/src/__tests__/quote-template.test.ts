import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **양식의 반복 블록과 그것을 채우는 코드가 짝이 맞는가.**
 *
 * 견적서 양식은 `<!-- each:NAME -->` 로 갈래를 가른다(엔진에 if 가 없어서, 0/1 개짜리
 * 배열로 갈래를 표현한다). 그런데 이름이 어긋나면 **에러가 나지 않는다** —
 * 렌더러가 못 찾은 블록을 그냥 두고 지나가, 갈래 **둘 다** 견적서에 찍힌다.
 * 차를 안 사는 견적서에 차량 할부표가 함께 나가는 식이라, 눈으로 봐야만 알 수 있다.
 *
 * 그래서 양식이 쓰는 이름과 코드가 부르는 이름이 **정확히 같은 집합**인지 못박는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const TEMPLATE = readFileSync(path.join(ROOT, 'doc-templates/quote-template.html'), 'utf-8');
const SERVICE = readFileSync(path.join(ROOT, 'backend/src/services/quote-pdf.ts'), 'utf-8');

/** 양식 머리말의 설명 주석에는 예시가 들어 있다 — 실제 블록만 세도록 걷어낸다. */
const BODY = TEMPLATE.replace(/<!--\s*\n\s*STEGO-K1 견적서 양식[\s\S]*?\n-->/, '');

function names(src: string, re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(re)) out.add(m[1]!);
  return out;
}

describe('견적서 양식 — 반복 블록과 렌더 코드가 짝이 맞는다', () => {
  const inTemplate = names(BODY, /<!-- each:(\w+) -->/g);
  const inCode = names(SERVICE, /renderEach\(html, '(\w+)'/g);

  it('양식의 모든 each 블록을 코드가 채운다', () => {
    // 안 채우면 갈래가 둘 다 남아 견적서에 두 벌이 찍힌다
    const unfilled = [...inTemplate].filter(n => !inCode.has(n));
    expect(unfilled, `양식에만 있는 블록: ${unfilled.join(', ')}`).toEqual([]);
  });

  it('코드가 부르는 이름이 모두 양식에 있다', () => {
    // 오타로 어긋나면 조용히 아무 일도 일어나지 않는다
    const missing = [...inCode].filter(n => !inTemplate.has(n));
    expect(missing, `코드에만 있는 블록: ${missing.join(', ')}`).toEqual([]);
  });

  it('열마다 갈래가 짝을 이룬다 — 차량·특장·고객 셋 다', () => {
    // 한 열만 갈라 두면 특장만 견적서에서 그 열만 옛 모양으로 남는다
    for (const [a, b] of [['carSection', 'ownedSection'], ['topNormal', 'topOnly'], ['custNormal', 'custOnly']]) {
      expect(inTemplate.has(a!), a).toBe(true);
      expect(inTemplate.has(b!), b).toBe(true);
    }
  });

  it('갈래마다 정렬용 pad 가 하나씩 들어 있다', () => {
    // pad 는 세 열의 마지막 줄을 같은 가로선에 맞춘다. 갈래에 없으면 그 열만 어긋난다.
    for (const col of ['car', 'top', 'cust']) {
      const n = (BODY.match(new RegExp(`<!-- pad:${col} -->`, 'g')) ?? []).length;
      expect(n, `pad:${col}`).toBe(2);   // 일반 갈래 1 + 특장만 갈래 1
    }
  });
});
