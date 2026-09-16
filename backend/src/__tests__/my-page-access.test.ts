import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **마이페이지는 자리(프리셋)에 딸린다**(2026-09-16 지시).
 *
 *   · 마스터는 전부 본다
 *   · 그 외에는 **프리셋이 지정된 경우에만** 그 자리 하나
 *   · 미지정이면 마이페이지 자체가 없다
 *
 * 화면 규칙이라 서버 시험으로는 못 부른다 — 규칙을 **한 함수에 모아 두고** 그 함수를 여기서 본다.
 * 화면에서 버튼을 감추는 것만으로는 막은 것이 아니므로, **고객 서류함은 서버에서도** 막는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const SRC = read('frontend/src/components/dashboard/AdminDashboard.tsx');

/** 화면 파일에서 `dashboardsFor` 를 그대로 떼어 와 돌린다 — 규칙이 바뀌면 여기가 먼저 깨진다 */
function dashboardsFor(user: { is_master?: boolean; admin_preset?: string | null } | undefined): { code: string }[] {
  const codes = [...SRC.matchAll(/\{ code: '([a-z_]+)', label:/g)].map(m => ({ code: m[1]! }));
  expect(codes.length, '자리 목록을 읽지 못했다 — 정규식이 코드와 어긋났다').toBeGreaterThan(0);
  if (!user) return [];
  if (user.is_master) return codes;
  return codes.filter(d => d.code === user.admin_preset);
}

describe('마이페이지는 누가 보는가', () => {
  it('🔴 마스터는 모든 자리의 마이페이지를 본다', () => {
    const got = dashboardsFor({ is_master: true }).map(d => d.code);
    expect(got, '생산관리가 빠졌다').toContain('prod_mgr');
    expect(got, '경영관리가 빠졌다').toContain('exec');
    expect(got, '영업관리가 빠졌다').toContain('sales_mgr');
  });

  it('🔴 프리셋이 지정된 계정은 그 자리 하나만 본다', () => {
    for (const code of ['sales_mgr', 'prod_mgr', 'exec']) {
      expect(dashboardsFor({ admin_preset: code }).map(d => d.code)).toEqual([code]);
    }
  });

  it('🔴 프리셋 미지정이면 마이페이지가 없다 — 탭도 뜨지 않는다', () => {
    expect(dashboardsFor({ admin_preset: null })).toEqual([]);
    expect(dashboardsFor({})).toEqual([]);
    expect(dashboardsFor(undefined)).toEqual([]);
    // 탭 자체가 이 함수로 가려진다
    expect(read('frontend/src/pages/AdminPage.tsx')).toMatch(/hasHome = dashboardsFor\(/);
    expect(read('frontend/src/pages/AdminPage.tsx')).toMatch(/key: 'home',\s*label: t\('마이페이지'\), show: perm\.orders && hasHome/);
  });

  it('🔴 아직 만들지 않은 자리(PM)는 빈 판을 띄우지 않는다', () => {
    expect(dashboardsFor({ admin_preset: 'pm' })).toEqual([]);
  });

  it('🔴 고객 서류함은 서버에서도 막는다 — 화면에서 감추는 것은 막은 것이 아니다', () => {
    const src = read('backend/src/routes/customer-folders.ts');
    expect(src, '남의 고객까지 보는 데 customer.view 를 안 본다').toMatch(/hasPermission\(req, 'customer\.view'\)/);
    // 목록·폴더·내려받기 **셋 다** 거쳐야 한다. 하나만 빠져도 주소로 열린다
    expect([...src.matchAll(/if \(!await maySeeOthers\(req, res\)\) return;/g)].length).toBe(3);
    // 영업은 자기 고객만 보므로 권한 없이 통과해야 한다
    expect(src).toMatch(/if \(mine\) return true;/);
  });
});
