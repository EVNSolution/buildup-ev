import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';

export const modelsRouter = Router();

modelsRouter.get('/', rbac('SALES', 'ADMIN'), async (_req, res): Promise<void> => {
  if (prisma) {
    try {
      const models = await prisma.vehicleModel.findMany({
        where: { active: true },
        orderBy: { code: 'asc' },
      });
      res.json({ data: models });
      return;
    } catch { /* DB 오류 시 mock 폴백 */ }
  }
  res.json({
    data: [{
      code: 'PV5_OPENBED', name: 'PV5 오픈베드',
      drive_type: '4x2', seats_default: 2, wheelbase_mm: 2995,
      curb_weight_kg: 1905, curb_axle_front_kg: 1105, curb_axle_rear_kg: 800,
      gvw_limit_kg: null, active: true,
    }],
  });
});

modelsRouter.get('/:modelCode/options', rbac('SALES', 'ADMIN'), async (req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const modelCode = req.params['modelCode'] as string;
  const model = await prisma.vehicleModel.findUnique({
    where: { code: modelCode },
    select: { code: true },
  });
  if (!model) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '차종을 찾을 수 없습니다' } });
    return;
  }
  const [ogms, rules] = await Promise.all([
    prisma.optionGroupModel.findMany({
      where: { model_code: modelCode, group: { active: true } },
      include: {
        group: {
          include: {
            values: { where: { active: true }, orderBy: { sort_order: 'asc' } },
          },
        },
      },
      orderBy: { group: { sort_order: 'asc' } },
    }),
    prisma.optionRule.findMany(),
  ]);
  const groups = ogms.map(gm => ({
    code:        gm.group.code,
    category:    gm.group.category,
    name:        gm.group.name,
    select_type: gm.group.select_type,
    required:    gm.group.required,
    values:      gm.group.values.map(v => ({
      code:       v.code,
      name:       v.name,
      vivar_code: v.vivar_code,
      sort_order: v.sort_order,
    })),
  }));
  res.json({ data: { groups, rules } });
});
