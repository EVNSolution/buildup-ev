import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { masterBypassEnabled } from '../middleware/rbac.js';

/**
 * **마스터는 모든 기능모듈을 가진다 — 운영에서도.**
 *
 * 예전에는 개발 환경에서만 우회했다(`NODE_ENV !== 'production'`). 그래서 운영의 마스터
 * 계정에서 「옵션DB」·「무게상수」 탭이 보이지 않았다 — 기능모듈 화면에서 켜 주기 전에는
 * 시스템 주인이 자기 시스템의 일부를 못 보는 상태였다(제보).
 *
 * 이런 종류는 **개발에서 늘 통과하므로** 눈으로는 못 잡는다. 환경을 바꿔 가며 시험한다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const original = process.env['NODE_ENV'];
afterEach(() => { process.env['NODE_ENV'] = original; });

describe('마스터 권한', () => {
  it('🔴 운영에서도 마스터는 통과한다', () => {
    process.env['NODE_ENV'] = 'production';
    expect(masterBypassEnabled({ is_master: true })).toBe(true);
  });

  it('개발에서도 마찬가지다 — 환경에 따라 갈리지 않는다', () => {
    for (const env of ['development', 'test', 'production', undefined]) {
      if (env === undefined) delete process.env['NODE_ENV'];
      else process.env['NODE_ENV'] = env;
      expect(masterBypassEnabled({ is_master: true }), `NODE_ENV=${env}`).toBe(true);
    }
  });

  it('🔴 마스터가 아니면 통과하지 않는다 — 우회는 마스터에게만', () => {
    process.env['NODE_ENV'] = 'development';
    expect(masterBypassEnabled({ is_master: false })).toBe(false);
    expect(masterBypassEnabled({})).toBe(false);
  });

  it('🔴 환경을 다시 조건에 넣지 않는다', () => {
    /*
     * `NODE_ENV` 로 가르면 개발에서는 멀쩡하고 운영에서만 탭이 사라진다 —
     * 가장 알아채기 어려운 형태로 되돌아간다.
     */
    const src = readFileSync(path.join(ROOT, 'backend/src/middleware/rbac.ts'), 'utf8');
    const i = src.indexOf('export function masterBypassEnabled');
    const body = src.slice(i, src.indexOf('\n}', i));
    expect(body, '환경 조건이 되살아났다').not.toContain('NODE_ENV');
  });

  it('로그인 응답이 마스터에게 활성 모듈 전체를 준다', () => {
    // 화면의 탭 노출은 이 목록을 읽는다 — 여기가 좁으면 권한이 있어도 탭이 안 보인다
    const auth = readFileSync(path.join(ROOT, 'backend/src/routes/auth.ts'), 'utf8');
    expect(auth).toMatch(/featureModule\.findMany\(\{ where: \{ active: true \} \}\)/);
    expect(auth).toMatch(/permissions = allMods\.map\(m => m\.code\)/);
  });
});
