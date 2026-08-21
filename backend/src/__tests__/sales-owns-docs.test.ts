import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **견적서·계약서 흐름은 전부 영업 화면에서 실행한다.**
 *
 *   견적서 생성 · 계약서 생성 · 전송 · 서명 요청 · 서명본(종이) 등록
 *
 * **관리자 화면은 조회만 한다.** 열어 보는 것(PDF 열기)은 조회라 남지만,
 * 상태를 바꾸는 동작은 관리자 쪽에 두지 않는다 — 누가 계약을 성립시켰는지가
 * 화면마다 갈리면 나중에 되짚을 수 없다.
 *
 * ⚠️ 관리자 고유 업무(영업 배정 · 제작 배정 · 견적 숨기기)는 이 규칙 밖이다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 상태를 바꾸는 계약 흐름 동작 — 관리자 화면에 있으면 안 된다. */
const DOC_ACTIONS = [
  'registerPaperContract',   // 서명본(종이) 등록
  'confirmQuote',            // 견적서 생성(확정)
  'sendContract',            // 서명 요청
  'sendQuoteEmail',          // 메일 전달
];

describe('견적서·계약서 실행은 영업 화면에만', () => {
  const admin = read('frontend/src/pages/AdminPage.tsx');
  const sales = read('frontend/src/pages/SalesPage.tsx');

  it('관리자 화면에는 계약 흐름 동작이 없다', () => {
    const found = DOC_ACTIONS.filter(a => admin.includes(a));
    expect(found, `관리자 화면에 남아 있다: ${found.join(', ')}`).toEqual([]);
  });

  it('관리자 화면에 서명본 등록 모달이 없다', () => {
    expect(admin).not.toMatch(/PaperContractModal/);
  });

  it('영업 화면이 서명본 등록을 갖고 있다', () => {
    // 관리자에서 걷어내기만 하고 영업에 안 붙이면 그 기능이 통째로 사라진다
    expect(sales).toMatch(/registerPaperContract/);
    expect(sales).toMatch(/PaperContractModal/);
  });

  it('서버는 영업에게 서명본 등록을 연다', () => {
    const route = read('backend/src/routes/contracts.ts');
    const paper = route.slice(route.indexOf("contractsRouter.post('/:id/contract/paper'"));
    expect(paper.slice(0, 220)).toMatch(/rbac\('ADMIN',\s*'SALES'\)/);
    // 계약을 성립시키는 같은 종류의 행위라 발송과 같은 권한을 쓴다
    expect(paper.slice(0, 220)).toMatch(/doc\.send\.sign/);
  });

  it('관리자는 여전히 열어 볼 수 있다 — 조회는 막지 않는다', () => {
    expect(admin).toMatch(/quotes\/\$\{q\.id\}\/pdf/);
    expect(admin).toMatch(/contract\/signed/);
  });
});

/**
 * **고객 서류함은 견적별로 묶어 보여 준다.**
 *
 * 파일 이름만 늘어놓으면 「26-9087 견적서」가 셋 있을 때 무엇이 다른지 알 수 없다.
 * 그래서 견적 단위로 묶고, 각 건에 **고른 사양(옵션 요약)** 을 함께 적는다.
 *
 * 그리고 **팝업도 화면 전환도 없다** — 고객을 누르면 그 자리에서 아래로 펼쳐진다.
 * 서류 확인은 목록을 훑는 일과 이어져 있어, 화면이 바뀌면 어디를 보고 있었는지 잃는다.
 */
describe('고객 서류함', () => {
  const ROOT2 = path.resolve(__dirname, '../../..');
  const readF = (rel: string) => readFileSync(path.join(ROOT2, rel), 'utf8');

  it('서버가 견적별로 묶어 내려준다', () => {
    const route = readF('backend/src/routes/customer-folders.ts');
    expect(route).toMatch(/groupDocsByQuote/);
    expect(route).toMatch(/optionChips/);
    expect(route).toMatch(/orphanDocs/);
  });

  it('옵션 이름은 DB 에서 읽는다', () => {
    // 화면에 표기를 또 적어 두면 옵션 이름을 고쳤을 때 두 곳이 갈린다
    const route = readF('backend/src/routes/customer-folders.ts');
    expect(route).toMatch(/optionValue\.findMany/);
  });

  it('견적번호로 못 잇는 서류를 버리지 않는다', () => {
    const svc = readF('backend/src/services/customer-folders.ts');
    expect(svc).toMatch(/groupDocsByQuote/);
    const route = readF('backend/src/routes/customer-folders.ts');
    expect(route).toMatch(/known\.has/);
  });

  it('화면은 펼치는 방식이다 — 팝업도 화면 전환도 없다', () => {
    const ui = readF('frontend/src/components/CustomerFolders.tsx');
    expect(ui).toMatch(/aria-expanded/);
    // 별도 화면으로 갈아타던 옛 방식(뒤로 가기 버튼)이 남아 있으면 안 된다
    expect(ui).not.toMatch(/← 서류함/);
    expect(ui).not.toMatch(/position: 'fixed'/);
  });

  it('최종본을 맨 위에 고정한다', () => {
    const ui = readF('frontend/src/components/CustomerFolders.tsx');
    expect(ui).toMatch(/frozenAt/);
    expect(ui).toMatch(/최종본/);
  });
});
