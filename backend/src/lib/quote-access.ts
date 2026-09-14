import type { Request, Response } from 'express';
import { prisma } from './prisma.js';
import { ownQuotesOnly, type AuthContext } from '../middleware/rbac.js';

/**
 * **이 견적을 이 사람이 다뤄도 되는가** — 아니면 응답을 보내고 `false`.
 *
 * 규칙은 목록(`GET /quotes`)과 같다 — `ownQuotesOnly` 하나로 판정한다.
 *
 *   · **영업 권한만** 있는 계정 → 자기 담당 건만
 *   · **관리자 권한이 있으면**(겸직 포함) → 전부. 관제하는 자리다.
 *
 * ⚠️ 「내 고객만 본다」를 관리자에게까지 씌우지 않는다. 그건 **영업 화면에서만** 해당하고,
 *    그 좁히기는 화면이 `scope=mine` 을 붙여 목록에서 따로 한다(`scopedToMine`).
 *    여기서 함께 막으면 관리자가 남의 건을 열어 볼 수 없게 되어 관제가 불가능해진다.
 *
 * ⚠️ 이 판정이 한 곳에 없어서 **경로마다 갈렸다.** 견적서 PDF(`/pdf`)에는 검사가 있는데
 *    같은 자료를 주는 `GET /quotes/:id` 에는 없어서, 남의 견적의 고객명·전화·이메일·주소·
 *    실구매가가 그대로 나갔다(실제로 200 을 받아 확인). 계약서 발송·취소처럼 **쓰는**
 *    경로까지 비어 있었다 — 남의 계약서를 고객에게 보낼 수 있었다는 뜻이다.
 *
 * ⚠️ 「없음」과 「권한 없음」을 가르지 않는다. 둘 다 404 로 답하면 **id 를 훑어
 *    존재 여부를 알아내는 것**도 막힌다. 다만 이미 403 을 쓰던 자리(견적서 PDF)와
 *    말이 갈리지 않게, 여기서는 있는 것을 못 보는 경우만 403 으로 둔다 —
 *    화면이 「없다」와 「내 것이 아니다」를 다르게 안내해야 하기 때문이다.
 */
export async function assertQuoteOwner(req: Request, res: Response, quoteId: number): Promise<boolean> {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return false;
  }
  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { sales_user_id: true },
  });
  if (!quote) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } });
    return false;
  }
  if (ownQuotesOnly(req.auth!) && quote.sales_user_id !== req.auth!.email) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 담당 견적만 다룰 수 있습니다' } });
    return false;
  }
  return true;
}

/**
 * 주문 번호로 같은 판정을 한다 — 서류 라우트는 견적이 아니라 **주문** 번호를 받는다.
 * 주문에 붙은 견적의 담당 영업으로 따진다.
 *
 * ⚠️ **겸직 계정은 가진 역할 중 하나라도 근거가 되면 통과한다** — 단, 그 경로가 허용한 역할로만.
 *    특장사 계정에 영업 겸직을 주었더니 특장 화면에서 **자기 조직에 배정된 주문**을 열 때
 *    「본인 담당 견적의 주문만」에 막혀 403 이 났다(2026-09-14 모바일 제보). 영업 검사가
 *    특장 역할로 볼 수 있는 것까지 막은 것이다.
 *    특장사도 쓰는 경로는 `maker: true` 를 넘겨, 특장 근거(자기 조직 배정)도 인정하게 한다.
 *    영업 전용 경로(계약서 등)는 넘기지 않는다 — 특장 근거로 남의 고객 개인정보가 열리면 안 된다.
 *    규칙은 단계 화면(steps.loadOrder)·목록(GET /orders)과 같다.
 */
export async function assertOrderQuoteOwner(
  req: Request, res: Response, orderId: number,
  opts: {
    /** 특장사도 쓰는 경로인가 — 그러면 자기 조직에 배정된 주문도 근거가 된다 */
    maker?: boolean
    /** 자기가 거부해 아직 다른 곳에 안 넘어간 주문도 근거로 볼까(상세·대화) */
    allowRejected?: boolean
  } = {},
): Promise<boolean> {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return false;
  }
  const auth = req.auth!;
  if (!ownQuotesOnly(auth)) return true;   // 관리자·특장사는 다른 규칙이 이미 봤다
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { maker_org_id: true, rejected_by_org: true, quote: { select: { sales_user_id: true } } },
  });
  if (!order) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
    return false;
  }
  if (order.quote?.sales_user_id === auth.email) return true;
  if (opts.maker && makerReaches(auth, order, opts.allowRejected === true)) return true;
  res.status(403).json({ error: { code: 'FORBIDDEN', message: '본인 담당 견적의 주문만 다룰 수 있습니다' } });
  return false;
}

/** 특장 역할로 이 주문에 닿는가 — 자기 조직에 배정됐거나, (허용하면) 자기가 거부해 아직 비어 있다 */
export function makerReaches(
  auth: AuthContext,
  order: { maker_org_id: string | null; rejected_by_org?: string | null },
  allowRejected: boolean,
): boolean {
  if (!auth.roles.includes('MAKER')) return false;
  if (order.maker_org_id === auth.org_code) return true;
  return allowRejected && order.maker_org_id === null && order.rejected_by_org === auth.org_code;
}

/** 영업 역할로 이 주문에 닿는가 — 자기가 담당한 견적이다 */
export function salesReaches(auth: AuthContext, order: { quote?: { sales_user_id: string | null } | null }): boolean {
  return auth.roles.includes('SALES') && !!order.quote && order.quote.sales_user_id === auth.email;
}
