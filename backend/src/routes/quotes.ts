import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { collectGeneratedDocPaths, deleteGeneratedDocFilesByPaths } from '../services/docgen.js';
import { generateQuotePdf, QuotePdfError } from '../services/quote-pdf.js';
import {
  calcPrice, assembleOptionSum, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY,
  type PricingParams,
} from '@buildup-ev/shared/pricing';
import type { Prisma, QuoteStatus } from '@prisma/client';

export const quotesRouter = Router();

// ── 내부 헬퍼: DB 조회 → PricingParams 빌드 ─────────────────────────────

type CustomerInput = {
  name?: string;
  email?: string;
  phone?: string;
  biz_type?: string;
  is_sosang?: boolean;
  region?: string;
  has_transport_license?: boolean;  // 화물자동차 운송사업허가증
  diesel_conversion?: boolean;      // 경유차 유지 후 전기차 전환
};


// ── 연도별 순차 견적번호 생성 (YY-NNNN) ─────────────────────────────────────
async function genQuoteNo(prismaClient: NonNullable<typeof prisma>, year: number): Promise<string> {
  const prefix = String(year).slice(-2);
  const last = await prismaClient.quote.findFirst({
    where: { quote_no: { startsWith: `${prefix}-` } },
    orderBy: { quote_no: 'desc' },
    select: { quote_no: true },
  });
  const seq = last?.quote_no ? parseInt(last.quote_no.split('-')[1] ?? '0', 10) + 1 : 1;
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

async function buildParams(
  model_code: string,
  selections: Record<string, string>,
  customer: CustomerInput | undefined,
  calcYear: number,
): Promise<PricingParams> {
  if (!prisma) throw new Error('DB_UNAVAILABLE');

  const [optionPrices, subsidyNat, subsidyLoc, taxRows] = await Promise.all([
    prisma.optionPrice.findMany({ where: { model_code } }),
    prisma.subsidyNational.findFirst({ where: { model_code, year: calcYear } }),
    customer?.region
      ? prisma.subsidyLocal.findFirst({ where: { region: customer.region, year: calcYear } })
      : Promise.resolve(null),
    prisma.taxConfig.findMany(),
  ]);

  const priceMap: Record<string, number> = {};
  for (const op of optionPrices) priceMap[op.value_code] = op.supply_price;
  const price = (code: string) => priceMap[code] ?? 0;

  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);

  // 특장 옵션 합계 = 옵션DB 복합키(탑 높이 종속) 단가 합 (견적서 D13, D15:D20). 조립은 shared 공용.
  const { trim_price, option_sum } = assembleOptionSum(selections, price);

  const bizType = (customer?.biz_type ?? 'individual') as 'individual' | 'corporation' | 'simplified';

  return {
    trim_price,
    option_sum,
    subsidy: {
      national:          subsidyNat?.amount ?? 0,
      local:             subsidyLoc?.amount ?? 0,
      sosang_rate:       subsidyNat?.sosang_rate ? Number(subsidyNat.sosang_rate) : 0.3,
      takbae_rate:       TAKBAE_RATE,
      diesel_conversion: DIESEL_CONVERSION_SUBSIDY,
    },
    tax: {
      acq_tax_rate:         taxMap['acq_tax_rate']         ?? 0.05,
      special_acq_tax_rate: taxMap['special_acq_tax_rate'] ?? 0.02,
      acq_tax_relief_cap:   taxMap['acq_tax_relief_cap']   ?? 1_400_000,
      stamp:        taxMap['stamp']        ?? 2_000,
      plate:        taxMap['plate']        ?? 28_000,
      reg_agency:   taxMap['reg_agency']   ?? 30_000,
      delivery_fee: taxMap['delivery_fee'] ?? 179_000,
      etc_fee:      taxMap['etc_fee']      ?? 50_000,
    },
    customer: {
      biz_type:  bizType,
      is_sosang: customer?.is_sosang ?? false,
      has_transport_license: customer?.has_transport_license ?? false,
      diesel_conversion:     customer?.diesel_conversion ?? false,
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
        customer: { select: { id: true, name: true, email: true, phone: true } },
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
        data: { name: customer.name, email: customer.email, phone: customer.phone, created_by: req.auth?.email },
      });
      customerId = cust.id;
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2003') {
        const cust = await prisma.customer.create({ data: { name: customer.name, email: customer.email, phone: customer.phone } });
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

  // quote_no 부여 (YY-NNNN)
  try {
    const quote_no = await genQuoteNo(prisma, calcYear);
    await prisma.quote.update({ where: { id: quote.id }, data: { quote_no } });
  } catch {
    // quote_no 부여 실패는 치명적이지 않음 — 백필로 복구 가능
  }

  res.status(201).json({ data: { quote_id: quote.id, pricing: result } });
});

// ── PATCH /quotes/:id/confirm — 확정 (draft→confirmed) ────────────────────
// 파이프라인 1단계 전환. 특장사 배정·주문은 별도 단계.
// (임시: 관리자 수동. 최종: 전자서명 완료 시 자동 — 모듈3에서 교체)

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

  const quote = await prisma.quote.findUnique({ where: { id } });
  if (!quote) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
    return;
  }
  if (quote.status !== 'draft') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `임시저장 상태에서만 확정할 수 있습니다 (현재 ${quote.status})` } });
    return;
  }

  try {
    const updatedQuote = await prisma.quote.update({ where: { id }, data: { status: 'confirmed' } });
    res.json({ data: { quote: updatedQuote } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/confirm]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 확정 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /quotes/:id/assign — 배정 (confirmed→assigned + 특장사 배정 + 주문 생성) ──
// 관리자가 제작 특장사를 선정. Order 생성(status='제작착수', 특장사 수락 대기).

quotesRouter.patch('/:id/assign', rbac('ADMIN'), requirePermission('order.confirm'), async (req: Request, res): Promise<void> => {
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
  if (quote.status !== 'confirmed') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `확정 상태에서만 배정할 수 있습니다 (현재 ${quote.status})` } });
    return;
  }
  if (!makerOrg || makerOrg.type !== 'MAKER') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효한 특장사 org가 아닙니다' } });
    return;
  }

  try {
    const [updatedQuote, order] = await prisma.$transaction([
      prisma.quote.update({ where: { id }, data: { status: 'assigned' } }),
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
  } catch (e) {
    console.error('[PATCH /quotes/:id/assign]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '특장사 배정 중 오류가 발생했습니다.' } });
  }
});

// ── DELETE /quotes/:id — 견적 삭제 ───────────────────────────────────────
// draft:     SALES=본인, ADMIN=전체 삭제 가능
// confirmed/ordered: is_master만 삭제 가능 (연결된 order·order_option·document 트랜잭션 cascade)
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

    if (quote.status === 'confirmed' || quote.status === 'assigned' || quote.status === 'ordered') {
      // 확정·배정·주문 견적은 is_master만
      if (!req.auth!.is_master) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '확정·주문 견적은 마스터 관리자만 삭제 가능' } });
        return;
      }
      // 연결된 order → order_option + document + generated_document → order → quote 트랜잭션 cascade 삭제
      const order = await prisma.order.findUnique({ where: { quote_id: id } });
      // ⚠️ PDF 경로는 반드시 트랜잭션(행 삭제) '전에' 확보 — 행을 먼저 지우면 file_path 를
      //    못 찾아 파일이 고아로 남는다(issue #17 ②).
      const docPaths = order ? await collectGeneratedDocPaths(order.id) : [];
      await prisma.$transaction(async (tx) => {
        if (order) {
          await tx.document.deleteMany({ where: { order_id: order.id } });
          await tx.generatedDocument.deleteMany({ where: { order_id: order.id } });
          await tx.orderOption.deleteMany({ where: { order_id: order.id } });
          await tx.order.delete({ where: { id: order.id } });
        }
        await tx.quote.delete({ where: { id } });
      });
      // DB 커밋 성공 후 미리 확보한 경로로 실제 PDF 파일 정리. 파일 삭제 실패는 무시(로그만).
      if (docPaths.length) {
        await deleteGeneratedDocFilesByPaths(docPaths).catch(e => console.error('[DELETE /quotes/:id] 서류 파일 정리 실패', e));
      }
      res.json({ data: { ok: true } });
      return;
    }

    // expired 등 — 삭제 불가
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
    // 본인 견적 스코프(SALES) — 렌더는 generateQuotePdf 서비스가 담당(계약서 동봉과 공유)
    const own = await prisma.quote.findUnique({ where: { id }, select: { sales_user_id: true } });
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
      return;
    }
    if (req.auth!.role === 'SALES' && own.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 출력할 수 있습니다' } });
      return;
    }

    const { pdf, filename } = await generateQuotePdf(id);
    const isDownload = req.query['download'] === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      isDownload
        ? `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
        : `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.end(pdf);
  } catch (e) {
    if (e instanceof QuotePdfError && e.code === 'NOT_FOUND') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: e.message } });
      return;
    }
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
