import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readContractDate } from '../services/contract-docgen.js';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * **서류에 찍히는 날짜.**
 *
 * 견적서는 「이 내용이 언제 기준인가」를, 계약서는 「언제 계약했는가」를 말한다.
 * 둘 다 견적을 **만든 날**을 찍고 있어서, 고쳐도 지난 날짜가 그대로 나갔다(제보).
 */
describe('견적일자 — 마지막으로 고친 날', () => {
  it('🔴 견적서는 updated_at 을 찍는다', () => {
    const pdf = read('backend/src/services/quote-pdf.ts');
    expect(pdf).toMatch(/workDate: \(quote\.updated_at \?\? quote\.created_at\)/);
    expect(pdf, '만든 날을 그대로 찍으면 고쳐도 안 바뀐다')
      .not.toMatch(/workDate: quote\.created_at/);
  });

  it('🔴 고칠 때마다 자동으로 채워진다 — 손으로 넣지 않는다', () => {
    /*
     * 수정 경로가 여럿이라(옵션·고객·입력·확정…) 한 곳이라도 빠뜨리면 그 경로로 고친
     * 견적만 날짜가 안 바뀐다. Prisma 가 update 마다 채우게 둔다.
     */
    expect(read('backend/prisma/schema.prisma'))
      .toMatch(/updated_at\s+DateTime\s+@default\(now\(\)\) @updatedAt/);
  });

  it('🔴 옛 견적은 만든 날 그대로 둔다', () => {
    /*
     * 컬럼을 더한 순간(now())으로 채우면 아무도 손대지 않은 견적이 전부
     * 「오늘 고친 것」이 되어, 다시 뽑은 견적서 날짜가 죄다 바뀐다.
     */
    const mig = read('backend/prisma/migrations/20260906000000_add_quote_updated_at/migration.sql');
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS "updated_at"/);
    expect(mig).toMatch(/UPDATE "quote" SET "updated_at" = "created_at"/);
    expect(mig).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  });

  it('🔴 금액 기준 해는 **만든 해** 그대로 — 날짜 표기와 다른 이야기다', () => {
    /*
     * 보조금·세율은 해마다 다르다. 해를 넘겨 메모 한 줄만 고쳤는데 금액이 통째로
     * 바뀌면 이미 고객에게 나간 견적과 어긋난다.
     */
    const pdf = read('backend/src/services/quote-pdf.ts');
    expect(pdf).toMatch(/quoteExtraFromInputs\(inp\), quote\.created_at\.getFullYear\(\)/);
  });
});

describe('계약일자 — 계약서를 만들 때 고른다', () => {
  it('🔴 고른 날이 있으면 그 날, 없으면 오늘', () => {
    const doc = read('backend/src/services/contract-docgen.ts');
    expect(doc).toMatch(/const picked = readContractDate\(inp\['contract_date'\]\)/);
    expect(doc).toMatch(/const d = picked \?\? new Date\(\)/);
    // 견적 만든 날을 쓰면 며칠 지나 계약해도 지난 날짜가 찍힌다
    expect(doc).not.toMatch(/const d = quote\.created_at \?\? new Date\(\)/);
  });

  it('🔴 고른 날은 저장돼 다시 뽑아도 같다', () => {
    // 서명까지 끝난 계약서를 다시 열었을 때 날짜가 바뀌면 안 된다
    expect(read('backend/src/routes/quotes.ts')).toMatch(/'contract_date'\]/);
  });

  it('🔴 제대로 된 날짜만 받는다', () => {
    expect(readContractDate('2026-08-15')?.getFullYear()).toBe(2026);
    expect(readContractDate('2026-08-15')?.getMonth()).toBe(7);   // 0부터
    expect(readContractDate('2026-08-15')?.getDate()).toBe(15);
  });

  it('🔴 없는 날·형식이 다른 값은 무시한다 — 오늘로 떨어진다', () => {
    /*
     * 손으로 고친 값이 들어와도 계약서 생성이 통째로 실패하면 안 된다.
     * 2026-02-31 같은 날은 자바스크립트가 3월로 넘겨 버리므로 되돌려 확인한다.
     */
    for (const bad of ['2026-02-31', '2026-13-01', '20260815', '', 'today', null, undefined, 12345]) {
      expect(readContractDate(bad), String(bad)).toBeNull();
    }
  });

  it('🔴 시간대에 하루 밀리지 않는다 — 현지 정오로 만든다', () => {
    // UTC 자정으로 만들면 한국에서 하루 앞뒤로 밀리는 날이 생긴다
    expect(read('backend/src/services/contract-docgen.ts')).toMatch(/new Date\(y, mo - 1, da, 12, 0, 0\)/);
    expect(readContractDate('2026-01-01')?.getDate()).toBe(1);
    expect(readContractDate('2026-12-31')?.getDate()).toBe(31);
  });

  it('🔴 화면은 계약서 단계에서만 묻고, 기본값은 오늘', () => {
    const modal = read('frontend/src/components/QuoteSaveModal.tsx');
    expect(modal).toMatch(/forContract && \(/);
    expect(modal).toMatch(/type="date" value=\{v\.contract_date\}/);
    expect(modal).toMatch(/export function today\(\)/);
    // 저장까지 이어져야 한다 — 화면에서만 고르면 서류에 안 나간다
    expect(read('frontend/src/pages/SalesPage.tsx')).toMatch(/contract_date: values\.contract_date/);
  });
});
