import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **면세구분 · 영업용 번호판은 묻지 않는다** (2026-08-21).
 *
 * 영업이 그 자리에서 답을 알기 어려운데 **금액은 바뀌는** 값이라
 * (번호판=차량 취득세 5%↔4%, 면세구분=서울 공채할인), 아무거나 고른 답이 실구매가로 굳었다.
 *
 * 🔴 **「부가세 환급 시 가격」은 여기 딸린 이야기가 아니다.**
 *    그 칸을 빼는 것은 **특장만 견적에 한한다.** 총견적서에는 그대로 있어야 한다 —
 *    차를 사는 고객에게는 환급 후 금액이 실제로 의미가 있는 숫자다.
 *    한 번 이것을 총견적서에서까지 지웠다가 되돌렸다. 그래서 **양쪽을 다 못박는다.**
 *
 * ⚠️ **지운 것은 화면뿐이다.** 계산식도 DB 컬럼도 그대로 둔다 —
 *    이미 저장된 견적은 그때 고른 값으로 계속 계산되어야 한다(운영 데이터 불변 원칙).
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 양식에서 한 갈래(`<!-- each:NAME -->` ~ `<!-- /each:NAME -->`)의 **찍히는 행**만 잘라 온다. */
function branch(tpl: string, name: string): string {
  const m = tpl.match(new RegExp(`<!-- each:${name} -->([\\s\\S]*?)<!-- /each:${name} -->`));
  if (!m) throw new Error(`양식에 ${name} 갈래가 없다`);
  // 주석에는 「왜 이렇게 했는지」가 적혀 있다 — 찍히는 행만 보려면 걷어내야 한다
  return m[1]!.replace(/<!--[\s\S]*?-->/g, '');
}

describe('면세구분·영업용 번호판', () => {
  it('견적서 양식에 영업용 번호판 칸이 없다', () => {
    const rows = read('doc-templates/quote-template.html').replace(/<!--[\s\S]*?-->/g, '');
    expect(rows).not.toContain('영업용 번호판');
    expect(rows).not.toContain('cust.hasCommercialPlate');
  });

  it('견적서 생성·수정 팝업이 그 값을 묻지 않는다', () => {
    for (const f of ['frontend/src/components/ConfirmQuoteModal.tsx', 'frontend/src/components/QuoteEditModal.tsx']) {
      const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/TAX_EXEMPT_OPTIONS/);
      expect(src, f).not.toMatch(/setBizPlate|setTaxExempt/);
    }
  });

  it('저장할 때 그 값을 **덮어쓰지 않는다**', () => {
    /*
     * 여기가 진짜 위험한 곳이다. 더 이상 묻지 않는 값을 기본값으로 실어 보내면,
     * 예전 견적을 열어 「저장」만 눌러도 실구매가가 소리 없이 달라진다.
     * PATCH /quotes/:id/inputs 는 받은 키만 덮어쓰므로(merge), 아예 빼는 것이 답이다.
     */
    for (const f of ['frontend/src/components/ConfirmQuoteModal.tsx', 'frontend/src/components/QuoteEditModal.tsx']) {
      const src = read(f)
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
        /*
         * 이력 탭의 «필드코드 → 사람이 읽는 이름» 표는 남겨 둔다.
         * 예전 견적의 이력에 그 필드가 이미 들어 있어, 이름을 빼면 이력이 날코드로 보인다.
         * 보내는지만 보려는 것이므로 그 표는 걷어내고 본다.
         */
        .replace(/const FIELD_KO[\s\S]*?\n\}/, '');
      expect(src, f).not.toMatch(/tax_exempt_type\s*:/);
      expect(src, f).not.toMatch(/has_biz_plate\s*:/);
    }
  });

  it('🔴 「부가세 환급 시 가격」은 총견적서에 **있고**, 특장만 견적에만 없다', () => {
    /*
     * 실수한 적이 있다 — 특장만 견적에서 빼라는 것을 총견적서에서까지 지웠다.
     * 그래서 「없다」만 확인하지 않고 **있어야 할 쪽도 함께** 확인한다.
     * 한쪽만 보는 테스트였다면 그때 통과했을 것이다.
     */
    const tpl = read('doc-templates/quote-template.html');
    // 차를 사는 고객에게는 환급 후 금액이 실제로 의미가 있는 숫자다
    expect(branch(tpl, 'custNormal'), '총견적서').toContain('부가세 환급 시 가격');
    expect(branch(tpl, 'custNormal'), '총견적서').toContain('cust.vatRefundPrice');
    // 특장만은 낼 금액이 옆 칸의 「특장 총 금액」이라, 맨 아랫줄의 굵은 숫자를 그것으로 읽는다
    expect(branch(tpl, 'custOnly'), '특장만 견적').not.toContain('부가세 환급 시 가격');
    expect(branch(tpl, 'custOnly'), '특장만 견적').not.toContain('cust.vatRefundPrice');
  });

  it('계산과 DB 는 그대로다 — 지운 것은 화면뿐이다', () => {
    // 예전 견적은 그때 고른 값으로 계속 계산되어야 한다. 계산식을 지우면 값이 통째로 바뀐다.
    expect(read('shared/pricing/quote.ts')).toContain('p.has_biz_plate ? p.acq_tax_rate_biz');
    expect(read('backend/src/services/quote-calc.ts')).toContain('has_biz_plate: customer?.has_biz_plate');
    expect(read('backend/src/services/quote-calc.ts')).toContain('tax_exempt_type');
  });
});
