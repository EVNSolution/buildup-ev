import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mergePermissions } from '../lib/permissions.js';

/**
 * **제작 배정 알림은 「받겠다고 켜 둔 사람」에게만 간다.**
 *
 * 예전에는 **활성 관리자 전원**에게 보냈다. 관리자 권한만 있으면 배정 업무와 무관한
 * 사람에게도 계속 갔고, 끌 방법이 아예 없었다(실제 제보: 「그거 절대 안 됨」).
 *
 * 이제 다른 기능과 같은 방식 — 계정별 기능모듈 토글로 고른다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const NOTIFY = read('backend/src/services/notify.ts');
const MODULE = 'notify.assign';

describe('제작 배정 알림 수신자', () => {
  it('🔴 「모든 관리자」로 되돌아가지 않는다', () => {
    /*
     * 되살아나기 쉬운 코드다 — 역할로 긁는 한 줄이면 되니까.
     * 그러면 다시 전원에게 나간다.
     */
    const fn = NOTIFY.slice(NOTIFY.indexOf('async function adminRecipients'), NOTIFY.indexOf('const won ='));
    expect(fn).not.toMatch(/role:\s*'ADMIN'/);
    expect(fn).not.toMatch(/extra_roles:\s*\{\s*has:\s*'ADMIN'/);
  });

  it('화면·API 와 같은 권한 계산을 쓴다', () => {
    // 여기만 따로 판정하면 화면의 토글과 실제 발송이 어긋난다.
    // 판정은 isAssignRecipient 로 떼어 냈고(시험 가능하게), 수신자 조회는 그것만 쓴다.
    const decide = NOTIFY.slice(NOTIFY.indexOf('export function isAssignRecipient'),
                                NOTIFY.indexOf('export async function adminRecipients'));
    expect(decide).toContain('mergePermissions');
    expect(decide).toContain('ASSIGN_NOTIFY_MODULE');

    const fetchAll = NOTIFY.slice(NOTIFY.indexOf('export async function adminRecipients'),
                                  NOTIFY.indexOf('const won ='));
    expect(fetchAll).toContain('isAssignRecipient');
    // 조회 쪽에서 판정을 다시 쓰면 두 규칙이 갈라진다
    expect(fetchAll).not.toContain('mergePermissions');
  });

  it('아무도 안 켰으면 조용히 넘어가지 않고 이유를 남긴다', () => {
    // 서명이 끝난 건이 방치되는 상황이라, 로그에 왜 안 갔는지가 있어야 한다
    expect(NOTIFY).toMatch(/받도록 켜 둔 계정이 없다/);
    expect(NOTIFY).toContain('계정 관리');
  });

  it('기능모듈이 참조 데이터로 등록된다 — 화면에 토글이 생기려면 있어야 한다', () => {
    const sql = read('backend/prisma/migrations/20260821000000_add_notify_assign_module/migration.sql');
    expect(sql).toContain(MODULE);
    // 재실행해도 안전해야 한다(배포는 여러 번 돈다)
    expect(sql).toMatch(/ON CONFLICT[\s\S]*DO NOTHING/i);
    // 기존 행을 건드리면 안 된다
    expect(sql).not.toMatch(/\b(DELETE|TRUNCATE|DROP|UPDATE)\b/i);
    // 관리자 화면에 뜨도록 surface 가 맞아야 한다
    expect(sql).toContain('관리자');
    // 새 환경을 위해 seed 에도 있어야 한다
    expect(read('db/seed/feature_module.csv')).toContain(MODULE);
  });

  it('기본은 아무도 안 받는다 — 역할 기본값을 만들지 않는다', () => {
    const sql = read('backend/prisma/migrations/20260821000000_add_notify_assign_module/migration.sql');
    // access_control 에 역할 기본값을 넣으면 다시 전원 발송이 된다.
    // (주석에는 그 단어를 쓸 수 있어야 하므로 **실제 INSERT 문**만 본다)
    const statements = sql.replace(/--.*$/gm, '');
    expect(statements).not.toMatch(/INSERT\s+INTO\s+"?access_control"?/i);
  });
});

describe('권한 계산이 실제로 그렇게 동작한다', () => {
  const acs = (rows: [string, string, boolean][]) =>
    rows.map(([t, r, e]) => ({ subject_type: t, subject_ref: r, module_code: MODULE, enabled: e }));

  it('아무 설정이 없으면 관리자도 받지 않는다', () => {
    expect(mergePermissions(['ADMIN'], 'a@x.com', acs([]))).not.toContain(MODULE);
  });

  it('계정별로 켜면 그 사람만 받는다', () => {
    const list = acs([['user', 'a@x.com', true]]);
    expect(mergePermissions(['ADMIN'], 'a@x.com', list)).toContain(MODULE);
    expect(mergePermissions(['ADMIN'], 'b@x.com', list)).not.toContain(MODULE);
  });

  it('역할로 켜 두었어도 계정별로 끄면 그 사람은 안 받는다', () => {
    const list = acs([['role', 'ADMIN', true], ['user', 'b@x.com', false]]);
    expect(mergePermissions(['ADMIN'], 'a@x.com', list)).toContain(MODULE);
    expect(mergePermissions(['ADMIN'], 'b@x.com', list)).not.toContain(MODULE);
  });
});

describe('제작 배정 버튼', () => {
  const ADMIN = read('frontend/src/pages/AdminPage.tsx');

  it('🔴 다른 버튼과 같은 줄·같은 크기다', () => {
    /*
     * 한때 아래로 내려 폭 전체를 쓰는 큰 버튼으로 만들었더니
     * 행 높이가 들쭉날쭉해지고 목록이 그 버튼으로 뒤덮였다(실제 제보). 되돌렸다.
     */
    expect(ADMIN).not.toContain('assignRow');
    expect(ADMIN).not.toContain('actionCell');
    const i = ADMIN.indexOf('assignBtn:');
    const decl = ADMIN.slice(i, i + 140);
    expect(decl).toContain('BTN.rowPrimary');   // 다른 버튼과 같은 SM 크기
    expect(decl).not.toContain('BTN.primary');  // MD 로 키우지 않는다
    expect(decl).not.toContain('width');        // 폭 전체를 쓰지 않는다
  });

  it('검정 바탕에 라임 글자 — 같은 검정 버튼(서명본)과 갈린다', () => {
    const i = ADMIN.indexOf('assignBtn:');
    expect(ADMIN.slice(i, i + 140)).toContain("color: 'var(--lime)'");
  });

  it('🔴 배정할 수 있는 건에만 나온다', () => {
    // 서명 전인 건까지 띄웠더니 목록 전체가 뒤덮여 정작 배정할 건이 묻혔다
    expect(ADMIN).not.toContain('assignBtnOff');
    expect(ADMIN).not.toContain('서명 완료 후');
    expect(ADMIN).not.toMatch(/q\.status === 'confirmed' \|\| q\.status === 'contracted'/);
    /*
     * 두 화면(좁은 화면 카드 · 넓은 화면 표) 모두에서 **계약완료 건에만** 뜬다.
     * 카드 쪽은 조건을 변수로 뽑아 쓰므로 표현이 다르다 — 조건 자체가 같은지를 본다.
     */
    expect(ADMIN).toMatch(/const makerAssign = q\.status === 'contracted'/);   // 카드
    expect(ADMIN).toMatch(/\{q\.status === 'contracted' && \(/);              // 표
    // 그 밖의 상태에서 배정 버튼이 열리면 안 된다
    expect(ADMIN).not.toMatch(/status === 'confirmed'.{0,40}제작 배정/s);
  });

  it('🔴 「견적 숨기기」는 되살렸다 — 걷었던 이유를 되풀이하지 않는다', () => {
    /*
     * 2026-09 에 한 번 걷었다. 이유는 「쓰이지 않는데 견적 목록 **상단만 번잡하다**」였다.
     * 정리할 건이 쌓이면서 다시 필요해졌고(2026-09-08 지시), 컬럼을 지우지 않고 둔 덕에
     * 예전 기록이 그대로 살아 있다.
     *
     * 되살리되 **걷었던 이유는 남지 않게** 한다 — 그래서 이 검사는 「없다」가 아니라
     * 「이런 모양으로만 있다」를 지킨다:
     *
     *  ① 관리자 화면에만 있다 — 영업 화면(SalesPage)에는 없다.
     *  ② 목록 상단에 버튼을 더하지 않는다 — 보기 전환의 **셋째 칸**으로 들어간다.
     *  ③ 진행 버튼 줄에 끼지 않는다 — 액션 열이 아니라 **고객명 옆**이다.
     *  ④ 진행 중인 것과 숨긴 것을 **섞지 않는다**(섞으면 무엇이 숨겨졌는지 모른다).
     */
    // ① 영업 화면에는 없다
    expect(read('frontend/src/pages/SalesPage.tsx'), '영업 화면에 숨기기가 생겼다')
      .not.toMatch(/setQuoteHidden/);
    // ② 보기 전환의 셋째 칸
    expect(ADMIN, '「숨긴 견적」 보기가 없다').toMatch(/value: 'hidden' as const/);
    expect(ADMIN).toMatch(/type QuotesView = 'list' \| 'folders' \| 'hidden'/);
    // ③ 액션 열이 아니라 이름 옆
    expect(ADMIN, '숨기기가 이름 칸 밖으로 나갔다').toMatch(/nameCell[\s\S]{0,200}HideQuoteButton/);
    // ④ 숨긴 것만 따로 — 섞어서 부르지 않는다
    expect(ADMIN).toMatch(/fetchQuotes\(hiddenView \? \{ view: 'hidden' \} : \{\}\)/);
    /*
     * ⑤ **상태로 막지 않는다.** 계약서가 나간 건도, 계약이 끝난 건도 숨길 수 있다(2026-09-08 지시).
     *    정리해야 하는 건은 대개 이미 무언가 나간 것들이라, 상태로 막으면 정작 필요한 것을 못 치운다.
     *    대신 **한 번 묻고**(HideConfirm) **되돌릴 수 있게** 한다.
     */
    const routes = read('backend/src/routes/quotes.ts');
    expect(routes).toMatch(/quotesRouter\.patch\('\/:id\/hidden', rbac\('ADMIN'\)/);
    expect(routes, '상태로 막는 조건이 되살아났다').not.toMatch(/SENT_CONTRACT_FILTER/);
    // ⑥ 대신 화면이 한 번 묻는다 — 되돌리기(다시 보이기)는 묻지 않는다
    expect(ADMIN, '숨기기 확인창이 없다').toMatch(/function HideConfirm/);
    expect(ADMIN).toMatch(/hiddenView \? void run\(\) : setAsking\(true\)/);
    });
});
