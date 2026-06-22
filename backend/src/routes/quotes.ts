import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { calcPrice, type PricingParams } from '@buildup-ev/shared/pricing';
import type { Prisma, QuoteStatus } from '@prisma/client';

export const quotesRouter = Router();

// ── 내부 헬퍼: DB 조회 → PricingParams 빌드 ─────────────────────────────

type CustomerInput = {
  name?: string;
  biz_type?: string;
  is_sosang?: boolean;
  region?: string;
  scrap_diesel?: boolean;
};

async function buildParams(
  model_code: string,
  selections: Record<string, string>,
  customer: CustomerInput | undefined,
  calcYear: number,
): Promise<PricingParams> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');

  const topCode      = selections['TOP']      ?? '';
  const doorTypeCode = selections['DOORTYPE'] ?? '';

  const [optionPrices, doorPrices, optionValues, subsidyNat, subsidyLoc, taxRows] =
    await Promise.all([
      prisma.optionPrice.findMany({ where: { model_code } }),
      prisma.doorUnitPrice.findMany({ where: { model_code } }),
      prisma.optionValue.findMany({ where: { code: { in: [topCode, doorTypeCode] } } }),
      prisma.subsidyNational.findFirst({ where: { model_code, year: calcYear } }),
      customer?.region
        ? prisma.subsidyLocal.findFirst({ where: { region: customer.region, year: calcYear } })
        : Promise.resolve(null),
      prisma.taxConfig.findMany(),
    ]);

  const priceMap: Record<string, number> = {};
  for (const op of optionPrices) priceMap[op.value_code] = op.supply_price;

  const topName      = optionValues.find(v => v.code === topCode)?.name      ?? '';
  const doorTypeName = optionValues.find(v => v.code === doorTypeCode)?.name ?? '';
  const baseSwing    = doorPrices.find(d => d.top === topName && d.doortype === '여닫이')?.unit_price   ?? 0;
  const selectedDoor = doorPrices.find(d => d.top === topName && d.doortype === doorTypeName)?.unit_price ?? 0;

  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);

  return {
    bodytype_code:        selections['BODYTYPE'] ?? '',
    trim_code:            selections['TRIM']     ?? '',
    selected_value_codes: Object.values(selections),
    door: {
      base_swing_price: baseSwing,
      selected_price:   selectedDoor,
      has_extra:        selections['DOORADD'] === 'ADD_DRIVER',
    },
    option_prices:        priceMap,
    subsidy_national:     subsidyNat?.amount        ?? 0,
    subsidy_sosang_rate:  subsidyNat?.sosang_rate   ? Number(subsidyNat.sosang_rate) : 0,
    subsidy_local:        subsidyLoc?.amount        ?? 0,
    tax: {
      acq_tax_rate:         taxMap['acq_tax_rate']         ?? 0.05,
      special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
      acq_tax_relief_cap:   taxMap['acq_tax_relief_cap']   ?? 1_400_000,
      stamp:        taxMap['stamp']        ?? 2_500,
      plate:        taxMap['plate']        ?? 25_000,
      reg_agency:   taxMap['reg_agency']   ?? 50_000,
      delivery_fee: taxMap['delivery_fee'] ?? 179_000,
      etc_fee:      taxMap['etc_fee']      ?? 50_000,
    },
    customer: {
      biz_type:  (customer?.biz_type ?? 'individual') as 'individual' | 'corporation' | 'simplified',
      is_sosang: customer?.is_sosang ?? false,
    },
  };
}

// ── GET /quotes — 목록 (ADMIN=전체, SALES=자기 소유) ───────────────────────

quotesRouter.get('/', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const auth = req.auth!;
  const { status, from, to } = req.query as Record<string, string | undefined>;

  const where: Prisma.QuoteWhereInput = {};
  if (auth.role === 'SALES') where.sales_user_id = auth.email;
  if (status) where.status = status as QuoteStatus;
  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  const quotes = await prisma.quote.findMany({
    where,
    orderBy: { created_at: 'desc' },
    include: { customer: { select: { id: true, name: true } } },
  });
  res.json({ data: quotes });
});

// ── POST /quotes/calculate — 미저장 계산 ─────────────────────────────────

quotesRouter.post('/calculate', rbac('SALES'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { model_code, year, selections, customer } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  const params = await buildParams(model_code, selections, customer, year ?? new Date().getFullYear());
  const result = calcPrice(params);
  if (result.status === 'unsupported') {
    res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
    return;
  }
  res.json({ data: result });
});

// ── POST /quotes — 서버 재계산 + 스냅샷 저장 ─────────────────────────────

quotesRouter.post('/', rbac('SALES'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { model_code, year, selections, customer } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }

  const calcYear = year ?? new Date().getFullYear();
  const params = await buildParams(model_code, selections, customer, calcYear);
  const result = calcPrice(params);

  if (result.status === 'unsupported') {
    res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
    return;
  }

  // 고객 생성·연결 (name 있을 때만)
  let customerId: number | undefined;
  if (customer?.name) {
    try {
      const cust = await prisma.customer.create({
        data: { name: customer.name, created_by: req.auth?.email },
      });
      customerId = cust.id;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2003') {
        const cust = await prisma.customer.create({ data: { name: customer.name } });
        customerId = cust.id;
      } else {
        throw e;
      }
    }
  }

  const baseData = {
    model_code,
    selections:    selections as unknown as Prisma.InputJsonValue,
    supply_price:  result.supply_price,
    final_price:   result.real_price,
    status:        'draft' as const,
    customer_id:   customerId,
    sales_user_id: req.auth?.email,
    org_id:        req.auth?.org_code,
  };

  let quote;
  try {
    quote = await prisma.quote.create({ data: baseData });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2003') {
      quote = await prisma.quote.create({
        data: { ...baseData, sales_user_id: undefined, org_id: undefined },
      });
    } else {
      throw e;
    }
  }

  res.status(201).json({ data: { quote_id: quote.id, pricing: result } });
});

// ── PATCH /quotes/:id/confirm — 관리자 확정 + 특장사 배정 + 주문 생성 ────

quotesRouter.patch('/:id/confirm', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } });
    return;
  }

  const { maker_org_id } = req.body as { maker_org_id?: string };
  if (!maker_org_id) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '배정 특장사(maker_org_id) 필수' } });
    return;
  }

  const [quote, makerOrg] = await Promise.all([
    prisma.quote.findUnique({ where: { id } }),
    prisma.org.findUnique({ where: { code: maker_org_id } }),
  ]);

  if (!quote) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
    return;
  }
  if (quote.status !== 'draft') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `이미 ${quote.status} 상태입니다` } });
    return;
  }
  if (!makerOrg || makerOrg.type !== 'MAKER') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효한 특장사 org가 아닙니다' } });
    return;
  }

  const [updatedQuote, order] = await prisma.$transaction([
    prisma.quote.update({ where: { id }, data: { status: 'confirmed' } }),
    prisma.order.create({
      data: {
        quote_id:    id,
        status:      '제작착수',
        maker_org_id,
        assigned_at: new Date(),
      },
    }),
  ]);

  res.json({ data: { quote: updatedQuote, order } });
});

// ── GET /quotes/:id ───────────────────────────────────────────────────────

quotesRouter.get('/:id', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } });
    return;
  }
  const quote = await prisma.quote.findUnique({
    where: { id },
    include: { customer: true },
  });
  if (!quote) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
    return;
  }
  res.json({ data: quote });
});
