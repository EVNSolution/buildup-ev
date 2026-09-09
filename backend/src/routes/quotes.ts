import { Router } from 'express';
import { noStore } from '../lib/doc-headers.js';
import { syncOpenContracts } from '../services/contract-sync.js';
import type { Request, Response } from 'express';
import { rbac, requirePermission, ownQuotesOnly, scopedToMine } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { assertQuoteOwner } from '../lib/quote-access.js';
import { collectGeneratedDocPaths, deleteGeneratedDocFilesByPaths } from '../services/docgen.js';
import { generateQuotePdf, QuotePdfError } from '../services/quote-pdf.js';
import { renderContractPdfForQuote, ContractDocError } from '../services/contract-docgen.js';
import { readFrozenDoc, isFrozen, FROZEN_MESSAGE, collectContractFilePaths, deleteContractFiles } from '../services/doc-freeze.js';
import {
  calcPrice, calcQuote, assembleOptionSum, makePriceLookup, groupOfPriceCode,
  CAR_TRIM_LABEL_MAX, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY,
  dieselDeducts, toDieselStatus,
  checkCustomOptions, readCustomOptions, type CustomOption,
  type PricingParams,
} from '@buildup-ev/shared/pricing';
import { buildQuoteParams, quoteExtraFromInputs, type CustomerInput } from '../services/quote-calc.js';
import { upsertCustomer } from '../services/customer-master.js';
import type { Prisma, QuoteStatus } from '@prisma/client';
import { logQuoteChanges, listQuoteChanges } from '../services/quote-history.js';
import { setQuoteStatus } from '../services/quote-status.js';
import { pushWarpDealEvent } from '../services/warp-crm.js';
import { nextQuoteNo } from '../services/quote-no.js';
import { archiveQuoteSnapshot } from '../services/quote-snapshot.js';
import { visibilityWhere, viewOf, VISIBLE } from '../lib/visibility.js';
import { stepsFor } from '@buildup-ev/shared/process';
import { APPENDIX_REMARK, clampAppendix, hasAppendix } from '@buildup-ev/shared/docs/appendix';
import { contractLines, autoLines, normalizePoLines, checkPoLines, unpricedLines, type PoLine } from '@buildup-ev/shared/docs/po-lines';
import { clampMemo } from '@buildup-ev/shared/docs/memo';
import { optionsFromSelections } from '../services/order-options.js';

export const quotesRouter = Router();

// ── 내부 헬퍼: DB 조회 → PricingParams 빌드 ─────────────────────────────


// ── 연도별 순차 견적번호 생성 (YY-NNNN) ─────────────────────────────────────
// 채번은 quote_no_counter(채번대장)가 맡는다 — 견적을 지워도 번호가 되살아나지 않는다.
// (예전 구현은 "남아 있는 견적의 최대번호 +1" 이라 삭제 후 같은 번호가 다시 나갔다)
const genQuoteNo = (prismaClient: NonNullable<typeof prisma>, year: number): Promise<string> =>
  nextQuoteNo(prismaClient, year);

/**
 * **커스텀 특장 옵션 검사** — 저장하는 모든 길목이 이 함수를 쓴다.
 *
 * 반쪽만 적힌 줄(옵션명만 · 금액만)은 **임시저장조차 막는다.** 옵션명만 있으면 얼마를
 * 받을지 모르고, 금액만 있으면 무엇인지 모른 채 청구된다. 어느 쪽도 서류로 나가면 안 된다.
 * 판정은 화면과 **같은 함수**(`checkCustomOptions`)로 한다 — 화면에서만 막으면
 * 옛 화면·직접 호출로 반쪽짜리가 그대로 들어온다.
 *
 * 통과하면 저장할 줄만 돌려준다(+ 만 누르고 안 적은 줄은 버린다).
 * 막으면 `res` 에 400 을 써서 보내고 `null` 을 돌려준다.
 */
function takeCustomOptions(raw: unknown, res: Response): CustomOption[] | null {
  // 아예 안 보낸 요청(옛 화면·다른 경로)은 「건드리지 않음」이다
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '추가 옵션 형식이 올바르지 않습니다.' } });
    return null;
  }
  const drafts = raw.map((r) => {
    const o = (r ?? {}) as { name?: unknown; price?: unknown };
    return {
      name: typeof o.name === 'string' ? o.name : '',
      price: typeof o.price === 'number' && Number.isFinite(o.price) ? o.price : null,
    };
  });
  const check = checkCustomOptions(drafts);
  if (!check.ok) {
    res.status(400).json({ error: { code: 'CUSTOM_OPTION_INCOMPLETE', message: check.message } });
    return null;
  }
  return check.options;
}

/**
 * 단가가 정해지지 않은 사양이 섞였다 — **견적을 낼 수 없다.**
 *
 * 0원과 다른 말이다. 0원은 0으로 정해 둔 것이고(계약상 무상 등), 이건 아직 아무도
 * 값을 정하지 않은 것이다. 조용히 0원으로 넘기면 그 금액이 견적서·계약서까지 그대로 간다.
 *
 * 영업이 읽고 고칠 수 있게 **문항 이름**으로 말한다 —
 * 「DOPT_REEFER_LOW_COUPANG 단가 없음」은 아무도 못 고친다.
 */
export class UnpricedSelectionError extends Error {
  constructor(readonly codes: string[], readonly selections: Record<string, string>) {
    super('단가가 정해지지 않은 사양이 있습니다');
    this.name = 'UnpricedSelectionError';
  }
  /** 어떤 문항에서 났는지 — 그 문항에서 고른 값의 코드를 돌려준다(이름은 라우트가 붙인다) */
  selectedCodes(): string[] {
    const out: string[] = [];
    for (const c of this.codes) {
      const g = groupOfPriceCode(c);
      const picked = this.selections[g];
      if (picked && !out.includes(picked)) out.push(picked);
    }
    return out;
  }
}

/**
 * 미책정 사양 → 영업이 읽는 422.
 *
 * 코드가 아니라 **고른 값의 이름**으로 말한다(「미닫이」). 이름은 옵션 표에서 가져오고,
 * 없으면 코드를 그대로 쓴다 — 이름을 못 찾았다고 오류를 삼키면 안 된다.
 */
/**
 * 발주서 공급가 표를 만든다 — **미리보기와 배정이 같은 함수를 쓴다.**
 * 두 곳이 따로 만들면 보고 누른 표와 저장되는 표가 달라진다.
 *
 * 세 갈래다:
 *   · 계약 단가가 있는 줄 → 값이 채워진 채로, 고칠 수 없다
 *   · 특장사 일인데 단가가 없거나 아직 분류하지 않은 옵션 → **금액만 빈 칸**으로 저절로 생긴다
 *   · EV& 가 직접 하는 일 → 실리지 않는다
 */
async function buildPoLines(
  makerOrgId: string,
  selections: Record<string, string>,
  options: readonly { group_code: string; value_code: string; value_name: string; category: string | null }[],
): Promise<PoLine[]> {
  if (!prisma) return [];
  const rows = (await prisma.makerPrice.findMany({ where: { maker_org_id: makerOrgId, active: true } }))
    .map(r => ({
      label: r.label, group_code: r.group_code, value_code: r.value_code, top_code: r.top_code,
      section: r.section, work_by: r.work_by, unit: r.unit, qty: r.qty,
      unit_price: r.unit_price, sort_order: r.sort_order, memo: r.memo,
    }));
  const picked = options.map(o => ({
    group_code: o.group_code, value_code: o.value_code, value_name: o.value_name,
    // 「차량옵션」(트림)은 우리가 지급하는 차량이라 특장사 발주서에 실리지 않는다
    is_body: o.category !== '차량옵션' && o.category !== '내부',
  }));
  return [...contractLines(selections, rows), ...autoLines(picked, rows, selections)];
}

async function respondUnpriced(e: UnpricedSelectionError, res: Response): Promise<void> {
  let names = e.selectedCodes();
  if (prisma && names.length) {
    const rows = await prisma.optionValue.findMany({
      where: { code: { in: names } }, select: { code: true, name: true },
    });
    const byCode = new Map(rows.map(r => [r.code, r.name]));
    names = names.map(c => byCode.get(c) ?? c);
  }
  res.status(422).json({
    error: {
      code: 'UNSUPPORTED',
      message: names.length
        ? `단가가 정해지지 않은 사양이 있습니다: ${names.join(' · ')}`
        : '단가가 정해지지 않은 사양이 있습니다',
    },
  });
}

async function buildParams(
  model_code: string,
  selections: Record<string, string>,
  customer: CustomerInput | undefined,
  calcYear: number,
  extra?: { promotion_zeroed?: string[]; promotion_discount?: number; local_subsidy_off?: boolean; body_only?: boolean; vehicle_only?: boolean; car_price_override?: number | null; custom_options?: CustomOption[] },
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
  /*
   * **단가가 없는 사양은 0원이 아니다.** 예전엔 `priceMap[code] ?? 0` 이라
   * 행이 없는 사양도 0원으로 계산돼 견적이 그대로 저장됐다 — 고객에게 나가는 값이다.
   * 조회 결과는 아래에서 확인한다(`unpricedSelections`).
   */
  const { price, missing } = makePriceLookup(priceMap);

  const taxMap: Record<string, number> = {};
  for (const t of taxRows) taxMap[t.param_key] = Number(t.value);

  // 특장 옵션 합계 = 옵션DB 복합키(탑 높이 종속) 단가 합 (견적서 D13, D15:D20). 조립은 shared 공용.
  // 재량할인(프로모션)은 조립 단계에서 0원 처리 → 공급가·부가세·취득세·실구매가에 모두 반영된다.
  const { trim_price: rawTrim, option_sum } = assembleOptionSum(
    selections, price, extra?.promotion_zeroed ?? [],
    // 단가표에 없는 사양(영업 직접 입력) — 공급가로 되돌려 합계에 들어간다
    extra?.custom_options ?? [],
  );
  /*
   * 단가가 정해지지 않은 사양이 하나라도 있으면 **여기서 멈춘다.**
   * 조용히 0원으로 넘기면 그 금액이 견적서·계약서까지 그대로 간다.
   *
   * ⚠️ 조립(`assembleOptionSum`) **뒤에** 본다 — 어떤 복합코드를 실제로 조회했는지는
   *    조립을 해 봐야 안다(고르지 않은 문항은 조회조차 하지 않는다).
   */
  if (missing.length) throw new UnpricedSelectionError(missing, selections);

  // 특장만 견적이면 차량가와 보조금이 없다 — 트림을 0으로 두면 나머지는 자연히 따라간다
  const bodyOnly = extra?.body_only === true;
  const trim_price = bodyOnly ? 0 : rawTrim;

  const bizType = (customer?.biz_type ?? 'individual') as
    'individual' | 'corporation' | 'simplified' | 'consumer';
  // 지방보조금 미적용: 관리자 DB 토글(active=false) 또는 견적별 영업 토글
  const localOff = extra?.local_subsidy_off === true || subsidyLoc?.active === false;

  return {
    trim_price,
    option_sum,
    subsidy: {
      national:          bodyOnly ? 0 : (subsidyNat?.amount ?? 0),
      local:             bodyOnly || localOff ? 0 : (subsidyLoc?.amount ?? 0),
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
  const { status, from, to, view, scope } = req.query as Record<string, string | undefined>;

  // 「진행 중」이 기본. 「숨김」을 고르면 **숨긴 것만** 나온다(섞이면 무엇이 숨겨졌는지 모른다).
  const where: Prisma.QuoteWhereInput = { ...visibilityWhere(viewOf(view)) };
  /*
   * 영업 화면은 `scope=mine` 을 붙여 부른다 — **겸직 계정이라도 남의 견적은 안 본다.**
   * 관리자 화면에서 전체를 보는 것과, 영업으로 일하는 화면에 남의 담당 건이 섞이는 것은
   * 전혀 다른 일이다. 이 값은 좁히기만 하므로 화면이 보낸 값을 믿어도 권한이 새지 않는다.
   */
  if (ownQuotesOnly(auth) || scopedToMine(auth, scope)) where.sales_user_id = auth.email;
  if (status) where.status = status as QuoteStatus;
  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  try {
    /*
     * 목록을 내보내기 전에 **끝나지 않은 계약의 서명 상태를 따라잡는다.**
     *
     * 모두싸인 웹훅이 계정에서 잠겨 있어(`/webhooks` → 403) 「서명 완료」가 우리에게
     * 오지 않는다. 그대로 두면 고객이 서명을 마쳐도 계약이 `SENT` 에 멈춰
     * 제작 배정이 열리지 않는다. 화면을 열 때·새로고침을 누를 때·앱으로 돌아올 때가
     * 전부 이 요청을 타므로, 여기 한 곳에 얹으면 셋 다 같아진다.
     *
     * ⚠️ 실패해도 목록은 그대로 내보낸다 — 모두싸인이 죽어도 견적 화면은 멀쩡해야 한다.
     */
    try {
      const n = await syncOpenContracts(prisma);
      if (n > 0) console.info(`[GET /quotes] 계약 상태 ${n}건 따라잡음`);
    } catch (e) {
      console.error('[GET /quotes] 계약 상태 동기화 실패(목록은 그대로 내보낸다)', e);
    }

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
          // signing_method 도 싣는다 — 서면계약(PAPER)과 전자서명 완료는 같은 COMPLETED 라
          // 이 값이 없으면 목록에서 둘을 구분해 적을 수 없다.
          select: { status: true, sent_at: true, completed_at: true, signing_method: true },
        },
      },
    });
    // 목록에서 쓰기 쉬운 형태로 평탄화(참고용 메일 발송 / 전자서명 발송 / 전자서명 완료)
    const data = quotes.map(({ contracts, ...q }) => ({
      ...q,
      contract: contracts[0]
        ? { status: contracts[0].status, sent_at: contracts[0].sent_at, completed_at: contracts[0].completed_at,
            signing_method: contracts[0].signing_method }
        : null,
    }));
    res.json({ data });
  } catch (e) {
    console.error('[GET /quotes]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 목록 조회 중 오류가 발생했습니다.' } });
  }
});

/**
 * 「견적 숨기기」 — **지우지 않고 화면에서만 감춘다.**
 *
 * 2026-09 에 한 번 걷었다가 되살렸다. 그때 걷은 이유는 「쓰이지 않는데 목록 상단만
 * 번잡하다」였는데, 정리할 건이 쌓이면서 다시 필요해졌다. 컬럼을 지우지 않고 두었기에
 * **예전에 숨긴 기록이 그대로 살아 있다**(CLAUDE.md — 지우지 말고 남긴다).
 *
 * 걷을 때의 문제는 되풀이하지 않는다:
 *  · 숨기기는 **관리자 화면에만** 있다(영업 화면에는 없다).
 *  · 목록 상단에 버튼을 더하지 않는다 — 「숨긴 견적」은 보기 전환의 셋째 칸으로 들어간다.
 *
 * ⚠️ **상태로 막지 않는다.** 계약서가 나간 건도, 계약이 끝난 건도 숨길 수 있다(2026-09-08 지시).
 *    정리해야 하는 건은 대개 이미 무언가 나간 것들이라, 상태로 막으면 정작 필요한 것을 못 치운다.
 *
 *    대신 **되돌릴 수 있게** 하고(「숨긴 견적」에서 되돌리기) 화면에서 **한 번 묻는다.**
 *    지우는 것이 아니라 감추는 것이므로 이 정도가 맞다 — 기록은 그대로 남는다.
 *    (고객 숨기기는 그대로다: 고객을 숨기면 그 고객의 견적이 통째로 딸려 가 파장이 다르다)
 */
quotesRouter.patch('/:id/hidden', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 견적 id' } }); return; }

  const hidden = (req.body as { hidden?: unknown })?.hidden;
  if (typeof hidden !== 'boolean') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'hidden 은 true 또는 false' } }); return;
  }

  const by = req.auth?.email ?? 'unknown';
  try {
    const q = await prisma.quote.findUnique({ where: { id }, select: { id: true } });
    if (!q) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }

    const updated = await prisma.quote.update({
      where: { id },
      data: hidden ? { hidden_at: new Date(), hidden_by: by } : { hidden_at: null, hidden_by: null },
      select: { id: true, hidden_at: true, hidden_by: true },
    });
    res.json({ data: updated });
  } catch {
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 숨김 처리 중 오류가 발생했습니다.' } });
  }
});

// ── POST /quotes/calculate — 미저장 계산 ─────────────────────────────────

quotesRouter.post('/calculate', rbac('SALES'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { model_code, year, selections, customer, promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override, custom_options } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    promotion_zeroed?: string[]; promotion_discount?: number; local_subsidy_off?: boolean; body_only?: boolean; vehicle_only?: boolean; car_price_override?: number | null;
    custom_options?: unknown;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  /*
   * 계산만 하는 길이라 반쪽짜리를 막을 필요는 없어 보이지만, **여기서도 막는다.**
   * 화면이 보여 주는 금액과 저장되는 금액이 달라지면 그게 더 나쁘다 —
   * 반쪽 줄을 계산에서 조용히 빼면 「화면엔 보이는데 저장하면 사라지는」 금액이 된다.
   */
  const customCalc = takeCustomOptions(custom_options, res);
  if (customCalc === null) return;
  try {
    const params = await buildParams(model_code, selections, customer, year ?? new Date().getFullYear(), { promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override, custom_options: customCalc });
    const result = calcPrice(params);
    if (result.status === 'unsupported') {
      res.status(422).json({ error: { code: 'UNSUPPORTED', message: result.reason } });
      return;
    }
    res.json({ data: result });
  } catch (e) {
    // 미책정 사양은 서버 오류가 아니다 — 무엇을 고쳐야 하는지 말해 준다
    if (e instanceof UnpricedSelectionError) { await respondUnpriced(e, res); return; }
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
  const { model_code, year, selections, customer, down_payment_rate, installment_months, promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    down_payment_rate?: number; installment_months?: number; promotion_zeroed?: string[]; promotion_discount?: number; local_subsidy_off?: boolean; body_only?: boolean; vehicle_only?: boolean; car_price_override?: number | null;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  try {
    const params = await buildQuoteParams(
      model_code, selections, customer,
      { down_payment_rate, installment_months, promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override },
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
      quoteExtraFromInputs(inp),
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
    const ALLOWED = ['down_payment_rate', 'down_payment_amount', 'installment_months', 'tax_exempt_type', 'has_biz_plate',
      'biz_type', 'is_sosang', 'region', 'has_transport_license', 'diesel_conversion', 'diesel_status', 'promotion_zeroed', 'promotion_discount', 'memo', 'local_subsidy_off', 'body_only', 'vehicle_only', 'vehicle_owned', 'car_price_override', 'car_trim_label',
      // 매매계약서 전용 입력(견적서 생성 팝업에서 함께 받음). 전부 선택 — 비워두면 계약서에 공란으로 나간다.
      'contract_party', 'buyer_agent', 'buyer_relation', 'buyer_regno', 'buyer_tel',
      // 대표이사 — 법인 계약서 서명블록. 저장 후 사업자구분을 고칠 때 함께 고칠 수 있어야 한다.
      'ceo_name',
      // 커스텀 특장 옵션 — 저장 뒤 「수정」에서도 고칠 수 있어야 한다(컨피규레이터와 같게)
      'custom_options',
      // 계약일자 — 계약서를 만들 때 고른 날(YYYY-MM-DD). 비면 만드는 날로 찍힌다
      'contract_date'];
    const body = (req.body ?? {}) as Record<string, unknown>;
    /*
     * 반쪽만 적힌 줄은 **임시저장도 막는다.** 이 길이 「부분저장」이라고 예외를 두면
     * 컨피규레이터에서 막아 둔 것이 수정 팝업으로 그대로 새어 들어온다.
     */
    if ('custom_options' in body) {
      const checked = takeCustomOptions(body['custom_options'], res);
      if (checked === null) return;
      body['custom_options'] = checked;
    }
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
          quoteExtraFromInputs(merged),
          full.created_at.getFullYear(),
        );
        await prisma.quote.update({ where: { id }, data: { final_price: calcQuote(params).real_price } });
      }
    } catch (e) {
      console.error('[PATCH /quotes/:id/inputs] final_price 재계산 실패(입력 저장은 완료)', e);
    }

    // 견적 내용이 바뀌었다 — WARP 수신함이 재확인 대기로 되돌아간다 (#200)
    void pushWarpDealEvent('quote_updated', id);
    archiveQuoteSnapshot(id);   // 고친 판을 서류함에 남긴다
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
      quoteExtraFromInputs(inp),
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

    void pushWarpDealEvent('quote_updated', id); // 옵션 변경 — WARP 재확인 알림 (#200)
    archiveQuoteSnapshot(id);   // 고친 판을 서류함에 남긴다
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
      archiveQuoteSnapshot(created.id);   // 새 견적도 만들어진 순간 한 판을 남긴다
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
    void pushWarpDealEvent('quote_updated', id); // 고객정보 변경 — WARP 재확인 알림 (#200)
    archiveQuoteSnapshot(id);   // 고친 판을 서류함에 남긴다
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
  const { model_code, year, selections, customer, down_payment_rate, installment_months, promotion_zeroed, promotion_discount, memo, local_subsidy_off, body_only, vehicle_only, car_price_override, car_trim_label, vehicle_owned, custom_options } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>; customer?: CustomerInput;
    down_payment_rate?: number; installment_months?: number; promotion_zeroed?: string[]; promotion_discount?: number; memo?: string; local_subsidy_off?: boolean;
    /** 특장만 견적 — 고객이 차를 이미 갖고 있다 */
    body_only?: boolean;
    vehicle_only?: boolean;
    /** 영업이 적어 넣은 차량 가격(VAT 포함). 안 쓰면 null — 트림 단가를 쓴다 */
    car_price_override?: number | null;
    /** 영업이 적어 넣은 트림명. 비면 고른 트림명을 쓴다 */
    car_trim_label?: string;
    /** 특장만일 때 고객이 적어 주는 보유 차량 정보(견적서에 그대로 실린다) */
    vehicle_owned?: Record<string, string>;
    /** 단가표에 없는 사양 — 영업이 옵션명과 금액을 직접 적은 줄 */
    custom_options?: unknown;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  // 반쪽만 적힌 줄이 있으면 **임시저장도 막는다** — 여기서 끝, 아래 계산으로 가지 않는다
  const customSave = takeCustomOptions(custom_options, res);
  if (customSave === null) return;

  const calcYear = year ?? new Date().getFullYear();
  /*
   * 미책정 사양이 섞이면 **저장하지 않는다.** 여기서 안 막으면 0원짜리 줄이 들어간
   * 견적이 그대로 남고, 견적서·계약서까지 그 금액으로 나간다.
   */
  let params;
  try {
    params = await buildParams(model_code, selections, customer, calcYear, { promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override, custom_options: customSave });
  } catch (e) {
    if (e instanceof UnpricedSelectionError) { await respondUnpriced(e, res); return; }
    throw e;
  }
  const result = calcPrice(params);

  // 저장되는 실구매가는 **총견적서 기준**(견적서 PDF·화면과 동일 규칙).
  // calcPrice(Ver1.21)는 공급가액 산출과 하위호환 응답용으로만 유지한다.
  const totalParams = await buildQuoteParams(model_code, selections, customer,
    { down_payment_rate, installment_months, promotion_zeroed, promotion_discount, local_subsidy_off, body_only, vehicle_only, car_price_override, custom_options: customSave }, calcYear);
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
    /*
     * 특장만 견적 — 견적서를 다시 뽑을 때도 같은 금액이 나와야 하므로 여기 남긴다.
     * 보유 차량 정보는 고객이 적어 준 값 그대로(우리가 아는 제원이 아니다).
     */
    body_only: body_only === true,
    // 차량만 견적 — 특장을 장착하지 않는다. 특장만과 동시에 참일 수 없다.
    vehicle_only: body_only !== true && vehicle_only === true,
    vehicle_owned: body_only === true ? (vehicle_owned ?? {}) : {},
    /*
     * 직접 입력한 차량 가격(VAT 포함). 특장만 견적에는 차량이 없으니 남기지 않는다.
     * ⚠️ 안 쓰면 **null** 이다 — 0 으로 저장하면 다시 열 때 차량가가 0원이 된다.
     */
    car_price_override: body_only === true || car_price_override == null
      ? null : Math.max(0, Math.round(car_price_override)),
    /*
     * 직접 입력한 트림명 — 차량 가격을 직접 적은 견적에서만 의미가 있다.
     * 끄면 비운다: 남아 있던 텍스트가 계속 서류에 찍히면 무엇이 진짜인지 알 수 없다.
     */
    car_trim_label: body_only === true || car_price_override == null
      ? '' : String(car_trim_label ?? '').trim().slice(0, CAR_TRIM_LABEL_MAX),
    /*
     * 커스텀 특장 옵션 — 검사를 통과한 줄만 남는다(반쪽 줄은 위에서 이미 400).
     * 「+ 만 누르고 안 적은 줄」은 여기 도달하기 전에 걸러졌다 — 없는 것과 같다.
     */
    custom_options: customSave,
    promotion_zeroed: promotion_zeroed ?? [],  // 프로모션: 0원 처리한 특장옵션 그룹
    promotion_discount: Math.max(0, Math.round(promotion_discount ?? 0)),  // 프로모션 할인액(VAT 포함)
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

  // WARP CRM 수신함에 견적 작성 알림 (#200) — fire-and-forget, 저장을 막지 않는다
  void pushWarpDealEvent('quote_created', quote.id);
  // 저장한 판을 서류함에 남긴다 — 견적서를 열지 않아도 그때 무엇으로 냈는지 남아야 한다
  archiveQuoteSnapshot(quote.id);

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
// 관리자가 제작 특장사를 선정. Order 생성 + 단계 표 생성(전부 pending — 발주·수락은 단계가 아니다).

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
      data: {
        sales_user_id: user.email, org_id: user.org_code, quote_no,
        // 재배정이면 수락도 되돌린다 — 새 담당이 다시 받아야 한다(앞사람의 수락이 남으면 안 된다)
        sales_accepted_at: null,
      },
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

// ── PATCH /quotes/:id/accept-sales — 담당 영업이 배정을 수락 ────────────────
//
// 특장사가 주문을 수락하는 것과 같은 자리다. 관리자가 배정했다는 사실만으로는
// **아무도 붙지 않은 상태**다 — 영업이 내용을 보고 받겠다고 눌러야 담당이 확정된다.
// 그래야 「배정했는데 아무도 안 봤다」와 「받아서 진행 중이다」가 구분된다.
quotesRouter.patch('/:id/accept-sales', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } }); return; }

  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { id: true, sales_user_id: true, sales_accepted_at: true },
    });
    if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
    if (!quote.sales_user_id) {
      res.status(409).json({ error: { code: 'CONFLICT', message: '아직 담당 영업이 배정되지 않았습니다' } }); return;
    }
    // 남에게 배정된 건을 가로채지 못하게 한다(관리자도 대신 수락하지 않는다 — 수락은 받는 사람의 행위다)
    if (quote.sales_user_id !== req.auth!.email) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인에게 배정된 건만 수락할 수 있습니다' } }); return;
    }
    if (quote.sales_accepted_at) {
      res.status(409).json({ error: { code: 'CONFLICT', message: '이미 수락한 건입니다' } }); return;
    }

    /*
     * ⚠️ **읽고 나서 쓰면 둘 다 통과한다.** 위 검사와 이 쓰기 사이에 다른 요청이 끼어들면
     *    둘 다 「아직 수락 안 함」을 보고 둘 다 수락한다 — 동시에 10번 눌러 보니
     *    **10번 다 성공했고 이력도 10줄** 쌓였다(누가 언제 받았는지가 흐려진다).
     *    조건을 쓰는 순간에 함께 건다 — DB 가 한 행을 한 번만 바꾼다.
     */
    const now = new Date();
    const won = await prisma.quote.updateMany({
      where: { id, sales_accepted_at: null },
      data: { sales_accepted_at: now },
    });
    if (won.count === 0) {
      res.status(409).json({ error: { code: 'CONFLICT', message: '이미 수락한 건입니다' } }); return;
    }
    // 언제 누가 받았는지 남긴다 — 배정~수락 사이가 비면 그 구간을 되짚게 된다
    await logQuoteChanges(id, 'inputs', { sales_accepted_at: '' }, { sales_accepted_at: now.toISOString() },
      req.auth?.email ?? 'unknown', ['sales_accepted_at']);

    res.json({ data: { ok: true, sales_accepted_at: now.toISOString() } });
  } catch (e) {
    console.error('[PATCH /quotes/:id/accept-sales]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '수락 중 오류가 발생했습니다.' } });
  }
});

/**
 * 배정 **전에** 발주서를 미리 보여 주기 위한 자료.
 *
 * 관리자는 무엇을 발주하는지 보고 비고를 적어야 하고, 그때 보는 발주서는 특장사가
 * 수락할 때 보는 것과 **같아야 한다**. 그래서 사양 해석을 같은 함수로 한다.
 */
quotesRouter.get('/:id/order-preview', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } }); return; }
  const quote = await prisma.quote.findUnique({
    where: { id },
    select: { model_code: true, selections: true, inputs: true, customer: { select: { name: true } } },
  });
  if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
  const inp = (quote.inputs ?? {}) as Record<string, unknown>;
  /*
   * 발주서 **공급가 표** — 고른 특장사의 계약 단가로 채운다.
   *
   * 특장사를 정해야 값이 나온다(단가는 계약마다 다르다). 아직 안 골랐으면 빈 표를 준다 —
   * 아무 특장사의 값이나 보여 주면 **틀린 금액을 보고 배정하게 된다.**
   * 계약에 없는 사양은 줄이 만들어지지 않는다. 그런 줄은 관리자가 직접 적는다.
   */
  const makerOrgId = String(req.query['maker_org_id'] ?? '');
  const sel = (quote.selections ?? {}) as Record<string, string>;
  const options = await optionsFromSelections(sel);
  const poLines = makerOrgId
    ? await buildPoLines(makerOrgId, sel, options)
    : [];

  res.json({ data: {
    model_code: quote.model_code,
    customer_name: quote.customer?.name ?? '',
    // 영업이 남긴 메모 — 배정 화면에서 **읽기만** 한다(고치는 자리는 견적 수정이다)
    sales_memo: (inp['memo'] as string | undefined) ?? '',
    options,
    po_lines: poLines,
  } });
});

/**
 * 발주서 **임시저장** — 배정 전에 적어 둔 발주서 내용.
 *
 * 발주서를 적는 사람과 배정을 누르는 사람이 다를 수 있다. 예전엔 배정 팝업을 닫으면
 * 적던 것이 전부 날아가서, 한 사람이 앉은자리에서 다 끝내야 했다.
 *
 * ⚠️ 아직 **주문이 아니다.** 배정을 눌러야 발주서가 나간다 — 특장사는 이것을 보지 못한다.
 * ⚠️ 권한은 배정과 **같은 것**을 쓴다(order.confirm). 적어 둘 수 있는 사람과 배정할 수 있는
 *    사람이 다르면, 적어는 뒀는데 아무도 못 누르는 초안이 쌓인다.
 */
quotesRouter.get('/:id/po-draft', rbac('ADMIN'), requirePermission('order.confirm'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } }); return; }
  try {
    // 이미 배정에 쓰인 초안은 없는 것으로 본다 — 되살아나면 지난 내용을 다시 채운다
    const draft = await prisma.poDraft.findFirst({ where: { quote_id: id, consumed_at: null } });
    res.json({ data: draft });
  } catch {
    res.status(500).json({ error: { code: 'INTERNAL', message: '임시저장을 불러오지 못했습니다.' } });
  }
});

quotesRouter.put('/:id/po-draft', rbac('ADMIN'), requirePermission('order.confirm'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 quote id' } }); return; }

  const { maker_org_id, remark, custom_badge, appendix, po_lines } = req.body as {
    maker_org_id?: string | null; remark?: string; custom_badge?: boolean; appendix?: string;
    po_lines?: unknown;
  };

  const quote = await prisma.quote.findUnique({ where: { id }, select: { status: true } });
  if (!quote) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return; }
  /*
   * 배정이 이미 끝난 건에는 적어 둘 자리가 없다 — 발주서는 나갔고, 고칠 곳은 초안이 아니다.
   * 반대로 계약 전(견적완료 등)에는 **허용한다**: 서명을 기다리는 동안 미리 적어 두는 것이
   * 이 기능의 쓸모다. 배정 자체는 계약완료에서만 열린다(assign 이 따로 막는다).
   */
  if (quote.status === 'assigned' || quote.status === 'ordered' || quote.status === 'completed') {
    res.status(409).json({ error: { code: 'CONFLICT', message: `이미 배정된 견적입니다 (현재 ${quote.status})` } });
    return;
  }

  try {
    /*
     * 길이는 **배정과 같은 함수**로 자른다. 여기서 안 자르면 임시저장에는 들어갔는데
     * 배정할 때 잘려, 적어 둔 사람과 배정하는 사람이 **다른 글을 본다.**
     */
    const clamped = {
      maker_org_id: maker_org_id || null,
      remark: clampMemo(remark ?? '') || null,
      custom_badge: custom_badge === true,
      appendix: custom_badge === true && hasAppendix(appendix) ? clampAppendix(appendix!) : null,
      /*
       * **직접 적은 줄만** 담는다. 계약 줄은 팝업을 열 때 그 특장사의 단가표에서 다시 만들어지므로
       * 여기 담아 두면 낡은 값이 되살아난다(그 사이 계약이 갱신됐을 수 있다).
       */
      po_lines: normalizePoLines(po_lines).filter(l => l.source === 'MANUAL') as unknown as Prisma.InputJsonValue,
      saved_at: new Date(),
      saved_by: req.auth?.email ?? 'unknown',
      consumed_at: null,
    };
    const draft = await prisma.poDraft.upsert({
      where: { quote_id: id },
      // 이미 쓴 초안이 있어도 **다시 열어** 덮어쓴다 — 거부돼 되돌아온 건을 다시 적는 경우다
      update: clamped,
      create: { quote_id: id, ...clamped },
    });
    res.json({ data: draft });
  } catch {
    res.status(500).json({ error: { code: 'INTERNAL', message: '임시저장에 실패했습니다.' } });
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

  const { maker_org_id, remark, custom_badge, appendix, po_lines } = req.body as {
    maker_org_id?: string; remark?: string; appendix?: string; po_lines?: unknown;
    /**
     * 「커스텀」 배지 — 특장사 목록에 붙는다. **관리자가 여기서 정한다.**
     * 예전엔 비고에 뭐라도 적히면 자동으로 붙어, 납기 안내 같은 메모에도 배지가 달렸다.
     */
    custom_badge?: boolean;
  };
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

  /*
   * **2페이지가 있는가** — 비고의 안내 문구와 별지 저장이 **같은 답**을 보게 한 자리다.
   *
   * ⚠️ 둘을 따로 판단했더니 어긋났다. 커스텀 배지만 보고 안내 문구를 넣으면서 별지는
   *    `clampAppendix(...) || null` 로 걸렀는데, 공백만 적힌 별지는 `'   '` 라 **참**이라
   *    값으로 저장됐다. 그러면 화면은 `hasAppendix`(공백은 빈 것) 로 판단해 2페이지 탭을
   *    닫아 두는데 1페이지는 **「2페이지(별지)를 확인하세요」라고 가리킨다** —
   *    특장사는 넘길 장이 없는 안내만 읽는다.
   *
   * 안내 문구는 **가리킬 곳이 있을 때만** 넣는다.
   */
  const withAppendix = custom_badge === true && hasAppendix(appendix);

  /*
   * 발주서 **공급가 표** — 배정하는 순간의 줄들을 그대로 얼려 둔다.
   *
   * ⚠️ **계약 줄은 서버가 다시 만든다.** 화면이 보낸 계약 단가를 믿으면 API 를 직접 불러
   *    6,700,000 짜리 항목을 1 원으로 적어 보낼 수 있다 — 화면의 「고칠 수 없음」은
   *    사람이 타이핑하지 못하게 막을 뿐이다. 계약 단가는 계약이 정하는 값이지
   *    보내는 쪽이 정하는 값이 아니다.
   * ⚠️ 관리자가 직접 적은 줄(MANUAL)만 화면에서 받는다 — 계약에 없는 사양이라 정본이 없다.
   * ⚠️ 금액(`amount`)은 보낸 값을 믿지 않고 **단가×수량으로 다시 센다** —
   *    어긋나면 표가 스스로 거짓말을 한다(`normalizePoLines`).
   * ⚠️ 얼려 두는 이유: 발주서는 특장사에게 나가는 문서다. 나중에 단가표를 고쳤다고
   *    지난 발주서 금액이 따라 바뀌면 특장사가 받은 종이와 화면이 어긋난다.
   */
  const sel = (quote.selections ?? {}) as Record<string, string>;
  const poOptions = await optionsFromSelections(sel);
  const built = await buildPoLines(maker_org_id, sel, poOptions);
  const sent = normalizePoLines(po_lines);

  /*
   * 서버가 만든 줄에 **금액만** 얹는다.
   *   · 계약 줄(CONTRACT) — 보낸 값을 아예 보지 않는다. 계약이 정한 값이다.
   *   · 저절로 생긴 줄(AUTO) — 품목명·단위·수량은 옵션이 정하고, **금액만** 받는다.
   *   · 손으로 더한 줄(MANUAL) — 어느 옵션에도 매이지 않아 통째로 받는다.
   */
  const byRef = new Map(sent.filter(l => l.ref).map(l => [l.ref!, l]));
  const filled = built.map(l => {
    if (l.source !== 'AUTO') return l;
    const given = byRef.get(l.ref ?? '');
    if (!given) return l;
    const qty = given.qty > 0 ? given.qty : l.qty;
    return { ...l, qty, unit_price: given.unit_price, amount: given.unit_price * qty };
  });
  const manual = sent.filter(l => l.source === 'MANUAL');
  const lines = [...filled, ...manual];

  /*
   * 금액이 안 채워진 줄이 있으면 **배정하지 않는다.**
   * 0 원짜리 줄이 실린 발주서는 특장사에게 「무상으로 해 주기로 했다」로 읽힌다.
   */
  const blank = unpricedLines(lines);
  if (blank.length) {
    res.status(400).json({ error: { code: 'BAD_INPUT',
      message: `발주서 금액을 적어야 합니다: ${blank.map(l => l.label).join(' · ')}` } });
    return;
  }

  const lineCheck = checkPoLines(lines);
  if (!lineCheck.ok) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: `발주서 금액표 ${lineCheck.row}번째 줄을 확인해 주세요` } });
    return;
  }

  try {
    await setQuoteStatus(id, 'assigned', req.auth?.email ?? 'unknown');
    const now = new Date();
    const [updatedQuote, order] = await prisma.$transaction([
      prisma.quote.findUnique({ where: { id } }),
      prisma.order.create({
        /*
         * 비고 — 발주서에 실리는 이 주문만의 요청사항.
         * 화면과 **같은 규칙**(clampMemo)으로 자른다. 서버에서 안 자르면 API 를 직접
         * 부르는 경로로 긴 글이 들어와 발주서 양식이 깨진다.
         */
        data: {
          quote_id: id, maker_org_id, assigned_at: now,
          /*
           * 커스텀이면 1페이지 비고는 **안내 문구 하나로 고정**한다. 그 칸은 4줄짜리라
           * 커스텀 내용을 담지 못하고, 두 곳에 나눠 적으면 특장사가 어디를 봐야 할지 모른다.
           * 서버가 정하는 이유: 화면이 보낸 값을 믿으면 API 를 직접 불러 딴 글을 넣을 수 있다.
           */
          remark: withAppendix ? APPENDIX_REMARK : (clampMemo(remark ?? '') || null),
          custom_badge: custom_badge === true,
          /*
           * 별지 — **커스텀일 때만** 담는다. 커스텀을 끄면 2페이지는 없는 것이므로
           * 남겨 두면 특장사가 읽어야 할 것이 있는 줄 알고 수락이 막힌다.
           * 길이는 화면과 **같은 함수**로 자른다 — 화면만 막으면 API 로 우회된다.
           */
          appendix: withAppendix ? clampAppendix(appendix!) : null,
          // 빈 표는 넣지 않는다 — 「줄이 없는 표」와 「표가 없다」를 구분한다
          ...(lines.length ? { po_lines: lines as unknown as Prisma.InputJsonValue } : {}),
        },
      }),
    ]);

    /*
     * 새 주문에 단계 표를 깔아 준다 — **전부 pending** 이다.
     * 발주 발행과 수락은 단계가 아니라 주문 자체의 기록(assigned_at·accepted_at·delivery_due)이다.
     * 여기서 안 만들면 특장사가 상세를 열 때 만들어지긴 하지만, 그러면 목록의 진행 요약이
     * 잠시 비어 보인다(아직 아무도 상세를 안 열었을 뿐인데).
     */
    // 특장만 주문은 차량 트랙이 「차량 도착」 하나로 줄어든다 — 처음부터 그 표를 깐다
    const bodyOnly = (updatedQuote?.inputs as { body_only?: unknown } | null)?.body_only === true;
    await prisma.orderStep.createMany({
      data: stepsFor(bodyOnly).map(s => ({
        order_id: order.id, code: s.code, track: s.track, status: 'pending', entered_at: now,
      })),
      skipDuplicates: true,
    });

    /*
     * 임시저장을 **다 썼다고 표시**한다. 지우지 않는다 — 누가 적어 둔 것이 배정으로
     * 이어졌는지가 남아야 한다(CLAUDE.md: 행을 지우지 않는다).
     * 표시해 두지 않으면, 나중에 이 견적이 다시 배정 대기로 돌아왔을 때(특장사 거부)
     * **옛 초안이 되살아나** 이미 한 번 쓴 내용을 다시 채운다.
     * 초안이 없는 배정도 흔하므로 없으면 조용히 지나간다.
     */
    await prisma.poDraft.updateMany({
      where: { quote_id: id, consumed_at: null },
      data: { consumed_at: now },
    });

    res.json({ data: { quote: updatedQuote, order } });
  } catch (e: unknown) {
    /*
     * **같은 견적에 주문은 하나뿐이다**(order.quote_id 가 유일). 배정 버튼을 두 번 누르면
     * 두 요청이 나란히 「아직 주문 없음」을 보고 둘 다 만들려 든다 — 하나는 제약에 부딪힌다.
     *
     * ⚠️ 그걸 500 으로 돌려주면 **배정은 이미 성공했는데 사용자에게는 오류로 보인다.**
     *    동시에 10번 눌러 보니 200×1 · 409×2 · **500×7** 이었다(주문은 1개만 생겼다).
     *    같은 상황을 409 로 답해야 화면이 「이미 배정된 건」이라고 옳게 안내한다.
     */
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: { code: 'ALREADY_ASSIGNED', message: '이미 배정된 견적입니다' } });
      return;
    }
    console.error('[PATCH /quotes/:id/assign]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '특장사 배정 중 오류가 발생했습니다.' } });
  }
});

// ── DELETE /quotes/:id — 견적 삭제 ───────────────────────────────────────
// draft:     SALES=본인, ADMIN=전체 삭제 가능
// confirmed/ordered: is_master만 삭제 가능 (연결된 order·order_option·document 트랜잭션 cascade)
// 그 외:     삭제 불가

/**
 * 견적 삭제 — **없앴다. 언제나 거절한다.**
 *
 * 2026-08-18, 실계약이 카카오 서명 요청 중인 상태에서 없앴다.
 * 이 라우트는 견적만 지우는 게 아니라 **연결된 계약(purchase_contract)과 서명본 PDF,
 * 주문·서류까지 연쇄로 지웠다.** 서명이 끝난 계약은 거래의 증거이고 관청 제출물의 근거다 —
 * 되돌릴 방법이 없다.
 *
 * 라우트를 지우지 않고 남겨 둔 이유: 옛 화면이 호출하면 404 보다
 * **왜 안 되는지 적힌 응답**이 낫다. 지운 기능은 흔적을 남겨야 다음 사람이 되살리지 않는다.
 *
 * ⚠️ 되살리지 말 것. 잘못 만든 견적은 지우는 게 아니라 상태로 관리한다(만료·취소).
 */
quotesRouter.delete('/:id', rbac('ADMIN'), async (_req: Request, res): Promise<void> => {
  res.status(405).json({
    error: {
      code: 'DELETE_DISABLED',
      message: '견적 삭제 기능은 제공하지 않습니다. 계약·서명본이 함께 사라지기 때문입니다.',
    },
  });
});

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
    noStore(res);
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
    noStore(res);
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
    /*
     * ⚠️ **여기에 소유권 검사가 없었다.** 목록과 견적서 PDF 에는 있는데 이 경로만 비어 있어,
     *    남의 견적의 고객명·전화·이메일·주소·실구매가가 그대로 나갔다(실제로 200 을 받아 확인).
     *    같은 자료를 주는 길이 여럿이면 **모든 길에 같은 문**이 있어야 한다.
     */
    if (!(await assertQuoteOwner(req, res, id))) return;

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


// ── 특장사 공급단가 ────────────────────────────────────────────────────────
/**
 * 특장사에 **지급하는** 단가표. 고객 견적가(`option_price`)와 다른 축이다.
 *
 * ⚠️ 행은 **옵션마다 하나씩 미리 있다.** 여기서 만들거나 지우지 않는다 —
 *    아무 코드로나 행을 만들 수 있으면 어느 선택에도 걸리지 않는 유령 줄이 쌓이고,
 *    「이 옵션은 누가 하기로 했더라」를 표에서 답할 수 없게 된다.
 *    고칠 수 있는 것은 **분류(work_by)·단가·품목명·단위·수량**뿐이다.
 */
quotesRouter.get('/maker-prices/:orgId', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const orgId = String(req.params['orgId'] ?? '');
  try {
    const rows = await prisma.makerPrice.findMany({
      where: { maker_org_id: orgId },
      orderBy: { sort_order: 'asc' },
      include: { option: { select: { name: true, group: { select: { name: true } } } } },
    });
    res.json({ data: rows.map(r => ({
      id: r.id, label: r.label, group_code: r.group_code, value_code: r.value_code,
      top_code: r.top_code, section: r.section, work_by: r.work_by,
      unit: r.unit, qty: r.qty, unit_price: r.unit_price, active: r.active, memo: r.memo,
      // 어느 옵션의 줄인지 — 코드만 보여 주면 무엇을 고치는지 알 수 없다
      option_name: r.option?.name ?? null,
      group_name: r.option?.group?.name ?? null,
    })) });
  } catch (e) {
    console.error('[GET /quotes/maker-prices]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '단가표를 불러오지 못했습니다.' } });
  }
});

quotesRouter.patch('/maker-prices/:id', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (isNaN(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 id' } }); return; }

  const { work_by, unit_price, label, unit, qty, active } = req.body as {
    work_by?: string; unit_price?: number | null; label?: string;
    unit?: string; qty?: number; active?: boolean;
  };
  if (work_by !== undefined && !['MAKER', 'EVN', 'NONE'].includes(work_by)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '분류는 MAKER · EVN · NONE 중 하나입니다' } });
    return;
  }
  /*
   * 단가는 **비울 수 있다**(계약에 값이 없다). 0 으로 채워 두지 않는다 —
   * 0 원은 「무상으로 해 주기로 했다」는 뜻이 되어 특장사에게 그대로 나간다.
   */
  const price = unit_price === null || unit_price === undefined || unit_price === ('' as unknown)
    ? null
    : Math.max(0, Math.trunc(Number(unit_price)));
  if (price !== null && !Number.isFinite(price)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '단가는 숫자여야 합니다' } });
    return;
  }

  try {
    // 옵션과의 연결(group_code·value_code·top_code)은 **고치지 않는다** — 행이 옵션에 매여 있다
    const row = await prisma.makerPrice.update({
      where: { id },
      data: {
        ...(work_by !== undefined ? { work_by } : {}),
        ...(unit_price !== undefined ? { unit_price: price } : {}),
        ...(label !== undefined ? { label: String(label).slice(0, 120) } : {}),
        ...(unit !== undefined ? { unit: String(unit).slice(0, 10) || 'EA' } : {}),
        ...(qty !== undefined ? { qty: Math.max(1, Math.trunc(Number(qty) || 1)) } : {}),
        ...(active !== undefined ? { active: active === true } : {}),
      },
    });
    console.info(`[maker_price] ${row.maker_org_id} ${row.value_code} → ${row.work_by} ${row.unit_price ?? '(미책정)'} — ${req.auth?.email ?? 'unknown'}`);
    res.json({ data: { id: row.id } });
  } catch (e) {
    console.error('[PATCH /quotes/maker-prices]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '단가를 고치지 못했습니다.' } });
  }
});
