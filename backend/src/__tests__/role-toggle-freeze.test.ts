import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { authCookie } from './helpers.js';

/**
 * **역할 토글은 「앞으로 만들 계정의 기본값」이다.**
 *
 * 예전에는 역할 값을 켜고 끄면 그 역할을 가진 모든 계정이 즉시 함께 바뀌었다.
 * 새 기능을 열어 주려고 역할을 켰을 뿐인데 일부러 꺼 두었던 계정까지 열렸고,
 * 반대로 끄면 잘 쓰던 사람들의 화면이 한꺼번에 사라졌다.
 *
 * 소스를 읽어 「그럴 것이다」로 믿을 수 있는 종류가 아니라, 실제 DB 로 태운다.
 */
const app = createApp();
const MODULE = 'vitest.freeze.module';
const ADMIN = 'vitest-freeze-admin@example.invalid';
const KEEPER = 'vitest-freeze-keeper@example.invalid';   // 역할 기본값으로 켜져 있던 사람
const live = !!prisma;

async function effective(email: string): Promise<boolean> {
  const acs = await prisma!.accessControl.findMany({ where: { module_code: MODULE } });
  const role = acs.find(a => a.subject_type === 'role' && a.subject_ref === 'ADMIN');
  const own = acs.find(a => a.subject_type === 'user' && a.subject_ref === email);
  return own ? own.enabled : (role?.enabled ?? false);
}

beforeAll(async () => {
  if (!prisma) return;
  await prisma.featureModule.upsert({
    where: { code: MODULE },
    update: { active: true },
    create: { code: MODULE, name: '시험용 모듈', surface: '관리자', active: true },
  });
  for (const email of [ADMIN, KEEPER]) {
    await prisma.user.upsert({
      where: { email },
      update: { role: 'ADMIN', active: true, status: 'active' },
      create: {
        email, name: '시험계정', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ',
        active: true, status: 'active', password_hash: 'x',
      },
    });
  }
  // 관리자 역할에 이 모듈이 켜져 있고, 두 계정 모두 그 기본값으로 쓰고 있다
  await prisma.accessControl.deleteMany({ where: { module_code: MODULE } });
  await prisma.accessControl.create({
    data: { subject_type: 'role', subject_ref: 'ADMIN', module_code: MODULE, enabled: true },
  });
  // 문을 잠그는 모듈은 이 시험과 무관하지만, 요청자가 account.manage 를 가져야 한다
  await prisma.accessControl.upsert({
    where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: ADMIN, module_code: 'account.manage' } },
    update: { enabled: true },
    create: { subject_type: 'user', subject_ref: ADMIN, module_code: 'account.manage', enabled: true },
  });
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.accessControl.deleteMany({ where: { module_code: { in: [MODULE, 'account.manage'] }, subject_ref: { in: [ADMIN, KEEPER] } } });
  await prisma.accessControl.deleteMany({ where: { module_code: MODULE } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, KEEPER] } } });
  await prisma.featureModule.deleteMany({ where: { code: MODULE } });
});

describe.runIf(live)('역할 기본값을 바꿔도 기존 계정은 그대로다', () => {
  it('🔴 역할을 끄더라도 이미 쓰고 있던 계정은 계속 쓴다', async () => {
    expect(await effective(KEEPER), '시험 전제: 켜져 있어야 한다').toBe(true);

    await request(app)
      .post('/api/v1/access-control')
      .set('Cookie', authCookie(ADMIN, 'ADMIN', 'ORG_HQ'))
      .send({ subject_type: 'role', subject_ref: 'ADMIN', module_code: MODULE, enabled: false })
      .expect(200);

    // 역할 기본값은 꺼졌다
    const role = await prisma!.accessControl.findFirst({
      where: { subject_type: 'role', subject_ref: 'ADMIN', module_code: MODULE },
    });
    expect(role?.enabled).toBe(false);

    // 그런데 이미 있던 계정은 그대로 쓴다 — 굳혀 두었기 때문이다
    expect(await effective(KEEPER), '기존 계정의 권한이 함께 꺼졌다').toBe(true);
  });

  it('굳힌 뒤 다시 켜도 기존 계정은 흔들리지 않는다', async () => {
    await request(app)
      .post('/api/v1/access-control')
      .set('Cookie', authCookie(ADMIN, 'ADMIN', 'ORG_HQ'))
      .send({ subject_type: 'role', subject_ref: 'ADMIN', module_code: MODULE, enabled: true })
      .expect(200);
    expect(await effective(KEEPER)).toBe(true);
  });

  it('🔴 손으로 정해 둔 계정별 값은 덮어쓰지 않는다', async () => {
    // 이 사람만 일부러 꺼 두었다 — 역할을 만지는 김에 지워 버릴 것이 아니다
    await prisma!.accessControl.upsert({
      where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: KEEPER, module_code: MODULE } },
      update: { enabled: false },
      create: { subject_type: 'user', subject_ref: KEEPER, module_code: MODULE, enabled: false },
    });

    await request(app)
      .post('/api/v1/access-control')
      .set('Cookie', authCookie(ADMIN, 'ADMIN', 'ORG_HQ'))
      .send({ subject_type: 'role', subject_ref: 'ADMIN', module_code: MODULE, enabled: true })
      .expect(200);

    expect(await effective(KEEPER), '손으로 꺼 둔 값이 덮였다').toBe(false);
  });
});
