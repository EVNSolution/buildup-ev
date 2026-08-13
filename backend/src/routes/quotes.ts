import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission, ownQuotesOnly } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { collectGeneratedDocPaths, deleteGeneratedDocFilesByPaths } from '../services/docgen.js';
import { generateQuotePdf, QuotePdfError } from '../services/quote-pdf.js';
import { renderContractPdfForQuote, ContractDocError } from '../services/contract-docgen.js';
import { readFrozenDoc, isFrozen, FROZEN_MESSAGE, collectContractFilePaths, deleteContractFiles } from '../services/doc-freeze.js';
import {
  calcPrice, calcQuote, assembleOptionSum, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY,
  dieselDeducts, toDieselStatus,
  type PricingParams,
} from '@buildup-ev/shared/pricing';
import { buildQuoteParams, type CustomerInput } from '../services/quote-calc.js';
import { upsertCustomer } from '../services/customer-master.js';
import type { Prisma, QuoteStatus } from '@prisma/client';
import { logQuoteChanges, listQuoteChanges } from '../services/quote-history.js';
import { setQuoteStatus } from '../services/quote-status.js';
import { nextQuoteNo } from '../services/quote-no.js';

export const quotesRouter = Router();

// ── 내부 헬퍼: DB 조회 → PricingParams 빌드 ─────────────────────────────


// ── 연도별 순차 견적번호 생성 (YY-NNNN) ─────────────────────────────────────
// 채번은 quote_no_counter(채번대장)가 맡는다 — 견적을 지워도 번호가 되살아나지 않는다.
// (예전 구현은 "남아 있는 견적의 최대번호 +1" 이라 삭제 후 같은 번호가 다시 나갔다)
const genQuoteNo = (prismaClient: NonNullable<typeof prisma>, year: number): Promise<string> =>
  nextQuoteNo(prismaClient, year);

async function buildParams(
  model_code: string,
  selections: Record<string, string>,
  customer: CustomerInput | undefined,
  calcYear: number,
  extra?: { promotion_zeroed?: string[]; local_subsidy_off?: boolean },
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
  // 재량할인(프로모션)은 조립 단계에서 0원 처리 → 공급가·부가세·취득세·실구매가에 모두 반영된다.
  const { trim_price, option_sum } = assembleOptionSum(selections, price, extra?.promotion_zeroed ?? []);

  const bizType = (customer?.biz_type ?? 'individual') as
    'individual' | 'corporation' | 'simplified' | 'consumer';
  // 지방보조금 미적용: 관리자 DB 토글(active=false) 또는 견적별 영업 토글
  const localOff = extra?.local_subsidy_off === true || subsidyLoc?.active === false;

  return {
    trim_price,
    option_sum,
    subsidy: {
      national:          subsidyNat?.amount ?? 0,
      local:             localOff ? 0 : (subsidyLoc?.amount ?? 0),
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
      // Ver1.21 엔진도 총견적서와 같은 기준으로 '유지' 여부를 본다(옛 boolean 도 복원).
      diesel_conversion:     dieselDeducts(toDieselStatus(customer?.diesel_status, customer?.diesel_conversion)),
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
  if (ownQuotesOnly(auth)) where.sales_user_id = auth.email;
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
        // address·address_detail 은 고객정보 수정 팝업이 되읽어야 해서 함께 내려준다.
        customer: { select: { id: true, name: true, email: true, phone: true, address: true, address_detail: true } },
        order: { select: { maker_org: { select: { code: true, name: true } } } },
        // 전자서명 현황 — 재발송 시 행이 누적되므로 최신 1건이 현재 상태.
        contracts: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, sent_at: true, completed_at: true },
        },
      },
    });
    // 목록에서 쓰기 쉬운 형태로 평탄화(참고용 메일 발송 / 전자서명 발송 / 전자서명 완료)
    const data = quotes.map(({ contracts, ...q }) => ({
      ...q,
      contract: contracts[0]
        ? { status: contracts[0].status, sent_at: contracts[0].sent_at, completed_at: contracts[0].completed_at }
        : null,
    }));
    res.json({ data });
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
  const { model_code, year, selections, customer, promotion_zeroed, local_subsidy_off } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    promotion_zeroed?: string[]; local_subsidy_off?: boolean;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  try {
    const params = await buildParams(model_code, selections, customer, year ?? new Date().getFullYear(), { promotion_zeroed, local_subsidy_off });
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

// ── POST /quotes/calculate-total — 총견적서(차량/특장 분리·구매혜택·할부) 미저장 계산 ──

quotesRouter.post('/calculate-total', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { model_code, year, selections, customer, down_payment_rate, installment_months, promotion_zeroed, local_subsidy_off } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    down_payment_rate?: number; installment_months?: number; promotion_zeroed?: string[]; local_subsidy_off?: boolean;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  try {
    const params = await buildQuoteParams(
      model_code, selections, customer,
      { down_payment_rate, installment_months, promotion_zeroed, local_subsidy_off },
      year ?? new Date().getFullYear(),
    );
    res.json({ data: calcQuote(params) });
  } catch (e) {
    console.error('[POST /quotes/calculate-total]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '총견적 계산 중 오류가 발생했습니다.' } });
  }
});

// ── GET /quotes/:id/total — 저장된 입력으로 총견적서 재계산 ──────────────

quotesRouter.get('/:id/total', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  try {
    const quote = await prisma.quote.findUnique({ where: { id }, include: { customer: true } });
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
    }
    const inp = (quote.inputs ?? {}) as Record<string, unknown>;
    const customer: CustomerInput = {
      name: quote.customer?.name,
      biz_type: inp['biz_type'] as string | undefined,
      is_sosang: inp['is_sosang'] as boolean | undefined,
      region: inp['region'] as string | undefined,
      has_transport_license: inp['has_transport_license'] as boolean | undefined,
      diesel_status: inp['diesel_status'] as string | undefined,
      diesel_conversion: inp['diesel_conversion'] as boolean | undefined,
      has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
      tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
    };
    const params = await buildQuoteParams(
      quote.model_code, (quote.selections ?? {}) as Record<string, string>, customer,
      {
        down_payment_rate: inp['down_payment_rate'] as number | undefined,
        installment_months: inp['installment_months'] as number | undefined,
        promotion_zeroed: inp['promotion_zeroed'] as string[] | undefined,
        local_subsidy_off: inp['local_subsidy_off'] as boolean | undefined,
      },
      quote.created_at.getFullYear(),
    );
    res.json({ data: {
      quote_id: quote.id,
      customer_name: quote.customer?.name ?? null,
      memo: (inp['memo'] as string | undefined) ?? '',
      total: calcQuote(params),
    } });
  } catch (e) {
    console.error('[GET /quotes/:id/total]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '총견적 재계산 중 오류가 발생했습니다.' } });
  }
});

// ── GET /quotes/installment-rates — 할부 이율표(확정 팝업 드롭다운용) ──────

quotesRouter.get('/installment-rates', rbac('SALES', 'ADMIN'), async (_req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const rows = await prisma.installmentRate.findMany({ where: { active: true }, orderBy: { months: 'asc' } });
  res.json({ data: rows.map((r) => ({ months: r.months, rate: Number(r.rate), label: r.label })) });
});

// ── PATCH /quotes/:id/inputs — 총견적서 입력 부분저장(임시저장) ───────────

quotesRouter.patch('/:id/inputs', rbac('SALES', 'ADMIN'), requirePermission('quote.edit'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  try {
    const quote = await prisma.quote.findUnique({ where: { id }, select: { sales_user_id: true, inputs: true } });
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
    }
    if (await isFrozen(id)) { res.status(409).json({ error: { code: 'DOCS_FROZEN', message: FROZEN_MESSAGE } }); return; }
    // 허용 필드만 병합(입력시트 값). 임의 키 오염 방지.
    const ALLOWED = ['down_payment_rate', 'installment_months', 'tax_exempt_type', 'has_biz_plate',
      'biz_type', 'is_sosang', 'region', 'has_transport_license', 'diesel_conversion', 'diesel_status', 'promotion_zeroed', 'memo', 'local_subsidy_off',
      // 매매계약서 전용 입력(견적서 생성 팝업에서 함께 받음). 전부 선택 — 비워두면 계약서에 공란으로 나간다.
      'contract_party', 'buyer_agent', 'buyer_relation', 'buyer_regno', 'buyer_tel',
      // 대표이사 — 법인 계약서 서명블록. 저장 후 사업자구분을 고칠 때 함께 고칠 수 있어야 한다.
      'ceo_name'];
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const k of ALLOWED) if (k in body) patch[k] = body[k];
    const prev = (quote.inputs ?? {}) as Record<string, unknown>;
    const merged = { ...prev, ...patch };
    await prisma.quote.update({ where: { id }, data: { inputs: merged as unknown as Prisma.InputJsonValue } });
    // 바뀐 값만 이력에 남긴다(수정 팝업 「이력」 탭에서 본다)
    await logQuoteChanges(id, 'inputs', prev, merged, req.auth?.email ?? 'unknown', Object.keys(patch));

    // 입력(면세구분·영업용번호판·선수금·할부·재량할인 등)이 바뀌면 실구매가도 달라진다.
    // 목록에 보이는 금액과 견적서 PDF 가 어긋나지 않도록 final_price 를 다시 계산해 저장.
    try {
      const full = await prisma.quote.findUnique({ where: { id }, include: { customer: true } });
      if (full) {
        const params = await buildQuoteParams(
          full.model_code, (full.selections ?? {}) as Record<string, string>,
          {
            biz_type: merged['biz_type'] as string | undefined,
            is_sosang: merged['is_sosang'] as boolean | undefined,
            region: merged['region'] as string | undefined,
            has_transport_license: merged['has_transport_license'] as boolean | undefined,
            diesel_status: merged['diesel_status'] as string | undefined,
            diesel_conversion: merged['diesel_conversion'] as boolean | undefined,
            has_biz_plate: merged['has_biz_plate'] as boolean | undefined,
            tax_exempt_type: merged['tax_exempt_type'] as string | undefined,
          },
          {
            down_payment_rate: merged['down_payment_rate'] as number | undefined,
            installment_months: merged['installment_months'] as number | undefined,
            promotion_zeroed: merged['promotion_zeroed'] as string[] | undefined,
            local_subsidy_off: merged['local_subsidy_off'] as boolean | undefined,
          },
          full.created_at.getFullYear(),
        );
        await prisma.quote.update({ where: { id }, data: { final_price: calcQuote(params).real_price } });
      }
    } catch (e) {
      console.error('[PATCH /quotes/:id/inputs] final_price 재계산 실패(입력 저장은 완료)', e);
    }

    res.json({ data: { ok: true } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/inputs]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '입력 저장 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /quotes/:id/selections — 저장된 견적의 옵션 변경 ─────────────────
//
// 저장 뒤에 "탑을 표준으로 바꿔 달라" 같은 요청이 온다. 예전엔 견적을 새로 만드는 수밖에
// 없어 이력이 끊겼다. 여기서 옵션을 갈아끼우고 금액을 다시 계산해 같은 견적에 남긴다.
// 서류가 고정된 뒤(전자서명 발송)에는 막는다 — 서명한 문서와 어긋나면 안 된다.

quotesRouter.patch('/:id/selections', rbac('SALES', 'ADMIN'), requirePermission('quote.edit'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

  const body = (req.body ?? {}) as { selections?: Record<string, string> };
  const next = body.selections;
  if (!next || typeof next !== 'object') { res.status(400).json({ error: { code: 'BAD_INPUT', message: 'selections 필요' } }); return; }

  try {
    const quote = await prisma.quote.findUnique({ where: { id }, include: { customer: true } });
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
    }
    if (await isFrozen(id)) { res.status(409).json({ error: { code: 'DOCS_FROZEN', message: FROZEN_MESSAGE } }); return; }

    const prevSel = (quote.selections ?? {}) as Record<string, string>;
    const inp = (quote.inputs ?? {}) as Record<string, unknown>;

    // 금액 재계산 — 목록 금액과 견적서 PDF 가 어긋나지 않게 저장 시점에 다시 구한다
    const params = await buildQuoteParams(
      quote.model_code, next,
      {
        biz_type: inp['biz_type'] as string | undefined,
        is_sosang: inp['is_sosang'] as boolean | undefined,
        region: inp['region'] as string | undefined,
        has_transport_license: inp['has_transport_license'] as boolean | undefined,
        diesel_status: inp['diesel_status'] as string | undefined,
        diesel_conversion: inp['diesel_conversion'] as boolean | undefined,
        has_biz_plate: inp['has_biz_plate'] as boolean | undefined,
        tax_exempt_type: inp['tax_exempt_type'] as string | undefined,
      },
      {
        down_payment_rate: inp['down_payment_rate'] as number | undefined,
        installment_months: inp['installment_months'] as number | undefined,
        promotion_zeroed: inp['promotion_zeroed'] as string[] | undefined,
        local_subsidy_off: inp['local_subsidy_off'] as boolean | undefined,
      },
      quote.created_at.getFullYear(),
    );
    const total = calcQuote(params);

    await prisma.quote.update({
      where: { id },
      data: { selections: next as unknown as Prisma.InputJsonValue, final_price: total.real_price },
    });

    // 이력은 **코드가 아니라 사람이 읽는 이름**으로 남긴다(TOP_REEFER_LOW → 냉동/저상).
    const codes = [...new Set([...Object.values(prevSel), ...Object.values(next)].filter(Boolean))];
    const values = codes.length
      ? await prisma.optionValue.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
      : [];
    const nameOf = new Map(values.map((v) => [v.code, v.name]));
    const label = (rec: Record<string, string>) =>
      Object.fromEntries(Object.entries(rec).map(([g, c]) => [g, nameOf.get(c) ?? c]));
    const groups = [...new Set([...Object.keys(prevSel), ...Object.keys(next)])];
    const changed = await logQuoteChanges(id, 'options', label(prevSel), label(next),
      req.auth?.email ?? 'unknown', groups);

    res.json({ data: { ok: true, changed, final_price: total.real_price } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/selections]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '옵션 저장 중 오류가 발생했습니다.' } });
  }
});

// ── POST /quotes/:id/duplicate — 같은 고객·같은 옵션으로 새 견적 ──────────
//
// 전자서명을 보내면 그 견적은 고정된다(고객이 받은 문서와 어긋나면 안 되므로).
// 그런데 조건을 바꿔 다시 내는 일은 흔하다. 예전엔 컨피규레이터에서 옵션부터
// 고객정보까지 전부 다시 입력해야 했다 — 여기서 통째로 복사해 **새 번호**로 만든다.
//
// 복사하는 것: 차종 · 옵션 · 입력값(보조금 조건·할부·계약서 입력) · 연결된 고객
// 복사하지 않는 것: 상태(임시저장부터 다시) · 발송이력 · 서류고정 · 전자서명
//   — 새 견적은 아직 아무것도 보내지 않은 견적이다.

quotesRouter.post('/:id/duplicate', rbac('SALES', 'ADMIN'), requirePermission('quote.edit'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

  try {
    const src = await prisma.quote.findUnique({ where: { id } });
    if (!src) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (ownQuotesOnly(req.auth!) && src.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
    }

    const created = await prisma.quote.create({
      data: {
        model_code:  src.model_code,
        selections:  (src.selections ?? {}) as Prisma.InputJsonValue,
        inputs:      (src.inputs ?? {}) as Prisma.InputJsonValue,
        customer_id: src.customer_id,
        supply_price: src.supply_price,
        final_price:  src.final_price,
        // 복제한 사람이 담당이 된다(관리자가 복제하면 관리자 견적이 된다)
        sales_user_id: req.auth?.email ?? src.sales_user_id,
        org_id: src.org_id,
        status: 'draft',
      },
    });

    try {
      const quote_no = await genQuoteNo(prisma, created.created_at.getFullYear());
      await prisma.quote.update({ where: { id: created.id }, data: { quote_no } });
      res.json({ data: { id: created.id, quote_no } });
    } catch (e) {
      // 번호 부여 실패는 치명적이지 않다 — 견적 자체는 만들어졌다(백필로 복구 가능)
      console.error('[POST /quotes/:id/duplicate] quote_no 부여 실패', e);
      res.json({ data: { id: created.id, quote_no: null } });
    }
  } catch (e) {
    console.error('[POST /quotes/:id/duplicate]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 복제 중 오류가 발생했습니다.' } });
  }
});

// ── GET /quotes/:id/history — 이 견적의 수정 이력 ──────────────────────────

quotesRouter.get('/:id/history', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  const quote = await prisma.quote.findUnique({ where: { id }, select: { sales_user_id: true } });
  if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
  if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
  }
  res.json({ data: await listQuoteChanges(id) });
});

// ── PATCH /quotes/:id/customer — 견적에 연결된 고객정보 수정 ───────────────
//
// 저장 후에 고객정보 오타를 발견하는 일이 잦다. 예전에는 고객정보 팝업에서 고쳐도
// 새 customer 행이 생길 뿐 견적이 가리키는 행은 그대로라, 견적서·계약서에 옛 값이 나갔다.
// 여기서는 **견적이 가리키는 customer 행 자체**를 고쳐 모든 서류에 즉시 반영되게 한다.

quotesRouter.patch('/:id/customer', rbac('SALES', 'ADMIN'), requirePermission('quote.edit'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  try {
    const quote = await prisma.quote.findUnique({ where: { id }, select: { sales_user_id: true, customer_id: true } });
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한이 없습니다' } }); return;
    }
    if (!quote.customer_id) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '견적에 고객이 연결되어 있지 않습니다' } }); return; }
    if (await isFrozen(id)) { res.status(409).json({ error: { code: 'DOCS_FROZEN', message: FROZEN_MESSAGE } }); return; }

    const b = (req.body ?? {}) as Record<string, unknown>;
    const str = (k: string, max: number) => {
      const v = b[k];
      if (typeof v !== 'string') return undefined;
      const t = v.trim();
      return t ? t.slice(0, max) : null;   // 빈 문자열은 null 로 비운다
    };
    const data: Record<string, string | null> = {};
    const name = str('name', 60);
    if (name) data['name'] = name;          // 이름은 비울 수 없다(NOT NULL)
    for (const [k, max] of [['email', 120], ['phone', 20], ['address', 120], ['address_detail', 120], ['reg_no', 20],
      // 대표이사·유선전화도 고객 마스터에 쌓인다(다음 견적에서 자동 기입된다)
      ['ceo_name', 60], ['tel', 20]] as const) {
      const v = str(k, max);
      if (v !== undefined) data[k] = v;
    }
    if (!Object.keys(data).length) { res.json({ data: { ok: true, changed: 0 } }); return; }

    const before = await prisma.customer.findUnique({ where: { id: quote.customer_id } });
    await prisma.customer.update({ where: { id: quote.customer_id }, data });
    await logQuoteChanges(id, 'customer',
      (before ?? {}) as unknown as Record<string, unknown>, data,
      req.auth?.email ?? 'unknown', Object.keys(data));
    res.json({ data: { ok: true, changed: Object.keys(data).length } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/customer]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객정보 저장 중 오류가 발생했습니다.' } });
  }
});

// ── POST /quotes — 서버 재계산 + 스냅샷 저장 ─────────────────────────────

quotesRouter.post('/', rbac('SALES'), requirePermission('quote.create'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { model_code, year, selections, customer, down_payment_rate, installment_months, promotion_zeroed, memo, local_subsidy_off } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    down_payment_rate?: number; installment_months?: number; promotion_zeroed?: string[]; memo?: string; local_subsidy_off?: boolean;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }

  const calcYear = year ?? new Date().getFullYear();
  const params = await buildParams(model_code, selections, customer, calcYear, { promotion_zeroed, local_subsidy_off });
  const result = calcPrice(params);

  // 저장되는 실구매가는 **총견적서 기준**(견적서 PDF·화면과 동일 규칙).
  // calcPrice(Ver1.21)는 공급가액 산출과 하위호환 응답용으로만 유지한다.
  const totalParams = await buildQuoteParams(model_code, selections, customer,
    { down_payment_rate, installment_months, promotion_zeroed, local_subsidy_off }, calcYear);
  const total = calcQuote(totalParams);

  // 총견적서 입력시트 스냅샷(견적별 입력값 — 나중에 총견적서 재출력·재계산용)
  const inputsSnapshot = {
    biz_type: customer?.biz_type,
    // 대표이사 — 법인 계약서 매수인 서명블록용. 법인이 아니면 계약서에서 공란 처리된다.
    ceo_name: customer?.ceo_name ?? '',
    is_sosang: customer?.is_sosang,
    region: customer?.region,
    has_transport_license: customer?.has_transport_license,
    diesel_status: customer?.diesel_status,
    diesel_conversion: customer?.diesel_conversion,
    has_biz_plate: customer?.has_biz_plate,
    tax_exempt_type: customer?.tax_exempt_type,
    down_payment_rate,
    installment_months,
    promotion_zeroed: promotion_zeroed ?? [],  // 재량할인(0원 처리 특장옵션 그룹)
    local_subsidy_off: local_subsidy_off ?? false, // 견적별 지방보조금 미적용(영업 토글)
    memo: memo ?? '',                          // 메모/안내문
    // 계약서 전용 입력 — 견적 저장 모달에서 함께 받는다(예전엔 견적서 생성 팝업에서 받았다).
    // 전부 선택 입력이라 비어 있으면 계약서에 공란으로 나간다.
    address_detail: customer?.address_detail ?? '',
    contract_party: customer?.contract_party ?? '',
    buyer_agent: customer?.buyer_agent ?? '',
    buyer_relation: customer?.buyer_relation ?? '',
    buyer_regno: customer?.buyer_regno ?? '',
    buyer_tel: customer?.buyer_tel ?? '',
  };

  if (result.status === 'unsupported') {
    res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
    return;
  }

  // 고객 마스터 갱신·연결 (name 있을 때만).
  // ⚠️ 예전엔 무조건 create 라 같은 고객이 견적을 낼 때마다 행이 새로 쌓였다.
  //    이제 (성명 + 생년월일/사업자번호)가 같으면 기존 행을 갱신해 한 고객 = 한 행으로 모은다.
  let customerId: number | undefined;
  if (customer?.name) {
    try {
      customerId = await upsertCustomer({
        name: customer.name,
        reg_no: customer.buyer_regno,
        ceo_name: customer.ceo_name,
        email: customer.email,
        phone: customer.phone,
        tel: customer.buyer_tel,
        address: customer.address,
        address_detail: customer.address_detail,
        created_by: req.auth?.email,
      });
    } catch (e: unknown) {
      if ((e as { code?: string }).code === 'P2003') {
        const cust = await prisma.customer.create({ data: { name: customer.name, email: customer.email, phone: customer.phone, address: customer.address } });
        customerId = cust.id;
      } else {
        throw e;
      }
    }
  }

  const baseData = {
    model_code,
    selections:    selections as unknown as Prisma.InputJsonValue,
    inputs:        inputsSnapshot as unknown as Prisma.InputJsonValue,
    supply_price:  result.supply_price,
    final_price:   total.real_price,   // 총견적서 기준 실구매가
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

// 견적 확정(= 견적서 생성)은 **영업**의 업무(CLAUDE.md 주문흐름: 견적확정/주문전환(영업) → 관리자 검증).
// 관리자 게이트는 다음 단계인 배정(/assign, order.confirm)에서 걸린다.
quotesRouter.patch('/:id/confirm', rbac('SALES', 'ADMIN'), requirePermission('quote.confirm'), async (req: Request, res): Promise<void> => {
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
  // SALES 는 본인 견적만 확정 가능(ADMIN 은 전체)
  if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 확정할 수 있습니다' } });
    return;
  }
  if (quote.status !== 'draft') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `임시저장 상태에서만 확정할 수 있습니다 (현재 ${quote.status})` } });
    return;
  }

  try {
    await setQuoteStatus(id, 'confirmed', req.auth?.email ?? 'unknown');
    const updatedQuote = await prisma.quote.findUnique({ where: { id } });
    res.json({ data: { quote: updatedQuote } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/confirm]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 확정 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /quotes/:id/assign — 배정 (confirmed→assigned + 특장사 배정 + 주문 생성) ──
// 관리자가 제작 특장사를 선정. Order 생성(status='제작착수', 특장사 수락 대기).

// ── PATCH /quotes/:id/assign-sales — 공개 문의를 영업사원에게 배정 ────────
//
// 공개 화면(비로그인)에서 들어온 문의는 주인이 없다(sales_user_id = null).
// 관리자가 담당 영업을 지정하는 순간부터 그 영업의 「내 견적」에 나타난다.
//
// ⚠️ **견적번호는 여기서 처음 나간다.** 접수 단계에서 번호를 주면, 상담으로 이어지지 않은
//    문의가 번호를 먹어 실제 계약 번호가 듬성듬성해진다(번호는 재사용하지 않는 자원이다).

quotesRouter.patch('/:id/assign-sales', rbac('ADMIN'), requirePermission('quote.confirm'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } }); return; }

  const { sales_user_id } = req.body as { sales_user_id?: string };
  if (!sales_user_id) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '담당 영업(sales_user_id) 필수' } }); return; }

  try {
    const [quote, user] = await Promise.all([
      prisma.quote.findUnique({ where: { id }, select: { id: true, quote_no: true, sales_user_id: true, created_at: true } }),
      prisma.user.findUnique({ where: { email: sales_user_id }, select: { email: true, org_code: true, role: true, extra_roles: true, active: true, status: true } }),
    ]);
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (!user || !user.active || user.status !== 'active') {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '활성 상태의 계정이 아닙니다' } }); return;
    }
    // 영업 역할이 있는 계정에만 배정한다(겸직 포함) — 특장사 계정에 배정하면 열지도 못한다
    const roles = [user.role, ...(user.extra_roles ?? [])];
    if (!roles.includes('SALES')) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '영업 역할이 있는 계정에만 배정할 수 있습니다' } }); return;
    }

    // 번호가 없으면(공개 문의) 이때 채번한다. 이미 있으면 그대로 둔다 — 번호는 바뀌지 않는다.
    let quote_no = quote.quote_no;
    if (!quote_no) {
      try {
        quote_no = await nextQuoteNo(prisma, quote.created_at.getFullYear());
      } catch (e) {
        console.error('[PATCH /quotes/:id/assign-sales] 채번 실패', e);
        res.status(500).json({ error: { code: 'INTERNAL', message: '견적번호 발급에 실패했습니다.' } });
        return;
      }
    }

    const prev = { sales_user_id: quote.sales_user_id ?? '' };
    await prisma.quote.update({
      where: { id },
      data: { sales_user_id: user.email, org_id: user.org_code, quote_no },
    });
    // 누가 누구에게 넘겼는지 남긴다 — 배정은 되돌리기·문의 응대에서 자주 되짚는다
    await logQuoteChanges(id, 'inputs', prev, { sales_user_id: user.email },
      req.auth?.email ?? 'unknown', ['sales_user_id']);

    res.json({ data: { ok: true, quote_no, sales_user_id: user.email } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/assign-sales]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '배정 중 오류가 발생했습니다.' } });
  }
});

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
  // 배정은 **계약완료(전자서명 완료)** 단계에서만 가능하다.
  // 서명 전 선배정을 허용하면 계약이 깨졌을 때 이미 특장사가 제작에 들어가 있을 수 있다.
  if (quote.status !== 'contracted') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `전자서명이 완료된 계약완료 견적만 배정할 수 있습니다 (현재 ${quote.status})` } });
    return;
  }
  if (!makerOrg || makerOrg.type !== 'MAKER') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효한 특장사 org가 아닙니다' } });
    return;
  }

  try {
    await setQuoteStatus(id, 'assigned', req.auth?.email ?? 'unknown');
    const [updatedQuote, order] = await prisma.$transaction([
      prisma.quote.findUnique({ where: { id } }),
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

quotesRouter.delete('/:id', rbac('ADMIN'), requirePermission('quote.delete'), async (req: Request, res): Promise<void> => {
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
      if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 삭제할 수 있습니다' } });
        return;
      }
      // ⚠️ 파일 경로는 행 삭제 '전에' 확보 — 지운 뒤에는 경로를 알 수 없어 고아로 남는다.
      const contractPaths = await collectContractFilePaths(id);
      // 계약(purchase_contract)이 견적을 FK 참조 → 먼저 지워야 quote 삭제가 가능
      await prisma.$transaction(async (tx) => {
        await tx.purchaseContract.deleteMany({ where: { quote_id: id } });
        await tx.quote.delete({ where: { id } });
      });
      if (contractPaths.length) {
        await deleteContractFiles(contractPaths).catch(e => console.error('[DELETE /quotes/:id] 계약 파일 정리 실패', e));
      }
      res.json({ data: { ok: true } });
      return;
    }

    if (['confirmed', 'contracted', 'assigned', 'ordered', 'completed'].includes(quote.status)) {
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
      // 서명본 PDF + 고정본 견적서·계약서도 같은 이유로 미리 확보한다.
      const contractPaths = await collectContractFilePaths(id);
      await prisma.$transaction(async (tx) => {
        if (order) {
          await tx.document.deleteMany({ where: { order_id: order.id } });
          await tx.generatedDocument.deleteMany({ where: { order_id: order.id } });
          await tx.orderOption.deleteMany({ where: { order_id: order.id } });
          await tx.order.delete({ where: { id: order.id } });
        }
        // 계약(purchase_contract)도 견적을 FK 참조 → quote 삭제 전에 정리
        await tx.purchaseContract.deleteMany({ where: { quote_id: id } });
        await tx.quote.delete({ where: { id } });
      });
      // DB 커밋 성공 후 미리 확보한 경로로 실제 PDF 파일 정리. 파일 삭제 실패는 무시(로그만).
      if (docPaths.length) {
        await deleteGeneratedDocFilesByPaths(docPaths).catch(e => console.error('[DELETE /quotes/:id] 서류 파일 정리 실패', e));
      }
      if (contractPaths.length) {
        await deleteContractFiles(contractPaths).catch(e => console.error('[DELETE /quotes/:id] 계약 파일 정리 실패', e));
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
    if (ownQuotesOnly(req.auth!) && own.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 출력할 수 있습니다' } });
      return;
    }

    // 고정된 견적이면 그때 굳힌 파일을 그대로 — 단가가 바뀌어도 문서는 안 바뀐다
    const frozen = await readFrozenDoc(id, 'quote');
    const { pdf, filename } = frozen
      ? { pdf: frozen, filename: `견적서_${id}.pdf` }
      : await generateQuotePdf(id);
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

// ── GET /quotes/:id/contract-pdf — 특장 매매계약서 PDF (견적 기준, 즉석 렌더) ──
//
// 계약서는 주문 전환 전 **영업 단계**에서 견적서와 나란히 만들어진다.
// 저장본(GeneratedDocument)은 주문 확정 후 별도 생성되며, 여기선 견적서와 동일하게 즉석 렌더한다.

quotesRouter.get('/:id/contract-pdf', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
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
    const own = await prisma.quote.findUnique({ where: { id }, select: { sales_user_id: true } });
    if (!own) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
      return;
    }
    if (ownQuotesOnly(req.auth!) && own.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 견적만 출력할 수 있습니다' } });
      return;
    }

    const frozenC = await readFrozenDoc(id, 'contract');
    const { pdf, filename, warnings } = frozenC
      ? { pdf: frozenC, filename: `특장매매계약서_${id}.pdf`, warnings: [] as string[] }
      : await renderContractPdfForQuote(id);
    if (warnings.length) console.warn(`[GET /quotes/${id}/contract-pdf]`, warnings.join(' / '));
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
    if (e instanceof ContractDocError) {
      const status = e.code === 'NOT_FOUND' ? 404 : e.code === 'DB_UNAVAILABLE' ? 503 : 500;
      res.status(status).json({ error: { code: e.code, message: e.message } });
      return;
    }
    console.error('[GET /quotes/:id/contract-pdf]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '계약서 생성 중 오류가 발생했습니다.' } });
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
