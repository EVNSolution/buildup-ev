import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { calcPrice, type PricingParams } from '@buildup-ev/shared/pricing';

export const quotesRouter = Router();

// POST /quotes/calculate — 실구매가 계산 (미저장)
quotesRouter.post('/calculate', rbac('SALES'), async (req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }

  const body = req.body as {
    model_code?: string;
    year?: number;
    selections?: Record<string, string>;
    customer?: { biz_type?: string; is_sosang?: boolean; region?: string };
  };

  const { model_code, year, selections, customer } = body;

  if (!model_code || !selections || !customer?.biz_type) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '필수 파라미터 누락 (model_code, selections, customer.biz_type)' } });
    return;
  }

  const calcYear  = year ?? new Date().getFullYear();
  const bodytypeCode = selections['BODYTYPE'] ?? '';
  const trimCode     = selections['TRIM']     ?? '';
  const topCode      = selections['TOP']      ?? '';
  const doorTypeCode = selections['DOORTYPE'] ?? '';
  const doorAddCode  = selections['DOORADD']  ?? '';
  const selectedCodes = Object.values(selections);

  const [optionPrices, doorPrices, optionValues, subsidyNat, subsidyLoc, taxRows] =
    await Promise.all([
      prisma.optionPrice.findMany({ where: { model_code } }),
      prisma.doorUnitPrice.findMany({ where: { model_code } }),
      prisma.optionValue.findMany({ where: { code: { in: [topCode, doorTypeCode] } } }),
      prisma.subsidyNational.findFirst({ where: { model_code, year: calcYear } }),
      customer.region
        ? prisma.subsidyLocal.findFirst({ where: { region: customer.region, year: calcYear } })
        : Promise.resolve(null),
      prisma.taxConfig.findMany(),
    ]);

  // option_prices 맵
  const priceMap: Record<string, number> = {};
  for (const op of optionPrices) priceMap[op.value_code] = op.supply_price;

  // 도어 단품가 해석 — option_value.name이 door_unit_price 테이블 key
  const topName      = optionValues.find(v => v.code === topCode)?.name      ?? '';
  const doorTypeName = optionValues.find(v => v.code === doorTypeCode)?.name ?? '';
  const baseSwing    = doorPrices.find(d => d.top === topName && d.doortype === '여닫이')?.unit_price   ?? 0;
  const selectedDoor = doorPrices.find(d => d.top === topName && d.doortype === doorTypeName)?.unit_price ?? 0;

  // tax_config 변환
  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);

  const params: PricingParams = {
    bodytype_code: bodytypeCode,
    trim_code:     trimCode,
    selected_value_codes: selectedCodes,
    door: {
      base_swing_price: baseSwing,
      selected_price:   selectedDoor,
      has_extra: doorAddCode === 'ADD_DRIVER',
    },
    option_prices: priceMap,
    subsidy_national:    subsidyNat?.amount        ?? 0,
    subsidy_sosang_rate: subsidyNat?.sosang_rate   ? Number(subsidyNat.sosang_rate) : 0,
    subsidy_local:       subsidyLoc?.amount        ?? 0,
    tax: {
      acq_tax_rate:         taxMap['acq_tax_rate']         ?? 0.05,
      special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
      acq_tax_relief_cap:   taxMap['acq_tax_relief_cap']   ?? 1_400_000,
      stamp:       taxMap['stamp']       ?? 2_500,
      plate:       taxMap['plate']       ?? 25_000,
      reg_agency:  taxMap['reg_agency']  ?? 50_000,
      delivery_fee: taxMap['delivery_fee'] ?? 179_000,
      etc_fee:     taxMap['etc_fee']     ?? 50_000,
    },
    customer: {
      biz_type:  customer.biz_type as 'individual' | 'corporation' | 'simplified',
      is_sosang: customer.is_sosang ?? false,
    },
  };

  const result = calcPrice(params);

  if (result.status === 'unsupported') {
    res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
    return;
  }

  res.json({ data: result });
});

// POST /quotes — 견적 저장
quotesRouter.post('/', rbac('SALES'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});

// GET /quotes/:id
quotesRouter.get('/:id', rbac('SALES', 'ADMIN'), (_req, res) => {
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});
