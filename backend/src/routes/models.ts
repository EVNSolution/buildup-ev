import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import type { TaxConfig } from '@buildup-ev/shared/pricing';

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

// GET /models/:code/pricing-bundle — 클라이언트 실시간 계산용 데이터 1회 로드
modelsRouter.get('/:modelCode/pricing-bundle', rbac('SALES', 'ADMIN'), async (req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const modelCode = req.params['modelCode'] as string;
  const calcYear = Number(req.query['year'] ?? new Date().getFullYear());

  const model = await prisma.vehicleModel.findUnique({ where: { code: modelCode }, select: { code: true } });
  if (!model) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '차종을 찾을 수 없습니다' } });
    return;
  }

  const [ogms, rules, optPrices, doorPrices, taxRows, subsidyNat] = await Promise.all([
    prisma.optionGroupModel.findMany({
      where: { model_code: modelCode, group: { active: true } },
      include: {
        group: {
          include: { values: { where: { active: true }, orderBy: { sort_order: 'asc' } } },
        },
      },
      orderBy: { group: { sort_order: 'asc' } },
    }),
    prisma.optionRule.findMany(),
    prisma.optionPrice.findMany({ where: { model_code: modelCode } }),
    prisma.doorUnitPrice.findMany({ where: { model_code: modelCode } }),
    prisma.taxConfig.findMany(),
    prisma.subsidyNational.findFirst({ where: { model_code: modelCode, year: calcYear } }),
  ]);

  const groups = ogms.map(gm => ({
    code:        gm.group.code,
    category:    gm.group.category,
    name:        gm.group.name,
    select_type: gm.group.select_type,
    required:    gm.group.required,
    values:      gm.group.values.map(v => ({
      code: v.code, name: v.name, vivar_code: v.vivar_code, sort_order: v.sort_order,
    })),
  }));

  const option_prices: Record<string, number> = {};
  for (const op of optPrices) option_prices[op.value_code] = op.supply_price;

  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);
  const tax: TaxConfig = {
    acq_tax_rate:         taxMap['acq_tax_rate']         ?? 0.05,
    special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
    acq_tax_relief_cap:   taxMap['acq_tax_relief_cap']   ?? 1_400_000,
    stamp:        taxMap['stamp']        ?? 2_500,
    plate:        taxMap['plate']        ?? 25_000,
    reg_agency:   taxMap['reg_agency']   ?? 50_000,
    delivery_fee: taxMap['delivery_fee'] ?? 179_000,
    etc_fee:      taxMap['etc_fee']      ?? 50_000,
  };

  res.json({
    data: {
      groups,
      rules,
      option_prices,
      door_unit_prices: doorPrices.map(d => ({ top: d.top, doortype: d.doortype, unit_price: d.unit_price })),
      tax,
      subsidy_national: subsidyNat
        ? { amount: subsidyNat.amount, sosang_rate: Number(subsidyNat.sosang_rate ?? 0) }
        : null,
    },
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
