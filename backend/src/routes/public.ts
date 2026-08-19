/**
 * 공개(비로그인) API — `/api/v1/public/*`
 *
 * 누구나 사이트에 들어와 스스로 사양을 고르고 실구매가를 확인한 뒤 상담을 신청한다.
 *
 * ⚠️ **기존 라우트에 공개 허용을 얹지 않고 여기 따로 판다.** 기존 라우트는 잠근 채 두고,
 *    공개용은 내려줄 것을 여기서 직접 고른다 — 로그인 화면에 필드가 하나 늘었을 때
 *    그것이 조용히 공개로 새어 나갈 자리를 만들지 않기 위해서다.
 *
 * 여기서 지키는 것 넷:
 *   1. 읽기는 **카탈로그(가격표·규칙·세율)뿐**. 고객 정보를 읽는 경로가 없다.
 *   2. 금액은 **서버가 다시 계산**한다. 클라이언트가 보낸 금액은 쓰지 않는다.
 *   3. 재량할인(프로모션)·지방보조금 미적용은 **입력 자체를 받지 않는다** — 영업 재량 값이다.
 *   4. 접수 응답은 **접수번호만**. 저장된 내용을 되돌려주지 않는다(남의 견적 조회 통로 금지).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { loadPricingBundle, listRegionNames, findLocalSubsidy } from '../services/catalog.js';
import { buildQuoteParams } from '../services/quote-calc.js';
import { calcQuote } from '@buildup-ev/shared/pricing';

export const publicRouter = Router();

const IS_PROD = process.env['NODE_ENV'] === 'production';

/** 조회 — 사람이 옵션을 이리저리 바꿔 보는 동안 계속 호출된다. 넉넉히 둔다. */
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 120,
  skip: () => !IS_PROD, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: '잠시 후 다시 시도해 주세요.' } },
});

/** 접수 — 사람이 누르는 것은 한 번이다. 봇이 긁어 담는 것을 막는다. */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 5,
  skip: () => !IS_PROD, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' } },
});

// ── 카탈로그(읽기) ────────────────────────────────────────────────────────

publicRouter.get('/models/:modelCode/pricing-bundle', readLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  try {
    const bundle = await loadPricingBundle(
      req.params['modelCode'] as string,
      Number(req.query['year'] ?? new Date().getFullYear()),
    );
    if (!bundle) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '차종을 찾을 수 없습니다' } }); return; }
    res.json({ data: bundle });
  } catch (e) {
    console.error('[GET /public/pricing-bundle]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '차종 정보를 불러오지 못했습니다.' } });
  }
});

publicRouter.get('/regions', readLimiter, async (_req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  try {
    res.json({ data: await listRegionNames() });
  } catch (e) {
    console.error('[GET /public/regions]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '지역 목록을 불러오지 못했습니다.' } });
  }
});

publicRouter.get('/subsidy/local', readLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const region = req.query['region'] as string | undefined;
  if (!region) { res.status(400).json({ error: { code: 'BAD_INPUT', message: 'region 파라미터 필요' } }); return; }
  try {
    res.json({ data: await findLocalSubsidy(region, Number(req.query['year'] ?? new Date().getFullYear())) });
  } catch (e) {
    console.error('[GET /public/subsidy/local]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '보조금 조회 중 오류가 발생했습니다.' } });
  }
});

// ── 계산 ──────────────────────────────────────────────────────────────────

/**
 * 사양·조건으로 총견적을 계산한다. **저장하지 않는다.**
 * 영업 화면의 `/quotes/calculate-total` 과 같은 엔진(calcQuote)을 쓰되,
 * 재량할인·지방보조금 토글은 받지 않는다(공개 화면에는 그 조작 자체가 없다).
 */
publicRouter.post('/quotes/calculate-total', readLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { model_code, year, selections, customer } = req.body as {
    model_code?: string; year?: number;
    selections?: Record<string, string>;
    customer?: PublicSubsidyInput;
  };
  if (!model_code || !selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'model_code, selections 필수' } });
    return;
  }
  try {
    const params = await buildQuoteParams(
      model_code, selections, subsidyOnly(customer),
      { body_only: (req.body as { body_only?: boolean }).body_only === true },
      year ?? new Date().getFullYear(),
    );
    res.json({ data: calcQuote(params) });
  } catch (e) {
    console.error('[POST /public/quotes/calculate-total]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '견적 계산 중 오류가 발생했습니다.' } });
  }
});

// ── 상담 신청(접수) ───────────────────────────────────────────────────────

/** 보조금 계산에 쓰는 조건만 — 여기 없는 키는 계산에 들어가지 않는다. */
interface PublicSubsidyInput {
  region?: string;
  biz_type?: string;
  is_sosang?: boolean;
  has_transport_license?: boolean;
  diesel_status?: string;
}

/** 공개 입력에서 **계산에 쓰는 조건만** 추려낸다(임의 키 오염 방지). */
function subsidyOnly(c: PublicSubsidyInput | undefined) {
  if (!c) return undefined;
  return {
    region: str(c.region, 60),
    biz_type: str(c.biz_type, 20),
    is_sosang: c.is_sosang === true,
    has_transport_license: c.has_transport_license === true,
    diesel_status: str(c.diesel_status, 20),
  };
}

function str(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

publicRouter.post('/inquiries', submitLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }

  const body = (req.body ?? {}) as {
    model_code?: string; year?: number;
    selections?: Record<string, string>;
    contact?: { name?: string; phone?: string; email?: string; memo?: string };
    subsidy?: PublicSubsidyInput;
    agreed?: boolean;
    /** 특장만 견적 — 고객이 차를 이미 갖고 있다(차량 금액·보조금이 전부 빠진다) */
    body_only?: boolean;
    /** 고객이 고른 보유 차종(PV5 오픈베드 4트림 중 하나) */
    vehicle_owned?: { model?: string };
    /** 봇 잡이 — 사람 눈에 안 보이는 칸. 채워져 오면 봇이다. */
    website?: string;
  };

  // 허니팟: 조용히 성공한 척한다(봇에게 실패를 알려 주면 우회한다)
  if (body.website) { res.status(201).json({ data: { inquiry_id: 0 } }); return; }

  const name = str(body.contact?.name, 60);
  const phone = str(body.contact?.phone, 20);
  const email = str(body.contact?.email, 120);
  const region = str(body.subsidy?.region, 60);
  const bizType = str(body.subsidy?.biz_type, 20);

  if (!body.model_code || !body.selections) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '차종·사양이 필요합니다' } }); return;
  }
  /*
   * ⚠️ 지역은 **법인사업자에게 요구하지 않는다.**
   *
   * 법인은 지방보조금 대상이 아니라(계산에서도 0 고정) 화면에서 지역 칸 자체를 없앤다.
   * 그런데 여기서는 모두에게 요구하고 있어, 법인을 고른 고객은 채울 칸이 없는 값을
   * 채우라는 400 을 받고 **상담 신청을 아예 넣을 수 없었다**(실제 제보).
   * 화면이 안 받는 값을 서버가 요구하면 그 조합은 통째로 막힌다.
   */
  /*
   * 특장만 견적에도 지역을 요구하지 않는다 — 보조금이 없어 쓰이지 않는 값이다.
   * 화면에서 칸을 감췄으므로 여기서 요구하면 **채울 수 없는 값 때문에 접수가 막힌다**
   * (법인에서 실제로 그랬다).
   */
  const needRegion = bizType !== 'corporation' && body.body_only !== true;
  const missing = [
    [name, '성명'], [phone, '휴대폰'], [email, '이메일'],
    ...(needRegion ? [[region, '지역']] : []),
    [bizType, '사업자 구분'],
  ].filter(([v]) => !v).map(([, k]) => k);
  if (missing.length) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: `${missing.join(', ')} 을(를) 입력해 주세요.` } });
    return;
  }
  // 동의 없이는 저장하지 않는다 — 저장의 근거가 동의이기 때문이다.
  if (body.agreed !== true) {
    res.status(400).json({ error: { code: 'CONSENT_REQUIRED', message: '개인정보 수집·이용에 동의해야 상담을 신청할 수 있습니다.' } });
    return;
  }

  try {
    const calcYear = body.year ?? new Date().getFullYear();
    // ⚠️ 금액은 **서버가 계산한다**. 화면이 보낸 숫자는 쓰지 않는다.
    const params = await buildQuoteParams(body.model_code, body.selections, subsidyOnly(body.subsidy),
      { body_only: body.body_only === true }, calcYear);
    const total = calcQuote(params);

    const customer = await prisma.customer.create({
      data: { name: name!, phone, email },
    });

    /*
     * 견적번호(26-XXXX)는 **여기서 주지 않는다**. 번호는 한 번 나가면 재사용하지 않는 자원이라
     * 접수 단계에서 먹으면 실제 계약 번호가 듬성듬성해진다. 영업 배정 시점에 채번한다.
     */
    const quote = await prisma.quote.create({
      data: {
        model_code: body.model_code,
        selections: body.selections as unknown as Prisma.InputJsonValue,
        inputs: {
          region, biz_type: bizType,
          is_sosang: body.subsidy?.is_sosang === true,
          has_transport_license: body.subsidy?.has_transport_license === true,
          diesel_status: str(body.subsidy?.diesel_status, 20) ?? 'none',
          memo: str(body.contact?.memo, 500) ?? '',
          // 특장만 견적 — 영업이 이어받을 때 같은 금액이 나와야 한다
          body_only: body.body_only === true,
          /*
           * 어떤 차에 얹는지 — 고객이 고른 값 그대로 남긴다.
           * 영업이 이어받아 견적을 열었을 때 여기서 되읽는다(다시 물어보지 않게).
           */
          vehicle_owned: body.body_only === true
            ? { model: str(body.vehicle_owned?.model, 60) ?? '' }
            : {},
          // 동의 시각 — 언제 받은 동의인지 남긴다(방침 이행 근거)
          consent_at: new Date().toISOString(),
        } as unknown as Prisma.InputJsonValue,
        // 공급가액(부가세 전)은 차량·특장 가격 합에서 부가세를 뺀 값 — 영업 저장과 같은 자리에 넣는다.
        // (영업 경로는 calcPrice 가 따로 내주지만, 공개 접수는 총견적서 엔진 하나만 쓴다)
        supply_price: Math.round((total.car_price + total.body_price) / 1.1),
        final_price: total.real_price,
        status: 'draft',
        source: 'public',
        customer_id: customer.id,
        // 배정 전까지 주인이 없다 — 영업 화면 어디에도 보이지 않는다
        sales_user_id: null,
        org_id: null,
      },
      select: { id: true },
    });

    // 응답은 접수번호만 — 저장 내용을 되돌려주지 않는다
    res.status(201).json({ data: { inquiry_id: quote.id } });
  } catch (e) {
    console.error('[POST /public/inquiries]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '상담 신청 중 오류가 발생했습니다.' } });
  }
});
