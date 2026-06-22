import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { MOCK_FEATURE_MODULES } from '../data/auth-mock.js';

export const featureModulesRouter = Router();

/**
 * GET /feature-modules
 * DB 가용 시 Prisma 조회, 아니면 mock 폴백.
 */
featureModulesRouter.get('/', rbac('ADMIN'), async (_req, res): Promise<void> => {
  if (prisma) {
    try {
      const modules = await prisma.featureModule.findMany({
        where: { active: true },
        orderBy: { sort_order: 'asc' },
      });
      res.json({ data: modules });
      return;
    } catch { /* DB 오류 시 mock 폴백 */ }
  }
  res.json({ data: MOCK_FEATURE_MODULES });
});
