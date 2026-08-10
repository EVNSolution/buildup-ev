/**
 * 무게계산 상수(weight_constant) 조회 — ADMIN 전용.
 * 수정은 옵션DB 화면(PUT /option-db/weight_constant)에서 한다 — 변경 이력·되돌리기가 함께 붙는다.
 * DELETE 없음 — 필수 키가 사라지면 buildWeightConstants 가 throw 한다.
 */
import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';

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

// 값 수정은 **옵션DB 화면(/option-db/weight_constant)** 으로 일원화했다.
// 여기에 쓰기 경로를 남겨두면 변경 이력에 남지 않는 수정이 생겨 되돌리기가 어긋난다.
