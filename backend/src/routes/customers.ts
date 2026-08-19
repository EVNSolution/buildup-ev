/**
 * 고객 마스터 조회 — 견적 입력 시 지난 값 자동 기입용.
 *
 * ⚠️ **완전일치 1건만** 돌려준다. 부분검색·목록 엔드포인트는 만들지 않는다.
 *    이름 일부만으로 고객 목록이 나오면 남의 연락처·주소를 훑을 수 있게 된다.
 *    호출자는 성명과 생년월일(사업자번호)을 **둘 다** 알고 있어야 한다.
 */
import { Router } from 'express';
import { visibilityWhere, viewOf } from '../lib/visibility.js';
import { SENT_CONTRACT_FILTER, canHideAnything } from '../lib/hide-rules.js';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { findCustomerByKey, hasMasterKey } from '../services/customer-master.js';
import { digitsOnly, lookupWarpCustomer } from '../services/warp-crm.js';

export const customersRouter = Router();

// ── GET /customers/lookup?name=&reg_no= — 완전일치 1건(없으면 data: null) ──
customersRouter.get('/lookup', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { name, reg_no } = req.query as Record<string, string | undefined>;

  // 둘 중 하나라도 없으면 조회하지 않는다 — 한 값만으로 찾게 두면 사실상 목록 조회가 된다.
  if (!hasMasterKey(name, reg_no)) {
    res.status(400).json({
      error: { code: 'BAD_INPUT', message: '성명(상호)과 생년월일(사업자번호)이 모두 필요합니다' },
    });
    return;
  }

  try {
    const found = await findCustomerByKey(name!, reg_no!);
    res.json({ data: found });
  } catch (e) {
    console.error('[GET /customers/lookup]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객 조회 중 오류가 발생했습니다.' } });
  }
});

// ── GET /customers/warp-lookup?name=&phone= — WARP CRM 완전일치 조회(자동 기입, 부가 기능) ──
// 브라우저가 WARP 를 직접 부르지 않도록 여기서 프록시한다 — API 키는 서버 .env 에만 있다.
// 이름+전화 **둘 다** 완전일치해야 1건이 나온다(부분검색·목록 없음 — /lookup 과 같은 원칙).
// WARP 미설정·다운·미매칭 전부 200 { data: null } — 부가 기능이 견적 입력을 막으면 안 된다.
customersRouter.get('/warp-lookup', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  const { name, phone } = req.query as Record<string, string | undefined>;
  if (!name?.trim() || digitsOnly(phone).length < 9) {
    res.status(400).json({
      error: { code: 'BAD_INPUT', message: '성명과 휴대폰번호가 모두 필요합니다' },
    });
    return;
  }
  const hit = await lookupWarpCustomer(name, phone!); // 실패는 내부에서 null 로 삼킨다
  res.json({ data: hit });
});

// ── GET /customers — 목록 (관리자) ──────────────────────────────────────────
/**
 * 고객 정리용 목록. 견적 수·WARP 연결 여부를 함께 준다 —
 * **무엇을 숨겨도 되는지** 판단하려면 이 둘이 필요하다.
 */
customersRouter.get('/', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const { view } = req.query as Record<string, string | undefined>;
  try {
    const rows = await prisma.customer.findMany({
      where: { ...visibilityWhere(viewOf(view)) },
      orderBy: { created_at: 'desc' },
      select: {
        id: true, name: true, phone: true, email: true, reg_no: true,
        warp_customer_id: true, created_by: true, created_at: true,
        hidden_at: true, hidden_by: true,
        _count: { select: { quotes: true } },
      },
    });

    /*
     * 「숨길 수 있는가」를 화면이 판단하려면 **계약 수**가 필요하다.
     * 계약이 붙은 견적을 가진 고객은 실거래라 숨길 수 없다(서버도 막는다).
     * 고객마다 따로 세지 않고 한 번에 모아 센다 — 목록이 길어져도 질의는 하나다.
     */
    const ids = rows.map(r => r.id);
    const withContract = ids.length
      ? await prisma.quote.groupBy({
        by: ['customer_id'],
        // 「숨길 수 있는가」의 기준과 같아야 한다 — 발송된 계약만 센다
        where: { customer_id: { in: ids }, contracts: { some: SENT_CONTRACT_FILTER } },
        _count: { _all: true },
      })
      : [];
    const contractCount = new Map(withContract.map(g => [g.customer_id, g._count._all]));

    res.json({ data: rows.map(r => ({ ...r, contract_quotes: contractCount.get(r.id) ?? 0 })) });
  } catch (e) {
    console.error('[GET /customers]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객 목록 조회 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /customers/:id/hidden — 숨기기 / 다시 보이기 ──────────────────────
/**
 * 지우지 않고 화면에서만 감춘다. **WARP 에 연결되지 않은 고객만** 가능하다.
 *
 * 이미 연결된 고객을 숨기면 `GET /external/customers` 에서 빠져
 * **WARP 쪽에서 그 고객이 증발한 것처럼 보인다.** 그래서 여기서 막는다.
 * (2026-08-18 기준 연결된 고객은 0명 — 지금이 테스트 고객을 정리하기 좋은 시점이다)
 */
/**
 * 고객을 숨기면 **그 고객의 견적도 함께 숨긴다.**
 *
 * 고객 숨기기는 「이 고객은 안 쓴다(대개 테스트로 만든 것)」는 선언이다. 그러면 그 고객의
 * 견적도 안 쓰는 것이라, 따로 하나씩 숨기게 하면 손이 많이 가고 빠뜨리기 쉽다.
 *
 * ⚠️ **계약서가 고객에게 발송된 견적이 하나라도 있으면 거부한다.** 고객이 이미 받아 본
 *    것이고 서명이 진행 중일 수 있다. 견적 숨기기와 **같은 기준**이다(lib/hide-rules.ts).
 *
 * ⚠️ **WARP 에 연결된 고객도 거부한다.** 숨기면 export 에서 빠져 그쪽에서 증발한 것처럼 보인다.
 *
 * 다만 **마스터는 무엇이든** 숨길 수 있다 — 잘못 나간 것까지 정리해야 하는 사람이 하나는 필요하다.
 *
 * 되돌릴 때는 **이때 함께 숨긴 견적만** 되돌린다. 원래 따로 숨겨 둔 견적까지 되살리면
 * 사람이 내린 결정을 덮어쓰게 된다 — 그래서 hidden_by 에 표식을 남겨 구분한다.
 */
const cascadeMark = (email: string) => `system(고객 숨김 · ${email})`;

customersRouter.patch('/:id/hidden', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 고객 id' } }); return; }

  const hidden = (req.body as { hidden?: unknown })?.hidden;
  if (typeof hidden !== 'boolean') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'hidden 은 true 또는 false' } }); return;
  }

  const by = req.auth?.email ?? 'unknown';
  const mark = cascadeMark(by);

  try {
    const c = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, name: true, warp_customer_id: true },
    });
    if (!c) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '고객을 찾을 수 없습니다' } }); return; }

    if (hidden && !canHideAnything(req.auth)) {
      if (c.warp_customer_id) {
        res.status(409).json({ error: { code: 'NOT_HIDABLE',
          message: 'WARP 에 연결된 고객은 숨길 수 없습니다. 숨기면 CRM 쪽에서 사라진 것처럼 보입니다.' } });
        return;
      }
      // 계약서가 나간 견적이 하나라도 있으면 숨길 수 없다 — 견적 숨기기와 같은 기준
      const sent = await prisma.quote.count({
        where: { customer_id: id, contracts: { some: SENT_CONTRACT_FILTER } },
      });
      if (sent > 0) {
        res.status(409).json({ error: { code: 'NOT_HIDABLE',
          message: `계약서가 발송된 견적이 있어 숨길 수 없습니다 (${sent}건).` } });
        return;
      }
    }

    const [updated, quotes] = await prisma.$transaction([
      prisma.customer.update({
        where: { id },
        data: hidden ? { hidden_at: new Date(), hidden_by: by } : { hidden_at: null, hidden_by: null },
        select: { id: true, name: true, hidden_at: true, hidden_by: true },
      }),
      hidden
        // 아직 안 숨겨진 견적만 표식을 달아 숨긴다(이미 사람이 숨긴 건 그대로 둔다)
        ? prisma.quote.updateMany({
          where: { customer_id: id, hidden_at: null },
          data: { hidden_at: new Date(), hidden_by: mark },
        })
        // 되돌릴 때는 **이때 함께 숨긴 것만** — 사람이 따로 숨긴 견적은 건드리지 않는다
        : prisma.quote.updateMany({
          where: { customer_id: id, hidden_by: mark },
          data: { hidden_at: null, hidden_by: null },
        }),
    ]);

    console.info(`[customers] 고객 ${id}(${c.name}) ${hidden ? '숨김' : '다시 보이기'} — ${by} · 견적 ${quotes.count}건 동반`);
    res.json({ data: { ...updated, quotes_affected: quotes.count } });
  } catch (e) {
    console.error('[PATCH /customers/:id/hidden]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '숨김 처리 중 오류가 발생했습니다.' } });
  }
});

