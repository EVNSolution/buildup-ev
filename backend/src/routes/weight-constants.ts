/**
 * 무게계산 상수(weight_constant) 관리자 CRUD — ADMIN 전용.
 * 값을 바꾸면 invalidateWeightConstantsCache() 로 캐시를 비워 다음 서류생성부터 재계산에 반영.
 * DELETE 없음 — 필수 키가 사라지면 buildWeightConstants 가 throw 하므로 UI 에서 삭제는 막는다(값 수정만).
 */
import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { invalidateWeightConstantsCache } from '../services/weight-constants.js';

export const weightConstantsRouter = Router();

// ── GET /weight-constants ───────────────────────────────────────────────────
weightConstantsRouter.get('/', rbac('ADMIN'), async (_req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const rows = await prisma.weightConstant.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
  res.json({
    data: rows.map((r) => ({
      key: r.key,
      category: r.category,
      value: Number(r.value), // Decimal → number
      unit: r.unit,
      description: r.description,
    })),
  });
});

// ── POST /weight-constants — upsert (값 수정) ────────────────────────────────
weightConstantsRouter.post('/', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { key, category, value, unit, description } = req.body as {
    key?: string; category?: string; value?: number; unit?: string | null; description?: string | null;
  };
  if (!key || !category || typeof value !== 'number' || !Number.isFinite(value)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'key, category, value(숫자) 필수' } });
    return;
  }

  const row = await prisma.weightConstant.upsert({
    where: { key },
    update: { category, value, unit: unit ?? null, description: description ?? null },
    create: { key, category, value, unit: unit ?? null, description: description ?? null },
  });
  invalidateWeightConstantsCache();
  res.json({ data: { key: row.key, category: row.category, value: Number(row.value), unit: row.unit, description: row.description } });
});
