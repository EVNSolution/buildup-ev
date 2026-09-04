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
   * 마스터는 **모든 기능모듈을 가진다 — 운영에서도.**
   *
   * 한동안 운영에서는 꺼 두었다(감사 가능하게 하려고). 그러자 운영의 마스터 계정에서
   * 「옵션DB」·「무게상수」 탭이 보이지 않았다 — 기능모듈 화면에서 켜 주기 전에는
   * 시스템 주인이 자기 시스템의 일부를 못 보는 상태였다(제보). 규칙을 바꿨다.
   */
  it('🔴 마스터의 모듈 보유는 운영에서도 그대로다', () => {
    process.env['NODE_ENV'] = 'production';
    expect(masterBypassEnabled({ is_master: true })).toBe(true);
    process.env['NODE_ENV'] = 'development';
    expect(masterBypassEnabled({ is_master: true })).toBe(true);
  });

  it('모듈 보유와 역할 보유는 여전히 별개다', () => {
    /*
     * 한동안 둘을 한 함수로 판단해, 운영에서 우회를 끄자 마스터의 화면 전환까지
     * 함께 꺼졌다(2026-08-19). 지금은 둘 다 켜져 있지만 **판단하는 곳은 다르다** —
     * 한쪽을 바꿔도 다른 쪽이 따라 움직이면 안 된다.
     */
    process.env['NODE_ENV'] = 'production';
    expect(masterBypassEnabled({ is_master: true })).toBe(true);
    expect(rolesOf(MASTER)).toHaveLength(3);   // 세 화면은 역할이 정한다
    expect(masterBypassEnabled({ is_master: false })).toBe(false);
  });

  it('마스터가 아니면 가진 역할만', () => {
    process.env['NODE_ENV'] = 'production';
    expect(rolesOf(PLAIN_ADMIN)).toEqual(['ADMIN']);
    expect(masterBypassEnabled({ is_master: false })).toBe(false);
  });
});
