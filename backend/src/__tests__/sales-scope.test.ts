import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scopedToMine } from '../middleware/rbac.js';
import type { Role } from '@buildup-ev/shared/types';

/**
 * **영업 화면에서는 남의 담당 건을 보지 않는다** — 겸직 계정이라도.
 *
 * 영업과 관리자를 함께 가진 계정은 `isAdmin` 이 참이라, 영업 화면에서도 전사 견적이
 * 보였다. 관리자 화면에서 전체를 보는 것과, 영업으로 일하는 화면에 남의 담당이 섞여
 * 보이는 것은 전혀 다른 일이다(실제 제보).
 *
 * 어느 화면에서 부르는지는 서버가 알 수 없어 화면이 `scope=mine` 을 붙여 알린다.
 * ⚠️ 이 값은 **좁히기만 한다** — 그래서 화면이 보낸 값을 그대로 믿어도 권한이 안 샌다.
 */
const auth = (roles: Role[], is_master = false) =>
  ({ email: 'me@ev.kr', role: roles[0]!, roles, org_code: 'ORG_HQ', is_master });

describe('영업 화면 범위', () => {
  it('겸직 계정도 scope=mine 이면 자기 것만 본다', () => {
    expect(scopedToMine(auth(['ADMIN', 'SALES']), 'mine')).toBe(true);
  });

  it('마스터는 제외한다 — 전수 조사·대리 처리를 해야 한다', () => {
    expect(scopedToMine(auth(['ADMIN', 'SALES'], true), 'mine')).toBe(false);
  });

  it('scope 를 안 붙이면 좁히지 않는다 — 관리자 화면은 그대로다', () => {
    expect(scopedToMine(auth(['ADMIN', 'SALES']), undefined)).toBe(false);
    expect(scopedToMine(auth(['ADMIN', 'SALES']), 'all')).toBe(false);
  });

  it('아무 값이나 좁히지는 않는다 — 정확히 mine 일 때만', () => {
    for (const v of ['MINE', 'mine ', '1', true, {}, null]) {
      expect(scopedToMine(auth(['ADMIN']), v), String(v)).toBe(false);
    }
  });
});

describe('영업 화면이 실제로 scope 를 붙이는가', () => {
  const SALES = readFileSync(path.resolve(__dirname, '../../../frontend/src/pages/SalesPage.tsx'), 'utf8');

  it('견적·주문 목록을 scope=mine 으로 부른다', () => {
    // 서버가 아무리 준비돼 있어도 화면이 안 붙이면 겸직 계정에 전사 견적이 그대로 나온다
    expect(SALES).toMatch(/fetchQuotes\(\{\s*scope:\s*'mine'\s*\}\)/);
    expect(SALES).toMatch(/fetchOrders\(\{\s*scope:\s*'mine'\s*\}\)/);
  });

  it('고객 서류함도 자기 것만 부른다', () => {
    expect(SALES).toMatch(/<CustomerFolders mine \/>/);
  });
});
