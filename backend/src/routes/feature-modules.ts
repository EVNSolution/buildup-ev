import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';

export const featureModulesRouter = Router();

featureModulesRouter.get('/', rbac('ADMIN'), async (_req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const modules = await prisma.featureModule.findMany({
    where: { active: true },
    orderBy: { sort_order: 'asc' },
  });
  res.json({ data: modules });
});
