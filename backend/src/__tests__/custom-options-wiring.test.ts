import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **커스텀 특장 옵션이 어느 길목에서도 새지 않게** 못을 박는다.
 *
 * 금액이 붙는 값은 길목이 많다 — 화면 계산 · 저장 · 수정 · 견적서 · 계약서.
 * 한 곳만 빠져도 「화면에는 보이는데 서류에는 없는 금액」이 되고, 그건 고객에게
 * 잘못된 금액이 나가는 사고다(#182 가 정확히 그 사고였다).
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 주석·문자열을 걷어낸 실제 코드만 본다 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('합계 조립 — 빠뜨릴 수 없게 타입이 강제한다', () => {
  it('🔴 assembleOptionSum 은 커스텀 목록을 **필수 인자**로 받는다', () => {
    const src = read('shared/pricing/assemble.ts');
    /*
     * 선택 인자로 두면 호출부가 조용히 빠뜨리고, 화면에만 금액이 보이는 상태가 된다.
     * 필수로 두면 컴파일러가 모든 호출부에서 한 번씩 묻는다.
     */
    expect(src).toMatch(/custom: readonly CustomOption\[\],/);
    expect(src).toMatch(/customOptionsSupplySum\(custom\)/);
  });

  it('🔴 모든 호출부가 네 번째 인자를 넘긴다', () => {
    const callers = [
      'backend/src/routes/quotes.ts',
      'backend/src/services/quote-calc.ts',
      'frontend/src/lib/liveQuote.ts',
      'frontend/src/pages/SalesPage.tsx',
      'frontend/src/components/QuoteEditModal.tsx',
    ];
    for (const f of callers) {
      const src = codeOnly(read(f));
      for (const call of src.match(/assembleOptionSum\([\s\S]{0,400}?\)\s*[,;)\n.]/g) ?? []) {
        // 인자 세 개짜리 호출이 남아 있으면 그 자리에서만 금액이 빠진다
        expect(call.split(',').length, `${f} — 인자가 부족한 호출:\n${call}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('반쪽 줄은 저장되지 않는다 — 임시저장도 포함', () => {
  const routes = read('backend/src/routes/quotes.ts');

  it('🔴 판정은 화면과 **같은 함수**로 한다', () => {
    /*
     * 서버가 따로 판정하면 규칙이 갈린다 — 화면은 통과시키고 서버가 막거나, 그 반대다.
     * 어느 쪽이든 쓰는 사람은 「왜 저장이 안 되는지」 알 수 없다.
     */
    expect(routes).toMatch(/checkCustomOptions/);
    expect(read('frontend/src/pages/SalesPage.tsx')).toMatch(/checkCustomOptions\(customOptions\)/);
    expect(read('frontend/src/components/QuoteEditModal.tsx')).toMatch(/checkCustomOptions\(customOptions\)/);
  });

  it('🔴 저장되는 **세 길목 모두** 검사를 거친다', () => {
    // 계산(POST /calculate) · 저장(POST /) · 부분저장(PATCH /:id/inputs)
    expect(routes.match(/takeCustomOptions\(/g)?.length, '검사 호출이 세 곳보다 적다')
      .toBeGreaterThanOrEqual(4);   // 정의 1 + 호출 3
    expect(routes).toMatch(/CUSTOM_OPTION_INCOMPLETE/);
  });

  it('🔴 부분저장 경로에도 예외를 두지 않는다', () => {
    /*
     * 「임시저장이니까 반쪽이어도 괜찮다」로 두면, 컨피규레이터에서 막아 둔 것이
     * 수정 팝업으로 그대로 새어 들어온다.
     */
    expect(routes).toMatch(/if \('custom_options' in body\)/);
    // 저장 허용 목록에 들어 있어야 수정에서 고칠 수 있다
    expect(routes).toMatch(/'custom_options'\]/);
  });
});

describe('서류에 함께 나간다', () => {
  it('🔴 견적서 — ⑦ 특장 가격 **바로 위**에 옵션명 줄로 붙는다', () => {
    const pdf = read('backend/src/services/quote-pdf.ts');
    const custom = pdf.indexOf('readCustomOptions(inp[');
    const promo = pdf.indexOf('const promoAmount');
    expect(custom, '커스텀 행을 만들지 않는다').toBeGreaterThan(0);
    // 고정 6줄 뒤 · 프로모션 줄 앞 — 그래야 ⑦ 바로 위에 온다
    expect(custom).toBeLessThan(promo);
    expect(pdf).toMatch(/topOptions\.push\(\{ label: `\$\{o\.name\} :`/);
  });

  it('🔴 계약서 — 적은 게 없으면 **라벨까지** 빈칸이다', () => {
    const doc = read('backend/src/services/contract-docgen.ts');
    /*
     * 제목만 찍혀 있고 값이 비면 고객은 무언가 빠졌다고 읽는다.
     * 그래서 값이 없을 때는 라벨도 함께 비운다.
     */
    expect(doc).toMatch(/spec_custom_label: customText \? '기타\/커스텀 옵션 추가' : ''/);
    expect(doc).toMatch(/spec_custom: customText/);
  });

  it('🔴 계약서 양식에 두 칸이 실제로 들어 있다', () => {
    const sample = JSON.parse(read('doc-templates/contract-template.sample.json'));
    // 양식 검증기는 이 샘플의 키를 기대 토큰으로 쓴다 — 여기 없으면 양식과 코드가 어긋난다
    expect(Object.keys(sample)).toContain('spec_custom_label');
    expect(Object.keys(sample)).toContain('spec_custom');
  });
});

describe('「커스텀」 배지는 관리자가 정한다', () => {
  it('🔴 목록은 비고가 아니라 배정 때 정한 값을 본다', () => {
    const board = codeOnly(read('frontend/src/components/OrderStepsBoard.tsx'));
    expect(board).toMatch(/o\.custom_badge && <span style=\{s\.custom\}>/);
    // 예전 규칙(비고에 뭐라도 있으면 배지)이 돌아오면 안 된다
    expect(board, '비고로 배지를 추측하고 있다').not.toMatch(/o\.remark\?\.trim\(\) && <span style=\{s\.custom\}/);
  });

  it('🔴 배정 화면에서 켜고 끄고, 서버가 그 값을 저장한다', () => {
    expect(read('frontend/src/pages/AdminPage.tsx')).toMatch(/setCustomBadge/);
    expect(read('backend/src/routes/quotes.ts')).toMatch(/custom_badge: custom_badge === true/);
  });

  it('🔴 이미 배지가 붙어 있던 주문은 그대로 둔다 — 규칙만 바뀌는 변경이다', () => {
    const mig = read('backend/prisma/migrations/20260905000000_add_order_custom_badge/migration.sql');
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS "custom_badge"/);
    expect(mig).toMatch(/UPDATE "order"[\s\S]*btrim\("remark"\) <> ''/);
    // 기존 데이터를 지우거나 되돌리지 않는다
    expect(mig).not.toMatch(/DELETE\s+FROM|TRUNCATE|DROP\s+TABLE/i);
  });
});
