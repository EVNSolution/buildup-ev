import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { findLocalSubsidy } from '../services/catalog.js';

export const subsidyRouter = Router();

// GET /subsidy/local?region=경기 남양주시&year=2026
subsidyRouter.get('/local', rbac('SALES', 'ADMIN'), async (req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const region = req.query['region'] as string | undefined;
  const year   = Number(req.query['year'] ?? new Date().getFullYear());

  if (!region) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'region 파라미터 필요' } });
    return;
  }

  res.json({ data: await findLocalSubsidy(region, year) });
});
