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

  it('🔴 조회 버튼들과 같은 줄에 끼지 않는다', () => {
    /*
     * 예전엔 인라인 줄 맨 끝에 있었다. 버튼이 늘면서 화면 밖으로 밀려
     * 가장 중요한 버튼을 가로로 스크롤해야 찾을 수 있었다(실제 제보).
     */
    expect(ADMIN).not.toMatch(/<button style=\{BTN\.rowPrimary\} onClick=\{\(\) => handleOpenConfirm/);
    expect(ADMIN).not.toMatch(/<button style=\{\{ \.\.\.BTN\.rowPrimary, width: '100%' \}\} onClick=\{\(\) => handleOpenConfirm/);
  });

  it('전용 강조 스타일로, 데스크톱과 모바일 양쪽에 있다', () => {
    expect(ADMIN).toContain('assignBtn:');
    // 두 곳(표 / 카드) 모두에서 쓰여야 한다
    expect(ADMIN.match(/style=\{qt\.assignBtn\}/g)?.length).toBe(2);
    expect(ADMIN.match(/style=\{qt\.assignBtnOff\}/g)?.length).toBe(2);
  });

  it('서명 전에는 자리를 지키되 눌리지 않는다', () => {
    // 자리가 사라지면 「여기서 무엇을 하는 화면인지」가 안 보인다
    expect(ADMIN).toContain('assignBtnOff');
    const i = ADMIN.indexOf('assignBtnOff:');
    expect(ADMIN.slice(i, i + 200)).toContain('BTN.disabled');
  });
});
