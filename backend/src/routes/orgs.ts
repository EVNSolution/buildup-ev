import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import type { OrgType } from '@prisma/client';

export const orgsRouter = Router();

// GET /orgs?type=MAKER — 특장사 목록 (확정 모달용, ADMIN only)
orgsRouter.get('/', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { type } = req.query as { type?: string };
  const where: { type?: OrgType; active: boolean } = { active: true };
  if (type) where.type = type.toUpperCase() as OrgType;

  try {
    const orgs = await prisma.org.findMany({ where, orderBy: { name: 'asc' } });
    res.json({ data: orgs });
  } catch (e) {
    console.error('[GET /orgs]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '조직 목록을 불러오는 중 오류가 발생했습니다.' } });
  }
});
