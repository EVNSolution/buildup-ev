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
