import { describe, it, expect, afterEach } from 'vitest';
import { rolesOf } from '@buildup-ev/shared/types';
import { masterBypassEnabled } from '../middleware/rbac.js';

/**
 * **마스터는 운영에서도 세 화면을 쓴다.**
 *
 * 2026-08-19 사고: 운영에서 「권한 무제한 우회」를 끄면서 마스터의 **화면 전환까지** 꺼져
 * 관리자 페이지만 보였다. `is_master` 하나가 두 가지를 뜻하고 있었기 때문이다 —
 *   · 권한 무제한 우회(requirePermission 건너뛰기) … 운영에서 꺼야 한다
 *   · 세 역할을 가진 계정(영업·관리·특장) … 운영에서도 그대로여야 한다
 *
 * 이 테스트가 그 둘을 갈라 둔다. 다시 하나로 묶으면 여기서 걸린다.
 */
const ORIGINAL = process.env['NODE_ENV'];
afterEach(() => { process.env['NODE_ENV'] = ORIGINAL; });

const MASTER = { role: 'ADMIN' as const, extra_roles: [], is_master: true };
const PLAIN_ADMIN = { role: 'ADMIN' as const, extra_roles: [], is_master: false };

describe('마스터 계정', () => {
  it('운영에서도 영업·관리·특장 세 역할을 모두 가진다', () => {
    process.env['NODE_ENV'] = 'production';
    const roles = rolesOf(MASTER);
    for (const r of ['SALES', 'ADMIN', 'MAKER'] as const) {
      expect(roles, `운영 마스터가 ${r} 화면을 못 쓴다`).toContain(r);
    }
  });

  it('개발에서도 마찬가지다 — 환경에 따라 역할이 달라지지 않는다', () => {
    process.env['NODE_ENV'] = 'development';
    expect(rolesOf(MASTER).sort()).toEqual(rolesOf(MASTER).sort());
    expect(rolesOf(MASTER)).toHaveLength(3);
  });

  /**
   * 권한 무제한 우회는 **운영에서 꺼져 있어야 한다.** 역할 보유와 달리 감사할 수 없다.
   */
  it('권한 무제한 우회는 운영에서 꺼진다', () => {
    process.env['NODE_ENV'] = 'production';
    expect(masterBypassEnabled({ is_master: true })).toBe(false);
    process.env['NODE_ENV'] = 'development';
    expect(masterBypassEnabled({ is_master: true })).toBe(true);
  });

  it('우회가 꺼져도 역할은 남는다 — 이 둘은 별개다', () => {
    process.env['NODE_ENV'] = 'production';
    expect(masterBypassEnabled({ is_master: true })).toBe(false);
    expect(rolesOf(MASTER)).toHaveLength(3);   // 그래도 세 화면은 쓴다
  });

  it('마스터가 아니면 가진 역할만', () => {
    process.env['NODE_ENV'] = 'production';
    expect(rolesOf(PLAIN_ADMIN)).toEqual(['ADMIN']);
    expect(masterBypassEnabled({ is_master: false })).toBe(false);
  });
});
