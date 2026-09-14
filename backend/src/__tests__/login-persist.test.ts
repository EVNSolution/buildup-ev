import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';

/**
 * **로그인 유지** — 매일 로그인하지 않는다(2026-09-14 요청).
 *
 * 예전: 로그인 8시간 뒤 쓰는 중이어도 무조건 끊겼다.
 * 지금:
 *   ① 「로그인 상태 유지」(기본) → 마지막으로 쓴 때부터 30일. 쓰는 동안 계속 늘어난다
 *   ② 체크 해제 → 브라우저를 닫으면 끝(만료 없는 쿠키), 8시간 안 쓰면 끝
 *   ③ 끊어야 할 때는 바로 끊긴다 — 비밀번호 변경·관리자 초기화·계정 정지
 *
 * ⚠️ 이 파일은 **실제 인증 경로**를 탄다. 다른 시험은 토큰만 보고 통과시키는 우회를 켜 두는데,
 *    그러면 연장·무효화 코드가 아예 돌지 않는다.
 */
process.env['ALLOW_TEST_AUTH_BYPASS'] = 'false';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { hashPassword } = await import('../lib/password.js');

const app = createApp();
const live = !!prisma;
const SECRET = process.env['JWT_SECRET']!;
const USER = 'persist-user@example.invalid';
const ADMIN = 'persist-admin@example.invalid';
const PW = 'persist-pass-1234';
const DAY = 24 * 3600;

type Claims = { email: string; role: string; org_code: string; rem?: boolean; iat: number; exp: number };

/** 응답에서 access_token 쿠키 한 줄을 꺼낸다 */
function tokenCookie(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? raw as string[] : raw ? [String(raw)] : [];
  return list.find(c => c.startsWith('access_token='));
}
const tokenOf = (cookie: string) => cookie.split(';')[0]!.slice('access_token='.length);
const claims = (cookie: string) => jwt.verify(tokenOf(cookie), SECRET) as Claims;

/** 과거에 발급된 토큰을 만든다 — `ageSec` 초 전 */
function oldToken(email: string, role: string, org: string, ageSec: number, rem: boolean | undefined, ttlSec: number): string {
  const iat = Math.floor(Date.now() / 1000) - ageSec;
  const body: Record<string, unknown> = { email, role, org_code: org, iat, exp: iat + ttlSec };
  if (rem !== undefined) body['rem'] = rem;
  return `access_token=${jwt.sign(body, SECRET)}`;
}
const me = (cookie: string) => request(app).get('/api/v1/auth/me').set('Cookie', cookie);
/** 로그인하지 않은 요청이 받는 응답 — 끊긴 토큰은 이것과 같아야 한다(이 앱은 403) */
let ANON = 0;
const login = (body: object) => request(app).post('/api/v1/auth/login').send({ email: USER, password: PW, ...body });

async function resetUser() {
  await prisma!.user.update({
    where: { email: USER },
    data: { password_hash: await hashPassword(PW), status: 'active', active: true, must_change_pw: false, sessions_valid_after: null },
  });
}

beforeAll(async () => {
  if (!prisma) return;
  ANON = (await request(app).get('/api/v1/auth/me')).status;
  expect(ANON, '로그인 안 한 요청이 통과한다').toBeGreaterThanOrEqual(400);
  const hash = await hashPassword(PW);
  for (const [email, role] of [[USER, 'SALES'], [ADMIN, 'ADMIN']] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active', password_hash: hash, must_change_pw: false, sessions_valid_after: null },
      create: { email, name: '로그인유지시험', role, extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: hash, must_change_pw: false },
    });
  }
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  for (const m of mods) {
    await prisma.accessControl.upsert({
      where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: ADMIN, module_code: m.code } },
      update: { enabled: true },
      create: { subject_type: 'user', subject_ref: ADMIN, module_code: m.code, enabled: true },
    });
  }
});

afterAll(async () => {
  if (!prisma) return;
  // 이 시험이 만든 계정만 치운다
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [USER, ADMIN] } } });
  await prisma.user.deleteMany({ where: { email: { in: [USER, ADMIN] } } });
  process.env['ALLOW_TEST_AUTH_BYPASS'] = 'true';
});

describe.skipIf(!live)('로그인 유지 — 실제 API', () => {
  it('🔴 기본은 30일 유지 — 쿠키도 토큰도 30일', async () => {
    await resetUser();
    const res = await login({});
    expect(res.status).toBe(200);
    const c = tokenCookie(res)!;
    expect(c, '쿠키가 없다').toBeTruthy();
    expect(c).toMatch(/Max-Age=2592000/);
    const t = claims(c);
    expect(t.rem).toBe(true);
    expect(t.exp - t.iat).toBe(30 * DAY);
    expect((await me(`access_token=${tokenOf(c)}`)).status).toBe(200);
  });

  it('🔴 「로그인 상태 유지」를 풀면 브라우저를 닫을 때 끝나는 쿠키 — 8시간', async () => {
    await resetUser();
    const c = tokenCookie(await login({ remember: false }))!;
    expect(c).not.toMatch(/Max-Age|Expires/i);
    const t = claims(c);
    expect(t.rem).toBe(false);
    expect(t.exp - t.iat).toBe(8 * 3600);
  });

  it('🔴 쓰는 동안 늘어난다 — 하루 넘게 묵은 토큰으로 들어오면 새 30일 토큰을 준다', async () => {
    await resetUser();
    const res = await me(oldToken(USER, 'SALES', 'ORG_HQ', 2 * DAY, true, 30 * DAY));
    expect(res.status).toBe(200);
    const c = tokenCookie(res);
    expect(c, '연장되지 않았다 — 30일 뒤엔 쓰는 중이어도 끊긴다').toBeTruthy();
    expect(c).toMatch(/Max-Age=2592000/);
    const t = claims(c!);
    expect(Math.abs(t.iat - Date.now() / 1000)).toBeLessThan(5);
    expect(t.exp - t.iat).toBe(30 * DAY);
  });

  it('🔴 방금 받은 토큰은 매번 갈지 않는다', async () => {
    await resetUser();
    const res = await me(oldToken(USER, 'SALES', 'ORG_HQ', 60, true, 30 * DAY));
    expect(res.status).toBe(200);
    expect(tokenCookie(res)).toBeUndefined();
  });

  it('🔴 유지 안 함도 쓰는 동안은 늘어난다 — 그리고 계속 「닫으면 끝」 쿠키다', async () => {
    await resetUser();
    const res = await me(oldToken(USER, 'SALES', 'ORG_HQ', 3600, false, 8 * 3600));
    const c = tokenCookie(res)!;
    expect(c, '연장되지 않았다').toBeTruthy();
    expect(c).not.toMatch(/Max-Age|Expires/i);
    expect(claims(c).rem).toBe(false);
  });

  it('🔴 이 기능 전에 받은 8시간 토큰은 바로 30일로 갈아 준다 — 기존 사용자가 한 번 더 끊기지 않게', async () => {
    await resetUser();
    const res = await me(oldToken(USER, 'SALES', 'ORG_HQ', 60, undefined, 8 * 3600));
    expect(res.status).toBe(200);
    const c = tokenCookie(res)!;
    expect(c).toMatch(/Max-Age=2592000/);
    expect(claims(c).rem).toBe(true);
  });

  it('🔴 만료된 토큰은 들어오지 못한다', async () => {
    await resetUser();
    expect((await me(oldToken(USER, 'SALES', 'ORG_HQ', 31 * DAY, true, 30 * DAY))).status).toBe(ANON);
  });

  it('🔴 비밀번호를 바꾸면 다른 기기는 끊기고, 바꾼 기기는 이어 쓴다', async () => {
    await resetUser();
    const otherDevice = oldToken(USER, 'SALES', 'ORG_HQ', 30, true, 30 * DAY);
    const thisDevice = oldToken(USER, 'SALES', 'ORG_HQ', 20, true, 30 * DAY);
    expect((await me(otherDevice)).status).toBe(200);
    const ch = await request(app).post('/api/v1/auth/change-password').set('Cookie', thisDevice)
      .send({ current_password: PW, new_password: 'persist-new-5678' });
    expect(ch.status).toBe(200);
    const renewed = tokenCookie(ch);
    expect(renewed, '바꾼 기기에 새 토큰을 안 줬다 — 바꾸자마자 로그아웃된다').toBeTruthy();

    const other = await me(otherDevice);
    expect(other.status, '비밀번호를 바꿨는데 다른 기기가 계속 들어온다').toBe(ANON);
    expect(tokenCookie(other), '무효 토큰 쿠키를 치우지 않았다').toMatch(/access_token=;/);
    expect((await me(`access_token=${tokenOf(renewed!)}`)).status).toBe(200);
  });

  it('🔴 관리자가 비밀번호를 초기화하면 그 계정의 기존 로그인은 끊긴다', async () => {
    await resetUser();
    const userDevice = oldToken(USER, 'SALES', 'ORG_HQ', 30, true, 30 * DAY);
    expect((await me(userDevice)).status).toBe(200);
    const adminCookie = oldToken(ADMIN, 'ADMIN', 'ORG_HQ', 30, true, 30 * DAY);
    const r = await request(app).post(`/api/v1/users/${encodeURIComponent(USER)}/reset-password`).set('Cookie', adminCookie);
    expect(r.status).toBe(200);
    expect((await me(userDevice)).status, '초기화했는데 예전 로그인이 살아 있다').toBe(ANON);
  });

  it('🔴 정지된 계정은 유지 기간이 남아 있어도 못 들어오고, 연장도 안 된다', async () => {
    await resetUser();
    await prisma!.user.update({ where: { email: USER }, data: { status: 'suspended' } });
    const res = await me(oldToken(USER, 'SALES', 'ORG_HQ', 2 * DAY, true, 30 * DAY));
    expect(res.status).toBe(ANON);
    expect(tokenCookie(res)).toBeUndefined();
    await resetUser();
  });
});
