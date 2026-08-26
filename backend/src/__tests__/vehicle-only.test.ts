import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { folderQuoteKind } from '../services/customer-folders.js';

/**
 * **차량만 견적** — 특장을 장착하지 않고 차량만 판다. 특장만 견적의 거울상이다.
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
    // 잠금 판정은 lockedTab 한 곳에 있다 — 탭 표시와 저장 판정이 갈리지 않게
    expect(PANEL).toMatch(/if \(lockedTab\(tab\.key\)\) return/);
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

describe('차량만 견적도 저장할 수 있어야 한다', () => {
  const PANEL = read('frontend/src/components/OptionPanel.tsx');

  it('🔴 잠긴 탭을 「확인 필요」로 세지 않는다', () => {
    /*
     * 「방문하지 않은 탭」을 그대로 세면, 차량만 견적에서는 특장·옵션 탭에 **갈 수가 없어서**
     * 확인이 영영 끝나지 않는다 — 저장 버튼이 「특장·옵션 확인 필요」로 잠긴 채 남는다(실제 제보).
     */
    expect(PANEL).toMatch(/const unseen = TABS\.filter\(\(t\) => !visited\.has\(t\.key\) && !lockedTab\(t\.key\)\)/);
  });

  it('잠금 판정을 한 곳에서 한다 — 탭 표시와 저장 판정이 갈리면 안 된다', () => {
    expect(PANEL).toMatch(/const lockedTab = /);
    // 조건을 손으로 다시 쓴 곳이 없어야 한다
    expect(PANEL).not.toMatch(/vehicleOnly && tab\.key !== 'vehicle'/);
  });

  it('차량 트림 탭에 안내 박스를 끼워 넣지 않는다 — 레이아웃이 밀린다', () => {
    // 잠그기만 하면 될 일에 칸을 더하면 탭 높이가 달라져 화면이 흔들린다
    expect(PANEL).not.toContain('VehicleOnlyNotice');
    expect(read('frontend/src/components/BodyOnlyPanel.tsx')).not.toContain('VehicleOnlyNotice');
  });
});

describe('용어', () => {
  it('🔴 특장은 「얹는다」가 아니라 「장착한다」', () => {
    // 「얹다」는 전문적이지 않다(실제 지적). 특장 문맥에서는 쓰지 않는다.
    const FILES = [
      'shared/pricing/vehicle-only.ts', 'shared/pricing/body-only.ts', 'shared/pricing/quote.ts',
      'frontend/src/components/BodyOnlyPanel.tsx', 'frontend/src/components/OptionPanel.tsx',
      'doc-templates/quote-template.html',
    ];
    const bad = FILES.filter(f => /특장[^\n]{0,40}얹|얹[^\n]{0,20}특장/.test(read(f)));
    expect(bad, `「얹다」가 남은 곳: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('차량만 견적에는 계약서가 없다', () => {
  const SALES = read('frontend/src/pages/SalesPage.tsx');
  const DOCGEN = read('backend/src/services/contract-docgen.ts');
  const CONTRACT = read('backend/src/services/contract.ts');

  it('🔴 서버가 막는다 — 화면만 막으면 API 로 그대로 만들어진다', () => {
    // 계약서는 고객에게 나가는 문서다. 두 겹으로 막는다.
    expect(DOCGEN).toContain('export async function assertContractable');
    for (const [name, src] of [['계약서 렌더', DOCGEN], ['전자서명 발송', CONTRACT], ['서면계약 등록', CONTRACT]] as const) {
      expect(src, name).toContain('assertContractable(quoteId)');
    }
    // 세 길이 모두 같은 문을 지나야 한다
    expect((CONTRACT.match(/assertContractable\(quoteId\)/g) ?? []).length).toBe(2);
  });

  it('🔴 계약 버튼 넷이 잠긴다 — 자리는 지킨다', () => {
    /*
     * 버튼을 없애면 「계약서가 어디 갔지」가 된다. 회색으로 남겨
     * 눌러 보면 왜 안 되는지 알 수 있게 한다.
     */
    expect(SALES).toMatch(/const noContract = isVehicleOnly\(q\)/);
    expect(SALES).toMatch(/noContractWhy/);
    // 계약서 생성 · 서명 요청 · 서명본 등록
    expect((SALES.match(/disabled=\{[^}]*noContract[^}]*\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('메일 전달은 **막지 않는다** — 견적서는 보낼 수 있어야 한다', () => {
    // 계약서만 없는 것이지 견적서가 없는 것이 아니다
    const i = SALES.indexOf('메일 전달');
    const around = SALES.slice(Math.max(0, i - 900), i);
    expect(around).toMatch(/disabled=\{!q\.customer\?\.email\}/);
  });

  it('메일 팝업에서 계약서 첨부칸을 아예 띄우지 않는다', () => {
    // 체크할 수 없는 칸을 회색으로 남기면 「왜 안 되지」를 묻게 된다 — 원래 없는 서류다
    const M = read('frontend/src/components/EmailSendModal.tsx');
    expect(M).toMatch(/const canAttachContract = !noContract/);
    expect(M).toMatch(/\{canAttachContract && \(/);
    // 보낼 때도 그 값을 쓴다 — 화면만 감추고 실제로는 첨부되면 안 된다
    expect(M).toContain('include_contract: attachContract');
  });
});
