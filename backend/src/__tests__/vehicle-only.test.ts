import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { folderQuoteKind } from '../services/customer-folders.js';

/**
 * **차량만 견적** — 특장을 얹지 않고 차량만 판다. 특장만 견적의 거울상이다.
 *
 * 이 견적은 **견적서까지**다. 계약서(「특장 매매 및 구조변경 계약서」)는 특장이 없는
 * 거래에 맞지 않고, 주문 전환도 하지 않는다 — 특장 제작이 없어 특장사·구조변경·튜닝
 * 단계가 통째로 빈다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('견적 종류 판정', () => {
  it('둘은 동시에 참일 수 없다 — 특장만이 이긴다', () => {
    // 그러면 팔 것이 아무것도 남지 않는다. 먼저 있던 기능을 지켜 기존 견적을 보호한다.
    expect(folderQuoteKind({ body_only: true, vehicle_only: true })).toBe('body');
  });

  it('각각을 알아본다', () => {
    expect(folderQuoteKind({ body_only: true })).toBe('body');
    expect(folderQuoteKind({ vehicle_only: true })).toBe('vehicle');
    expect(folderQuoteKind({})).toBe('full');
    expect(folderQuoteKind(null)).toBe('full');
  });
});

describe('견적서 양식', () => {
  const TPL = read('doc-templates/quote-template.html');
  const PDF = read('backend/src/services/quote-pdf.ts');

  it('특장 열에 「특장 없음」 갈래가 있다', () => {
    expect(TPL).toContain('<!-- each:topNone -->');
    expect(PDF).toContain("renderEach(html, 'topNone'");
  });

  it('🔴 차량만이면 특장 옵션 행을 그리지 않는다', () => {
    // 0원 줄이 줄줄이 서면 「특장을 샀는데 공짜」로 읽힌다
    expect(PDF).toMatch(/renderEach\(html, 'topOptions', vehicleOnly \? \[\] : topOptions\)/);
  });

  it('세 갈래가 서로 배타적이다', () => {
    // topNormal 은 둘 중 어느 쪽도 아닐 때만 나온다
    expect(PDF).toMatch(/renderEach\(html, 'topNormal', \(bodyOnly \|\| vehicleOnly\) \? \[\] : \[\{\}\]\)/);
  });
});

describe('화면', () => {
  const PANEL = read('frontend/src/components/OptionPanel.tsx');
  const EXTRAS = read('frontend/src/components/QuoteExtras.tsx');

  it('🔴 차량만이면 특장·옵션 탭을 누를 수 없다', () => {
    // 고를 수 있게 두면 고른 것이 금액에 안 잡혀 「왜 반영이 안 되냐」가 된다
    expect(PANEL).toMatch(/if \(vehicleOnly && tab\.key !== 'vehicle'\) return/);
    expect(PANEL).toContain('styles.tabOff');
  });

  it('잠긴 탭에 머물러 있으면 차량 탭으로 되돌린다 — 빈 화면을 막는다', () => {
    expect(PANEL).toMatch(/vehicleOnly && activeTab !== 'vehicle'\) setActiveTab\('vehicle'\)/);
  });

  it('🔴 차량만이면 프로모션이 잠긴다 — 특장 옵션에 붙는 할인이다', () => {
    expect(EXTRAS).toMatch(/disabled=\{vehicleOnly\}/);
    expect(EXTRAS).toMatch(/\{showPromo && !vehicleOnly &&/);
  });

  it('지방보조금 소진은 잠기지 않는다 — 차량 보조금이라 그대로 쓴다', () => {
    const i = EXTRAS.indexOf('지방보조금 소진');
    const around = EXTRAS.slice(Math.max(0, i - 700), i);
    expect(around).not.toContain('vehicleOnly');
  });

  it('두 종류를 동시에 고를 수 없다', () => {
    expect(PANEL).toMatch(/BodyOnlyToggle[\s\S]{0,120}disabled=\{!!vehicleOnly\}/);
    expect(PANEL).toMatch(/VehicleOnlyToggle[\s\S]{0,120}disabled=\{!!bodyOnly\}/);
  });
});

describe('목록에서 열어 보지 않고 가린다', () => {
  it('영업 목록·관리자 목록·고객 서류함 셋 다 표시한다', () => {
    expect(read('frontend/src/pages/SalesPage.tsx')).toContain('<QuoteKindTag quote={q} />');
    expect(read('frontend/src/pages/AdminPage.tsx')).toContain('<QuoteKindTag quote={q} />');
    expect(read('frontend/src/components/CustomerFolders.tsx')).toContain('KIND_LABEL[q.kind]');
  });

  it('일반 견적에는 아무것도 붙이지 않는다', () => {
    // 대부분이 일반이라 다 붙이면 표가 배지로 뒤덮여 정작 다른 건이 묻힌다
    expect(read('frontend/src/lib/quoteCustomer.ts')).toMatch(/full:\s*null/);
    expect(read('frontend/src/components/CustomerFolders.tsx')).toMatch(/full:\s*null/);
  });
});
