import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { evidenceFileName, isExtraEvidence, STEP_BY_CODE, stepMapFor } from '@buildup-ev/shared/process';

/**
 * **같은 일을 하는 화면은 같게 보인다.**
 *
 * 특장사 주문 목록과 관리자 「주문 진행」은 하는 일이 같은데 생김새가 달랐다 —
 * 한쪽은 수락 대기/진행 중으로 나뉘고, 다른 쪽은 전부 한 덩어리였다.
 * 같은 주문을 두고 두 사람이 서로 다른 그림을 들고 이야기하게 된다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const ADMIN = read('frontend/src/pages/AdminPage.tsx');
const MAKER = read('frontend/src/pages/MakerPage.tsx');
const SECTIONS = read('frontend/src/components/OrderSections.tsx');
const PANEL = read('frontend/src/components/OrderStepsPanel.tsx');

describe('주문 목록', () => {
  it('🔴 특장사와 관리자가 같은 것을 쓴다', () => {
    expect(MAKER).toContain('<OrderSections');
    expect(ADMIN).toContain('<OrderSections');
    // 각자 보드를 직접 그리면 다시 갈라진다
    expect(MAKER).not.toContain('<OrderStepsBoard');
    expect(ADMIN).not.toContain('<OrderStepsBoard');
  });

  it('🔴 끝난 주문은 단계로 판정한다 — 견적 상태만 믿지 않는다', () => {
    /*
     * 15/15 단계를 다 끝내고 인도까지 찍힌 주문이 견적 상태는 `confirmed` 로 남아
     * 진행 중에 계속 떠 있었다(실측). 카드에는 「모든 단계 완료」라고 적혀 있는데
     * 구획은 진행 중이라, 화면이 스스로 모순됐다.
     */
    expect(SECTIONS).toMatch(/o\.steps\.done >= o\.steps\.total/);
    expect(SECTIONS).toMatch(/o\.quote\.status === 'completed'/);
  });

  it('세 구획 모두 접고 편다', () => {
    expect(SECTIONS).toContain('aria-expanded');
    for (const t of ['수락 대기', '진행 중', '완료']) expect(SECTIONS).toContain(t);
  });

  it('어디에도 안 걸리는 상태는 사라지지 않는다', () => {
    // 진행 중이 「나머지 전부」여야 예상 밖의 상태도 목록에 남는다
    expect(SECTIONS).toMatch(/const active\s*=\s*orders\.filter\(o => o\.quote\.status !== 'assigned' && !finished\(o\)\)/);
  });
});

describe('관리자 견적 목록', () => {
  it('🔴 기간 필터 줄을 없애고 날짜별 접기로 간다', () => {
    /*
     * 상태·시작일·종료일·이름·조회 다섯이 한 줄에 있어 좁은 화면에서 서로를 밀어내
     * 글자가 잘렸다(사진 제보). 날짜 묶음이 「오늘 것만 보기」를 한 번의 누름으로 만든다.
     */
    expect(ADMIN).not.toMatch(/filterFrom/);
    expect(ADMIN).not.toMatch(/filterTo/);
    expect(ADMIN).toContain('useDateGroups');
  });

  it('영업 목록과 같은 훅을 쓴다 — 규칙이 갈라지지 않게', () => {
    expect(read('frontend/src/lib/dateGroups.ts')).toContain('export function useDateGroups');
  });

  it('🔴 좁은 화면 카드 모양은 그대로 둔다', () => {
    // 카드가 표보다 읽기 좋다(제보). 바꾼 것은 묶는 방식뿐이다.
    expect(ADMIN).toContain('qtMob.card');
    expect(ADMIN).toContain('qtMob.groupHead');
  });

  it('🔴 이미 담당 영업이 있는 공개 문의는 「배정 필요」가 아니다', () => {
    /*
     * `source === 'public'` 만 보면 지정이 끝난 건까지 영원히 강조된 채 남는다(제보).
     */
    expect(ADMIN).toMatch(/q\.source === 'public' && !q\.sales_user_id\) \|\| q\.status === 'contracted'/);
  });
});

describe('단계 줄', () => {
  it('🔴 오른쪽 여백이 0 이면 안 된다', () => {
    /*
     * 줄 끝의 「대화」·업로드 버튼이 칸 끝에 딱 붙어 있었다(실측 여백 0px).
     * `zoom: 0.88` 아래에서는 붙어 있는 테두리가 반올림에 깎여 잘린 것처럼 보인다
     * — 같은 제보가 세 번 나왔다.
     */
    for (const name of ['row', 'rowNow', 'rowNowLate']) {
      const i = PANEL.indexOf(`\n  ${name}: {`);
      expect(i, `${name} 스타일이 없다`).toBeGreaterThan(0);
      const decl = PANEL.slice(i, i + 200);
      expect(decl, `${name} 의 오른쪽 여백이 0 이다`).not.toMatch(/padding: 'var\(--sp-2\) 0'/);
      expect(decl).toMatch(/padding: 'var\(--sp-2\) var\(--sp-2\)/);
    }
  });

  it('🔴 완료 날짜는 아랫줄(첨부파일 자리)에 둔다', () => {
    // 머리 줄에 두면 이름·태그·완료취소·날짜·버튼이 한 줄을 다투어 「대화」가 밀려난다
    const head = PANEL.slice(PANEL.indexOf('<span style={s.spacer} />'), PANEL.indexOf('{phase === \'later\' && ('));
    expect(head, '날짜가 머리 줄에 남아 있다').not.toContain('s.doneMeta');
    const sub = PANEL.slice(PANEL.indexOf('<div style={s.doneFiles}>'));
    expect(sub.slice(0, 600)).toContain('s.doneMeta');
  });
});

describe('올린 파일의 이름', () => {
  const mounted = stepMapFor(false)['mounted']!;
  const of = (over: Partial<Parameters<typeof evidenceFileName>[0]> = {}) =>
    evidenceFileName({ orderId: 19, customerName: '여준성', stepLabel: '특장 장착', extra: false, seq: 1, ext: '.jpg', ...over });

  it('주문번호 · 고객명 · 단계로 짓는다 — 「IMG_4821.jpg」로는 아무것도 못 찾는다', () => {
    expect(of()).toBe('19.여준성_특장장착.jpg');
  });

  it('🔴 주문번호가 맨 앞에 온다 — 그래야 주문 단위로 걸러진다', () => {
    /*
     * 파일을 한곳에 모아 놓고 「19번 주문 것만」을 걸려면 앞에서 걸러야 한다.
     * 뒤에 있으면 이름 정렬도 검색도 주문 단위로 묶이지 않는다.
     */
    expect(of()).toMatch(/^19\./);
    expect(of({ orderId: 7, stepLabel: '안전검사 완료' })).toMatch(/^7\./);
  });

  it('선택 증빙은 번호를 붙여 갈라 둔다', () => {
    expect(of({ extra: true })).toBe('19.여준성_특장장착_증빙_1.jpg');
    expect(of({ extra: true, seq: 3 })).toBe('19.여준성_특장장착_증빙_3.jpg');
  });

  it('첫 장에는 번호를 붙이지 않고, 둘째부터 붙인다', () => {
    expect(of({ stepLabel: '안전검사 완료', ext: '.pdf' })).toBe('19.여준성_안전검사완료.pdf');
    expect(of({ stepLabel: '안전검사 완료', ext: '.pdf', seq: 2 })).toBe('19.여준성_안전검사완료_2.pdf');
  });

  it('고객명이 없으면 그 자리를 통째로 뺀다', () => {
    // 비워 두면 `19..특장장착` 처럼 점이 둘 붙은 이름이 생긴다
    expect(of({ customerName: null })).toBe('19.특장장착.jpg');
    expect(of({ customerName: '  ' })).toBe('19.특장장착.jpg');
  });

  it('🔴 고객명에 든 경로 글자와 구분자를 걷어낸다', () => {
    // 고객명은 사람이 적는 값이라 「주식회사 A/B」 같은 이름이 실제로 들어온다
    const n = of({ customerName: '주식회사 A/B' });
    expect(n).toBe('19.주식회사AB_특장장착.jpg');
    expect(n).not.toMatch(/[/\\:*?"<>|\s]/);
  });

  it('회사명이 길어도 파일명이 감당할 만큼만 쓴다', () => {
    const n = of({ customerName: '가'.repeat(120) });
    expect(n.length).toBeLessThan(80);
  });

  it('같은 종류라도 단계가 요구한 것이면 덧증빙이 아니다', () => {
    // 검수 사진은 어디에나 붙지만, 그것을 요구하는 단계에서는 그 단계의 본증빙이다
    expect(isExtraEvidence(mounted, 'inspection_photo')).toBe(true);
    const withPhoto = { ...mounted, evidence: ['inspection_photo' as const] };
    expect(isExtraEvidence(withPhoto, 'inspection_photo')).toBe(false);
  });

  it('🔴 올린 사람 기기의 이름은 지우지 않는다', () => {
    const steps = read('backend/src/routes/steps.ts');
    expect(steps).toContain('original_name: safeDisplayName(file.originalname');
    expect(steps).toContain('display_name: displayName');
    // 화면·내려받기는 새 이름을 쓰되, 옛 파일은 예전 이름으로 돌아간다
    expect(steps).toContain('f.display_name ?? f.original_name');
  });

  it('🔴 두 경로 모두 이름을 짓고 **저장까지** 한다', () => {
    /*
     * 파일이 들어오는 길은 둘이다 — 증빙 업로드, 그리고 대화 사진을 증빙으로 등록.
     * 한쪽만 이름을 지으면 같은 자리의 파일이 두 규칙으로 섞인다(실제로 등록 쪽이 빠져 있었다).
     *
     * ⚠️ 「지었는가」만 보면 부족하다 — 계산해 놓고 저장하지 않아도 통과한다.
     *    실제로 그렇게 되돌려 봤더니 이 검사가 놓쳤다. 저장까지 함께 본다.
     */
    const steps = read('backend/src/routes/steps.ts');
    expect(steps.match(/orderId: id, customerName: r\.order\.customer_name/g)?.length, '이름을 짓는 곳이 둘이 아니다').toBe(2);
    expect(steps.match(/display_name: displayName/g)?.length, '지은 이름을 저장하지 않는 곳이 있다').toBe(2);
    expect(steps).toContain('customer: { select: { name: true } }');
  });

  it('모든 단계 이름이 파일명으로 쓸 수 있다 — 경로 구분자가 없다', () => {
    for (const def of Object.values(STEP_BY_CODE)) {
      const name = of({ stepLabel: def.label });
      expect(name, `${def.label} 이 파일명으로 위험하다`).not.toMatch(/[/\\:*?"<>|]/);
      expect(name).not.toMatch(/\s/);
    }
  });
});

describe('올린 파일 열람', () => {
  const VIEWER = read('frontend/src/components/FileViewer.tsx');
  const LINK = read('frontend/src/components/DocLink.tsx');

  it('🔴 새 탭으로 넘기지 않고 그 자리에 덮는다', () => {
    /*
     * 탭이 바뀌면 보던 주문이 뒤로 밀리고, 휴대폰에서 돌아오려면 브라우저 탭 목록을
     * 거쳐야 해서 멀다(제보 — 「카톡처럼 넘기지 말고 바로 띄워 달라」).
     */
    expect(LINK, '아직 새 탭으로 연다').not.toContain('openPdf');
    expect(LINK).toContain('FileViewer');
  });

  it('🔴 뒤로가기 한 번이면 닫힌다', () => {
    // 닫는 길이 화면 안 버튼 하나뿐이면 휴대폰에서 갇힌다
    expect(VIEWER).toContain('useBackClose(true, onClose)');
  });

  it('사진과 서류를 각각 맞는 것으로 그린다', () => {
    expect(VIEWER).toMatch(/\.\(jpe\?g\|png\|webp\|gif\|heic\|heif\|bmp\)\$/);
    expect(VIEWER).toContain('<img');
    expect(VIEWER).toContain('<iframe');
  });

  it('브라우저가 못 그릴 때를 위해 내려받기를 남긴다', () => {
    /*
     * `dl=1` 이면 서버가 attachment 로 준다.
     * ⚠️ **주석은 빼고 본다** — 「왜 dl=1 인가」를 적어 둔 주석 때문에 검사가 통과해 버렸다.
     */
    const code = VIEWER.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('dl=1');
    expect(code).toContain('download={name}');
  });

  it('🔴 단계 탭과 서류 탭이 같은 길을 쓴다 — 관리·특장 구분 없이', () => {
    /*
     * 두 화면이 각자 여는 방식을 갖고 있으면, 「파일명을 눌렀을 때」가 자리마다 달라진다.
     * 둘 다 DocLink 를 거치므로 여기 한 번만 고치면 네 조합이 함께 따라온다.
     */
    expect(read('frontend/src/components/OrderStepsPanel.tsx')).toContain('<DocLink');
    expect(read('frontend/src/components/OrderEvidenceList.tsx')).toContain('<DocLink');
  });

  it('Ctrl/Cmd 클릭으로 새 탭에 여는 길은 남긴다', () => {
    expect(LINK).toContain('e.metaKey || e.ctrlKey || e.shiftKey');
  });
});

describe('날짜 머리와 발주서 크기', () => {
  const SHEET = read('frontend/src/components/PurchaseOrderSheet.tsx');

  it('🔴 날짜 줄에 회색 띠를 깔지 않는다', () => {
    /*
     * 목록에 없던 회색 줄이 생겨 「무슨 일이냐」는 제보가 나왔다.
     * 날짜 줄은 **구분자**지 강조가 아니다 — 가르는 것은 가는 선 하나면 충분하다.
     */
    const i = ADMIN.indexOf('\n  groupRow: {');
    expect(i).toBeGreaterThan(0);
    expect(ADMIN.slice(i, i + 120), '회색 배경이 되살아났다').not.toMatch(/background:/);
  });

  it('영업 「내 견적」과 같은 모양을 쓴다', () => {
    // 두 목록의 날짜 줄이 다르게 생기면, 같은 것을 보고도 다른 화면이라고 느낀다
    const sales = read('frontend/src/pages/SalesPage.tsx');
    const decl = "groupRow: { cursor: 'pointer' }";
    expect(sales).toContain(decl);
    expect(ADMIN).toContain(decl);
  });

  it('🔴 발주서는 기준 폭보다 커지지 않는다', () => {
    /*
     * 좁으면 축소해 담는 것이 목적이었는데, 넓은 자리(서류 탭)에서는 1 배를 넘겨
     * 확대돼 화면을 가득 채웠다(제보). 서류는 실물 크기가 있다.
     */
    const i = SHEET.indexOf('\n  frame: {');
    expect(i).toBeGreaterThan(0);
    expect(SHEET.slice(i, i + 600)).toContain('maxWidth: BASE_W');
  });
});

describe('견적 목록 좁히는 줄', () => {
  it('🔴 상태·이름 칸의 높이를 못 박는다', () => {
    /*
     * 공통 규칙은 `min-height` 만 정하고 나머지는 브라우저에 맡긴다. 그러면 사파리가
     * `<select>` 에 자기 고유 높이를 얹어 바로 옆 입력칸과 몇 px 씩 어긋난다(제보).
     * 크롬에서는 둘 다 44px 로 나와 **개발 중에는 보이지 않는다.**
     */
    const i = ADMIN.indexOf('\n  select: {\n    flex:');
    expect(i, '좁히는 줄의 칸 스타일이 없다').toBeGreaterThan(0);
    const decl = ADMIN.slice(i, ADMIN.indexOf('\n  },', i));
    expect(decl).toContain("height: 'var(--h-control)'");
    expect(decl).toContain('boxSizing');
  });

  it('🔴 「배정 필요건만」은 한 번만 그린다', () => {
    /*
     * 자리가 화면 폭에 따라 다르다. 두 자리에 그대로 두면 넓은 화면에서 **두 개가 뜬다** —
     * 하나를 켜도 다른 하나는 꺼진 채라 어느 것이 진짜인지 알 수 없게 된다.
     * 그래서 칸은 컴포넌트 하나로 두고, 어디에 세울지만 고른다.
     */
    expect(ADMIN).toContain('function OnlyAssignToggle(');
    expect(ADMIN.match(/<OnlyAssignToggle/g)?.length, '세우는 자리가 둘이어야 한다').toBe(2);
    // 각 자리는 서로 배타적인 조건을 쓴다
    expect(ADMIN).toMatch(/view === 'list' && isMobile && \(/);
    expect(ADMIN).toMatch(/onlyAssignControl=\{isMobile \? undefined :/);
  });

  it('넓은 화면에서는 좁히는 조건끼리 모인다', () => {
    // 오른쪽 끝에 홀로 두면 왼쪽 것들과 멀어져 「상관없는 버튼」으로 읽힌다(제보)
    const bar = ADMIN.slice(ADMIN.indexOf('<div style={{ ...qt.filterBar'), ADMIN.indexOf('{err && <div style={qt.errMsg}'));
    expect(bar).toContain('{onlyAssignControl}');
  });
});
