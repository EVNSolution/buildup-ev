/**
 * DB smoke test — DATABASE_URL 없으면 자동 skip.
 * `docker compose up -d && npx prisma db push && npx prisma db seed` 후 실행.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

const shouldSkip = !process.env.DATABASE_URL;

describe.skipIf(shouldSkip)('DB 연결 smoke test', () => {
  const prisma = new PrismaClient();

  afterAll(() => prisma.$disconnect());

  it('feature_module 조회 — seed 후 8개', async () => {
    const modules = await prisma.featureModule.findMany();
    expect(modules.length).toBe(8);
    expect(modules.map(m => m.code)).toContain('quote.create');
    expect(modules.map(m => m.code)).toContain('order.confirm');
    expect(modules.map(m => m.code)).toContain('order.view');
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
