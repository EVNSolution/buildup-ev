import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LOCK_MODULE, mergePermissions } from '../lib/permissions.js';

/**
 * **계정 관리 권한으로 스스로를 잠그는 사고를 막는다.**
 *
 * 「계정 관리」와 「기능모듈」 탭은 **둘 다** `account.manage` 로 잠겨 있다.
 * 이 권한을 끄면 되돌릴 화면이 함께 사라지고, 운영에서는 마스터 우회도 꺼져 있어
 * (감사 가능하게 하려고 일부러) 아무도 복구할 수 없다. 실제로 그렇게 막혔다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const ac = (subject_type: string, subject_ref: string, module_code: string, enabled: boolean) =>
  ({ subject_type, subject_ref, module_code, enabled });

describe('계정 관리 권한 — 자기 잠금 방지', () => {
  it('🔴 마스터는 account.manage 를 잃지 않는다 — 역할이 꺼져 있어도', () => {
    const acs = [ac('role', 'ADMIN', 'account.manage', false)];
    expect(mergePermissions(['ADMIN'], 'master@x.com', acs, { is_master: true })).toContain(LOCK_MODULE);
  });

  it('🔴 마스터는 계정 override 로도 잃지 않는다', () => {
    const acs = [
      ac('role', 'ADMIN', 'account.manage', true),
      ac('user', 'master@x.com', 'account.manage', false),
    ];
    expect(mergePermissions(['ADMIN'], 'master@x.com', acs, { is_master: true })).toContain(LOCK_MODULE);
  });

  it('🔴 마스터가 아닌 계정은 그대로다 — 이 보정이 권한을 넓히지 않는다', () => {
    const acs = [ac('role', 'ADMIN', 'account.manage', false)];
    expect(mergePermissions(['ADMIN'], 'a@x.com', acs, { is_master: false })).not.toContain(LOCK_MODULE);
    expect(mergePermissions(['ADMIN'], 'a@x.com', acs)).not.toContain(LOCK_MODULE);
  });

  it('🔴 마스터에게도 account.manage 말고 다른 모듈이 덤으로 붙지 않는다', () => {
    const acs = [ac('role', 'ADMIN', 'order.remove', false)];
    const perms = mergePermissions(['ADMIN'], 'master@x.com', acs, { is_master: true });
    expect(perms).toEqual([LOCK_MODULE]);
  });

  it('🔴 서버는 본인을 잠그는 요청을 거절한다 — 바꾼 뒤를 실제로 계산해서', () => {
    const src = read('backend/src/routes/access-control.ts');
    expect(src).toMatch(/WOULD_LOCK_OUT/);
    // 「막았다」가 아니라 **계산해서** 막아야 한다 — 겸직으로 안 잃으면 통과해야 하므로
    expect(src).toMatch(/mergePermissions\([\s\S]{0,120}after/);
    expect(src).toMatch(/module_code === LOCK_MODULE && enabled === false/);
  });

  it('🔴 두 관리 탭이 같은 권한에 묶여 있다 — 이 사고가 성립하는 이유', () => {
    const page = read('frontend/src/pages/AdminPage.tsx');
    expect(page).toMatch(/key: 'toggles',[^\n]*show: perm\.accounts/);
    expect(page).toMatch(/key: 'accounts',[^\n]*show: perm\.accounts/);
  });
});
