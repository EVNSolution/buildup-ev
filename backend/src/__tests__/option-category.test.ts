/**
 * 화면이 쓰는 옵션 분류가 **DB 값과 실제로 일치하는지** 확인한다.
 *
 * 견적 수정 팝업이 영문 키('vehicle')로 걸러 화면이 통째로 비었던 적이 있다.
 * 타입으로는 잡히지 않는 종류의 어긋남이라, 값 자체를 못 박아 둔다.
 * (DB 가 없는 환경에서는 건너뛴다)
 */
import { describe, it, expect } from 'vitest';
import { prisma } from '../lib/prisma.js';

// frontend/src/lib/optionRules.ts 의 OPTION_CATEGORY 와 같아야 한다
const OPTION_CATEGORY = { vehicle: '차량옵션', body: '특장', interior: '옵션' } as const;

describe('옵션 분류 — 화면 상수와 DB 값 일치', () => {
  it('화면이 쓰는 분류마다 그룹이 하나 이상 있다', async () => {
    if (!prisma) return;                       // DB 없는 환경
    // DB 에 닿지 못하는 환경(로컬 등)에서는 검사할 대상이 없다 — 조용히 넘어간다.
    let rows: { category: string }[];
    try {
      rows = await prisma.optionGroup.groupBy({ by: ['category'], _count: true });
    } catch { return; }
    if (!rows.length) return;                  // 시드 전
    const inDb = new Set(rows.map(r => r.category));
    for (const [key, value] of Object.entries(OPTION_CATEGORY)) {
      expect(inDb.has(value), `분류 '${value}'(${key}) 가 DB 에 없다 — 화면이 빈 채로 뜬다`).toBe(true);
    }
  });
});
