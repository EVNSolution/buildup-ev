import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **면세구분 · 영업용 번호판은 묻지 않고, 「부가세 환급 시 가격」은 적지 않는다** (2026-08-21).
 *
 * 왜 뺐나:
 *   · 면세구분·영업용 번호판 — 영업이 그 자리에서 답을 알기 어려운데 **금액은 바뀐다**
 *     (번호판=차량 취득세 5%↔4%, 면세구분=서울 공채할인). 아무거나 고른 답이 실구매가로 굳었다.
 *   · 부가세 환급 시 가격 — 사업자가 **나중에 돌려받는** 돈이라 지금 낼 금액이 아닌데,
 *     고객정보 맨 아랫줄에 굵게 적혀 있어 그것을 결제 금액으로 읽었다.
 *
 * ⚠️ **지운 것은 화면과 양식뿐이다.** 계산식도 DB 컬럼도 그대로 둔다 —
 *    이미 저장된 견적은 그때 고른 값으로 계속 계산되어야 한다(운영 데이터 불변 원칙).
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('면세구분·영업용 번호판·부가세 환급 시 가격', () => {
  it('견적서 양식에 그 칸이 없다', () => {
    const tpl = read('doc-templates/quote-template.html');
    // 주석으로 「왜 뺐는지」는 남겨 두므로, **찍히는 행**만 본다
    const rows = tpl.replace(/<!--[\s\S]*?-->/g, '');
    expect(rows).not.toContain('영업용 번호판');
    expect(rows).not.toContain('부가세 환급 시 가격');
    expect(rows).not.toContain('cust.hasCommercialPlate');
    expect(rows).not.toContain('cust.vatRefundPrice');
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

  it('계산과 DB 는 그대로다 — 지운 것은 화면뿐이다', () => {
    // 예전 견적은 그때 고른 값으로 계속 계산되어야 한다. 계산식을 지우면 값이 통째로 바뀐다.
    expect(read('shared/pricing/quote.ts')).toContain('p.has_biz_plate ? p.acq_tax_rate_biz');
    expect(read('backend/src/services/quote-calc.ts')).toContain('has_biz_plate: customer?.has_biz_plate');
    expect(read('backend/src/services/quote-calc.ts')).toContain('tax_exempt_type');
  });
});
