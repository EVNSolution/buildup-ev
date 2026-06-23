import { Router } from 'express';
import type { Request } from 'express';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { calcPrice, type PricingParams } from '@buildup-ev/shared/pricing';
import type { Prisma, QuoteStatus } from '@prisma/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUOTE_PDF_TEMPLATE = readFileSync(join(__dirname, '../templates/quote-pdf.html'), 'utf-8');

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

  try {
    const quotes = await prisma.quote.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        customer: { select: { id: true, name: true } },
        order: { select: { maker_org: { select: { code: true, name: true } } } },
      },
    });
    res.json({ data: quotes });
  } catch (e) {
    console.error('[GET /quotes]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 목록 조회 중 오류가 발생했습니다.' } });
  }
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
  try {
    const params = await buildParams(model_code, selections, customer, year ?? new Date().getFullYear());
    const result = calcPrice(params);
    if (result.status === 'unsupported') {
      res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
      return;
    }
    res.json({ data: result });
  } catch (e) {
    console.error('[POST /quotes/calculate]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 계산 중 오류가 발생했습니다.' } });
  }
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

quotesRouter.patch('/:id/confirm', rbac('ADMIN'), requirePermission('order.confirm'), async (req: Request, res): Promise<void> => {
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

  try {
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
    // TODO 2단계: order 생성 후 필요 서류 목록 자동생성 (Document rows insert)
    res.json({ data: { quote: updatedQuote, order } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/confirm]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 확정 중 오류가 발생했습니다.' } });
  }
});

// ── DELETE /quotes/:id — 견적 삭제 ───────────────────────────────────────
// draft:     SALES=본인, ADMIN=전체 삭제 가능
// confirmed: is_master만 삭제 가능 (연결된 order·order_option·document 트랜잭션 cascade)
// 그 외:     삭제 불가

quotesRouter.delete('/:id', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } });
    return;
  }
  try {
    const quote = await prisma.quote.findUnique({ where: { id } });
    if (!quote) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
      return;
    }

    if (quote.status === 'draft') {
      // SALES는 본인 draft만
      if (req.auth!.role === 'SALES' && quote.sales_user_id !== req.auth!.email) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 삭제할 수 있습니다' } });
        return;
      }
      await prisma.quote.delete({ where: { id } });
      res.json({ data: { ok: true } });
      return;
    }

    if (quote.status === 'confirmed') {
      // confirmed는 is_master만
      if (!req.auth!.is_master) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '확정 견적은 마스터 관리자만 삭제 가능' } });
        return;
      }
      // 연결된 order → order_option + document → order → quote 트랜잭션 cascade 삭제
      const order = await prisma.order.findUnique({ where: { quote_id: id } });
      await prisma.$transaction(async (tx) => {
        if (order) {
          await tx.document.deleteMany({ where: { order_id: order.id } });
          await tx.orderOption.deleteMany({ where: { order_id: order.id } });
          await tx.order.delete({ where: { id: order.id } });
        }
        await tx.quote.delete({ where: { id } });
      });
      res.json({ data: { ok: true } });
      return;
    }

    // ordered/expired 등 — 삭제 불가
    res.status(409).json({ error: { code: 'CONFLICT', message: '이 상태의 견적은 삭제할 수 없습니다' } });
  } catch (e) {
    console.error('[DELETE /quotes/:id]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 삭제 중 오류가 발생했습니다.' } });
  }
});

// ── GET /quotes/:id/pdf — 견적서 PDF 생성 ────────────────────────────────

quotesRouter.get('/:id/pdf', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } });
    return;
  }

  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: true,
        order: { select: { maker_org: { select: { code: true, name: true } } } },
      },
    });

    if (!quote) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
      return;
    }

    // SALES는 본인 견적만
    if (req.auth!.role === 'SALES' && quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 출력할 수 있습니다' } });
      return;
    }

    // 옵션 이름 조회
    const selections = (quote.selections ?? {}) as Record<string, string>;
    const valueCodes = Object.values(selections).filter(Boolean);
    const groupCodes = Object.keys(selections).filter(Boolean);

    const [optionValues, optionGroups, optionPrices] = await Promise.all([
      prisma.optionValue.findMany({ where: { code: { in: valueCodes } } }),
      prisma.optionGroup.findMany({ where: { code: { in: groupCodes } } }),
      prisma.optionPrice.findMany({ where: { model_code: quote.model_code, value_code: { in: valueCodes } } }),
    ]);

    const valueMap = new Map(optionValues.map(v => [v.code, v.name]));
    const groupMap = new Map(optionGroups.map(g => [g.code, g.name]));
    const priceMap = new Map(optionPrices.map(p => [p.value_code, p.supply_price]));

    const OPTION_ROWS = Object.entries(selections).map(([gCode, vCode]) => {
      const gName = groupMap.get(gCode) ?? gCode;
      const vName = valueMap.get(vCode) ?? vCode;
      const price = priceMap.has(vCode) ? `₩${Number(priceMap.get(vCode)).toLocaleString()}` : '포함';
      return `<tr><td><div class="opt-group">${gName}</div><div class="opt-val">${vName}</div></td>`
           + `<td>${vCode}</td><td>${price}</td></tr>`;
    }).join('\n');

    const STATUS_KO: Record<string, string> = { draft: '임시저장', confirmed: '확정', ordered: '주문', expired: '만료' };
    const BIZ_KO: Record<string, string>    = { individual: '개인사업자', corporate: '법인사업자', simplified: '간이과세자' };

    const supplyPrice = Number(quote.supply_price);
    const finalPrice  = Number(quote.final_price);
    const fmt = (n: number | null) => n != null ? `₩${n.toLocaleString()}` : '—';

    const makerOrg = quote.order?.maker_org;
    const MAKER_BANNER = makerOrg
      ? `<div class="maker-banner">
           <div class="maker-banner-dot"></div>
           <div>
             <div class="maker-banner-label">배정 특장사</div>
             <div class="maker-banner-name">${makerOrg.name} (${makerOrg.code})</div>
           </div>
         </div>`
      : '';

    const html = QUOTE_PDF_TEMPLATE
      .replace('{{QUOTE_ID}}',         `Q-${String(id).padStart(5, '0')}`)
      .replace('{{QUOTE_DATE}}',        quote.created_at.toISOString().slice(0, 10))
      .replace('{{MODEL_CODE}}',        quote.model_code)
      .replace('{{QUOTE_STATUS}}',      STATUS_KO[quote.status] ?? quote.status)
      .replace('{{CUSTOMER_NAME}}',     quote.customer?.name ?? '—')
      .replace('{{BIZ_TYPE}}',          '—')
      .replace('{{REGION}}',            '—')
      .replace('{{IS_SOSANG}}',         '—')
      .replace('{{MAKER_BANNER}}',      MAKER_BANNER)
      .replace('{{OPTION_ROWS}}',       OPTION_ROWS)
      .replace('{{SUPPLY_PRICE}}',      fmt(supplyPrice))
      .replace('{{VAT}}',               '—')
      .replace('{{VEHICLE_PRICE}}',     '—')
      .replace('{{SUBSIDY_NATIONAL}}',  '—')
      .replace('{{SUBSIDY_LOCAL}}',     '—')
      .replace('{{SUBSIDY_SOSANG}}',    '—')
      .replace('{{TOTAL_SUBSIDY}}',     '—')
      .replace('{{SUBSIDY_APPLIED}}',   '—')
      .replace('{{VAT_REFUND_PRICE}}',  '—')
      .replace('{{REG_FEE}}',           '—')
      .replace('{{FINAL_PRICE}}',       fmt(finalPrice));

    // puppeteer PDF 생성 (동적 import — 무거운 모듈을 요청 시점에만 로드)
    const { default: puppeteer } = await import('puppeteer');
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' }); // 웹폰트 로드 대기
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="quote-${id}.pdf"`);
      res.end(pdf);
    } finally {
      await browser.close();
    }
  } catch (e) {
    console.error('[GET /quotes/:id/pdf]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: 'PDF 생성 중 오류가 발생했습니다.' } });
  }
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
  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!quote) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
      return;
    }
    res.json({ data: quote });
  } catch (e) {
    console.error('[GET /quotes/:id]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 조회 중 오류가 발생했습니다.' } });
  }
});
