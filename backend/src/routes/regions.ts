import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { listRegionNames } from '../services/catalog.js';

export const regionsRouter = Router();

// GET /regions — 지역 전체 목록 (시도+시군구 정렬, name 배열 반환)
regionsRouter.get('/', rbac('SALES', 'ADMIN', 'MAKER'), async (_req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  try {
    res.json({ data: await listRegionNames() });
  } catch (e) {
    console.error('[GET /regions]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '지역 목록 조회 중 오류가 발생했습니다.' } });
  }
});
