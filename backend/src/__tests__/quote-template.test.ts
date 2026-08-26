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

  /** 열마다 어떤 갈래들이 있는지 — 견적 종류가 늘면 여기에 더한다. */
  const COLUMNS = {
    car:  ['carSection', 'ownedSection'],          // 차량 열: 파는 경우 / 고객 보유
    top:  ['topNormal', 'topOnly', 'topNone'],     // 특장 열: 함께 / 특장만 / 특장 없음
    cust: ['custNormal', 'custOnly'],              // 고객 열: 할부 있음 / 없음
  } as const;

  it('열마다 갈래가 다 있다 — 하나라도 빠지면 그 열만 옛 모양으로 남는다', () => {
    for (const [col, branches] of Object.entries(COLUMNS)) {
      for (const b of branches) expect(inTemplate.has(b), `${col} 의 ${b}`).toBe(true);
    }
  });

  it('갈래마다 정렬용 pad 가 **하나씩** 들어 있다', () => {
    /*
     * pad 는 세 열의 마지막 줄을 같은 가로선에 맞춘다. 갈래에 없으면 그 열만 어긋난다.
     *
     * 개수를 숫자로 박아 두지 않는다 — 견적 종류가 늘 때마다 정당한 변경이 막히고,
     * 통과시키려면 숫자를 고쳐 적게 되어 검사가 받아쓰기가 된다.
     * **갈래 수와 같은지**를 본다.
     */
    for (const [col, branches] of Object.entries(COLUMNS)) {
      const n = (BODY.match(new RegExp(`<!-- pad:${col} -->`, 'g')) ?? []).length;
      expect(n, `pad:${col} (갈래 ${branches.length}개)`).toBe(branches.length);
    }
  });
});
