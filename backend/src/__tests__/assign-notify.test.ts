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
    // 여기만 따로 판정하면 화면의 토글과 실제 발송이 어긋난다
    const fn = NOTIFY.slice(NOTIFY.indexOf('async function adminRecipients'), NOTIFY.indexOf('const won ='));
    expect(fn).toContain('mergePermissions');
    expect(fn).toContain('ASSIGN_NOTIFY_MODULE');
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
    expect(ADMIN.match(/\{q\.status === 'contracted' && \(/g)?.length).toBe(2);
  });

  it('🔴 「견적 숨기기」는 없앴다 — 되살아나지 않게 못박는다', () => {
    /*
     * 쓰이지 않았고 견적 목록 상단만 번잡하게 했다(제보).
     * 화면·API 양쪽에서 걷어냈고, 목록도 숨김 여부로 거르지 않아
     * **예전에 숨긴 건도 다시 보인다** — 화면에서 사라져 못 찾는 건이 남지 않게.
     *
     * ⚠️ `hidden_at` 컬럼과 고객 숨기기는 그대로다 — 기능을 걷었다고 기록까지 지우지 않는다.
     */
    // 주석은 뺀다 — 「왜 없앴는지」는 코드 옆에 남겨 두어야 다음 사람이 되살리지 않는다
    const code = ADMIN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '숨기기 버튼이 되살아났다').not.toMatch(/견적 숨기기/);
    expect(read('backend/src/routes/quotes.ts'), '숨김 라우트가 되살아났다')
      .not.toMatch(/quotesRouter\.patch\('\/:id\/hidden'/);
    // 목록은 숨김 여부를 조건에 넣지 않는다
    expect(ADMIN).not.toMatch(/to: filterTo \|\| undefined, view \}/);
  });
});
