import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **로컬 자동 로그인이 운영으로 새지 않는가.**
 *
 * 비밀번호 없이 들어오는 길을 하나 냈다(로컬 개발용). 이런 길은 **조용히 열린 채로 배포되는 것**이
 * 유일한 실패 방식이다 — 화면에 아무 표시도 없고, 오류도 안 나고, 눈으로는 절대 안 보인다.
 * 그래서 막는 겹을 하나하나 못 박는다.
 *
 *   ① 운영에서는 **라우트를 아예 만들지 않는다**(권한 검사를 끄는 것이 아니다)
 *   ② 그래도 붙었다면 **이 기계에서 온 요청만** 받는다
 *   ③ 배포가 실제로 `NODE_ENV=production` 으로 띄운다 — ①이 걸리려면 이게 참이어야 한다
 *   ④ 화면 쪽 코드는 개발 빌드에만 들어간다
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const before = process.env['NODE_ENV'];
afterAll(() => {
  if (before === undefined) delete process.env['NODE_ENV'];
  else process.env['NODE_ENV'] = before;
});

describe('로컬 자동 로그인은 운영에 없다', () => {
  it('🔴 NODE_ENV=production 이면 꺼진다', async () => {
    const { devAutoLoginEnabled } = await import('../routes/dev-auth.js');
    process.env['NODE_ENV'] = 'production';
    expect(devAutoLoginEnabled(), '운영에서 자동 로그인이 켜져 있다').toBe(false);
    for (const v of ['development', 'test', '']) {
      process.env['NODE_ENV'] = v;
      expect(devAutoLoginEnabled()).toBe(true);
    }
    delete process.env['NODE_ENV'];
    expect(devAutoLoginEnabled(), '값이 없으면 개발로 본다').toBe(true);
  });

  it('🔴 운영으로 띄운 앱에는 /api/v1/dev/login 이 아예 없다', async () => {
    process.env['NODE_ENV'] = 'production';
    const request = (await import('supertest')).default;
    const { createApp } = await import('../app.js');
    const res = await request(createApp()).get('/api/v1/dev/login?email=master@local');
    expect(res.status, '운영 앱에서 자동 로그인 경로가 열렸다').toBe(404);
    expect(res.headers['set-cookie'], '운영 앱이 세션 쿠키를 심었다').toBeUndefined();
  });

  it('🔴 라우트가 붙어 있어도 밖에서 온 요청은 받지 않는다', () => {
    const src = read('backend/src/routes/dev-auth.ts');
    expect(src, '로컬 확인이 사라졌다').toMatch(/127\.0\.0\.1/);
    expect(src, '로컬이 아니면 404 로 덮어야 한다').toMatch(/res\.status\(404\)/);
    // 두 조건을 **모두** 본다 — 운영이면서 로컬인 요청(서버에 들어가서 부르는 것)도 막는다
    expect(src).toMatch(/devAutoLoginEnabled\(\)\s*&&/);
  });

  it('🔴 배포는 NODE_ENV=production 으로 띄운다 — 이게 거짓이면 위 검사가 다 무의미하다', () => {
    expect(read('deploy/remote-deploy.sh')).toMatch(/^NODE_ENV=production/m);
  });

  it('🔴 화면 쪽 자동 로그인은 개발 빌드에만 들어간다', () => {
    const src = read('frontend/src/pages/LoginPage.tsx');
    // import.meta.env.DEV 는 운영 빌드에서 false 로 굳어 이 블록이 통째로 사라진다
    expect(src).toMatch(/if \(!import\.meta\.env\.DEV/);
    expect(src, '호스트 확인까지 겹쳐 둔다').toMatch(/hostname !== 'localhost'/);
  });
});
