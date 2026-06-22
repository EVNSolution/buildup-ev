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

  it('feature_module 조회 — seed 후 11개 이상', async () => {
    const modules = await prisma.featureModule.findMany();
    expect(modules.length).toBeGreaterThanOrEqual(11);
    expect(modules.map(m => m.code)).toContain('quote.create');
  });

  it('org 조회 — ORG_HQ 존재', async () => {
    const org = await prisma.org.findUnique({ where: { code: 'ORG_HQ' } });
    expect(org).not.toBeNull();
    expect(org?.type).toBe('HQ');
  });

  it('user 조회 — admin 계정 존재', async () => {
    const user = await prisma.user.findUnique({ where: { email: 'admin@evnsolution.com' } });
    expect(user).not.toBeNull();
    expect(user?.role).toBe('ADMIN');
  });
});
