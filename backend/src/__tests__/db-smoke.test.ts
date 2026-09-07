/**
 * DB smoke test — DATABASE_URL 없으면 자동 skip.
 * `docker compose up -d && npm run db:migrate:deploy && npm run db:seed` 후 실행.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const shouldSkip = !process.env.DATABASE_URL;

describe.skipIf(shouldSkip)('DB 연결 smoke test', () => {
  const prisma = new PrismaClient();

  afterAll(() => prisma.$disconnect());

  it('feature_module 조회 — seed 가 들어가 있고 핵심 모듈이 있다', async () => {
    /*
     * ⚠️ 예전에는 「8개」로 못 박았다. 모듈이 늘 때마다 이 검사가 틀리는데,
     *    정작 **모듈이 늘어난 것은 정상**이다(지금 16개). 그래서 오래 빨간 채로 남아
     *    「DB 가 비었다」 같은 진짜 문제까지 함께 묻혔다.
     *
     * 개수는 늘어나는 값이라 단정하지 않는다. 대신 **있어야 하는 것이 있는지**를 본다 —
     * 그건 늘어나도 변하지 않는 사실이다.
     */
    const modules = await prisma.featureModule.findMany();
    expect(modules.length, 'seed 가 안 들어갔다').toBeGreaterThanOrEqual(8);
    const codes = modules.map(m => m.code);
    for (const need of ['quote.create', 'order.confirm', 'order.view', 'account.manage']) {
      expect(codes, `${need} 모듈이 없다`).toContain(need);
    }
    // 코드는 유일해야 한다 — 겹치면 권한 판정이 어느 쪽을 보는지 알 수 없다
    expect(new Set(codes).size, '모듈 코드가 겹친다').toBe(codes.length);
  });

  it('org 조회 — ORG_HQ 존재', async () => {
    const org = await prisma.org.findUnique({ where: { code: 'ORG_HQ' } });
    expect(org).not.toBeNull();
    expect(org?.type).toBe('HQ');
  });

  it('user 조회 — ADMIN 역할 계정이 1개 이상 존재', async () => {
    const count = await prisma.user.count({ where: { role: 'ADMIN' } });
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
