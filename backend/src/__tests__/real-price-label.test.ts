import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **「실구매가」라는 말이 두 가지 금액을 가리키면 안 된다.**
 *
 * 가격바는 등록·부대비용을 **뺀** 금액(= 견적서의 「부가세 환급 시 가격」)을 실구매가로 부른다.
 * 목록은 `final_price`(= `real_price`, 등록·부대 **포함**)를 보여 준다. 둘 다 「실구매가」라고
 * 적혀 있어서, 같은 견적인데 화면마다 다른 숫자가 나오는 것처럼 보였다(실제 제보).
 *
 *   견적서 부가세 환급 시 가격  39,973,190
 *   + 차량 등록/부대              775,090
 *   + 특장 등록/부대              642,000
 *   = 목록 실구매가            41,390,280
 *
 * 계산은 맞았고 이름만 겹쳤다. 목록 쪽에 「(기타 포함)」을 붙여 구분한다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** `final_price` 를 사람에게 보여 주는 화면들 */
const LIST_SURFACES = [
  'frontend/src/pages/SalesPage.tsx',
  'frontend/src/pages/AdminPage.tsx',
  'frontend/src/components/QuoteAcceptModal.tsx',
  'frontend/src/components/SalesPerformance.tsx',
];

describe('실구매가 라벨', () => {
  it('🔴 final_price 를 보여 주는 화면은 「실구매가」만 쓰지 않는다 — 범위를 밝힌다', () => {
    const bare: string[] = [];
    let checked = 0;
    for (const f of LIST_SURFACES) {
      const src = read(f);
      if (!src.includes('final_price')) continue;
      checked++;
      for (const m of src.matchAll(/>실구매가</g)) {
        bare.push(`${f} — …${src.slice(Math.max(0, m.index! - 40), m.index! + 10).replace(/\s+/g, ' ')}`);
      }
    }
    expect(checked, 'final_price 를 쓰는 화면을 못 찾았다 — 목록이 낡았다').toBeGreaterThan(2);
    expect(bare, `범위를 안 밝힌 라벨:\n${bare.join('\n')}`).toEqual([]);
  });

  it('🔴 가격바는 그대로 「실구매가」다 — 등록·부대를 뺀 금액이고 견적서와 같은 값이다', () => {
    const bar = read('frontend/src/components/PriceBar.tsx');
    expect(bar).toMatch(/>실구매가</);
    // 별도 비용은 따로 적어 준다 — 이 줄이 사라지면 다시 헷갈린다
    expect(bar).toMatch(/기타 비용 포함/);
  });
});
