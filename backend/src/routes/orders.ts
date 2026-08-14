import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission, isAdmin, ownOrgOnly, canSeeQuotePrices } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { setQuoteStatus } from '../services/quote-status.js';
import type { Prisma } from '@prisma/client';
import { checkDeliveryDue, fromDateInput, toDateInput, toDbDate } from '@buildup-ev/shared/schedule';
import { STEPS, isOverdue } from '@buildup-ev/shared/process';

export const ordersRouter = Router();

// ── GET /orders — 목록 (ADMIN=전체, MAKER=자기 배정, SALES=자기 견적) ─────

ordersRouter.get('/', rbac('ADMIN', 'SALES', 'MAKER'), requirePermission('order.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const auth = req.auth!;
  const { status, from, to } = req.query as Record<string, string | undefined>;

  const where: Prisma.OrderWhereInput = {};
  /*
   * 범위는 **가진 역할 전부**로 정한다. 관리자면 전체, 아니면 겸직한 역할만큼 넓힌다
   * (영업+특장 겸직이면 자기 견적의 주문 ∪ 자기 조직에 배정된 주문).
   */
  if (!isAdmin(auth)) {
    const scopes: Prisma.OrderWhereInput[] = [];
    if (auth.roles.includes('MAKER')) scopes.push({ maker_org_id: auth.org_code });
    if (auth.roles.includes('SALES')) scopes.push({ quote: { sales_user_id: auth.email } });
    if (scopes.length === 1) Object.assign(where, scopes[0]);
    else if (scopes.length > 1) where.OR = scopes;
  }
  // status 필터는 없앴다 — 옛 6단계 값이다. 진행은 단계 표가 갖는다

  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  /*
   * ⚠️ **어느 행을 볼지(where)와 어느 칸을 볼지(select)는 다른 문제다.**
   *    여기는 오래도록 where 만 좁혀 두어, 특장사에게도 공급가·실구매가가 그대로 나갔다.
   *    상세(GET /orders/:id)는 처음부터 금액을 빼고 있었으므로 목록만 어긋나 있던 것이다.
   *    화면이 그 값을 그리지 않아 눈에 띄지 않았을 뿐, 응답에는 실려 브라우저까지 갔다.
   *
   *    자격 판정은 rbac 의 canSeeQuotePrices 하나만 본다(라우트마다 손으로 적지 않는다).
   */
  const showPrice = canSeeQuotePrices(auth);

  try {
    const orders = await prisma.order.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        quote: {
          select: {
            model_code: true,
            // 금액은 자격이 있을 때만 **조회 자체를 하지 않는다**(응답에서 지우는 방식은
            // 지우는 곳을 하나 빠뜨리면 그대로 새어 나간다)
            supply_price: showPrice,
            final_price: showPrice,
            status: true, customer_id: true,
            customer: { select: { id: true, name: true } },
          },
        },
        maker_org: { select: { code: true, name: true } },
        // 목록에서도 「지금 뭘 해야 하나」가 보여야 한다 — 상세를 열어야 알 수 있으면
        // 여러 건을 훑는 화면(칸반 자리)이 쓸모없어진다
        steps: { select: { code: true, status: true, planned_at: true } },
      },
    });

    const now = new Date();
    const data = orders.map(({ steps, ...o }) => {
      const done = new Set(steps.filter(s => s.status === 'done').map(s => s.code));
      // 지금 손댈 수 있는 것 = 선행이 다 끝났고 아직 안 끝난 것
      const openDefs = STEPS.filter(d => !done.has(d.code) && d.requires.every(q => done.has(q)));
      const byCode = new Map(steps.map(s => [s.code, s]));
      return {
        ...o,
        steps: {
          done: done.size,
          total: STEPS.length,
          open: openDefs.map(d => d.label),
          // 하나라도 오래 멈춰 있으면 목록에서 바로 드러나야 한다
          // 지연 = **약속한 날을 넘긴 것**. 납기는 주문에서, 검사 마감은 신청 단계에서 온다
        stalled: openDefs.some(d => {
          if (!d.dueFrom) return false;
          const due = d.dueFrom.from === 'order'
            ? (o.delivery_due ? o.delivery_due.toISOString().slice(0, 10) : null)
            : (byCode.get(d.dueFrom.code)?.planned_at?.toISOString().slice(0, 10) ?? null);
          return isOverdue(d.code, { code: d.code, status: 'pending' }, due, now, done);
        }),
        },
      };
    });
    res.json({ data });
  } catch (e) {
    console.error('[GET /orders]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 목록을 불러오는 중 오류가 발생했습니다.' } });
  }
});

// ── GET /orders/:id ───────────────────────────────────────────────────────
// MAKER: 자기 org 스코프 강제 + 가격·영업 필드 제외, 사양·서류만 반환

ordersRouter.get('/:id', rbac('SALES', 'ADMIN', 'MAKER'), requirePermission('order.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    const auth = req.auth!;

    if (ownOrgOnly(auth)) {
      // MAKER: 사양·서류만 — 가격·영업 필드 제외
      const order = await prisma.order.findUnique({
        where: { id },
        include: {
          quote: { select: { model_code: true, selections: true, customer: { select: { name: true } } } },
          documents: { orderBy: { id: 'asc' } },
          options: { include: { value: { include: { group: { select: { code: true, name: true } } } } } },
        },
      });
      if (!order) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
        return;
      }
      if (!auth.is_master && order.maker_org_id !== auth.org_code) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
        return;
      }

      // 옵션 사양 해석: OrderOption 있으면 우선, 없으면 quote.selections JSON 파싱
      type ResolvedOpt = { id: number; group_code: string; group_name: string; value_code: string; value_name: string };
      let options: ResolvedOpt[] = [];
      if (order.options.length > 0) {
        options = order.options.map(o => ({
          id: o.id,
          group_code: o.group_code,
          group_name: o.value.group.name,
          value_code: o.value_code,
          value_name: o.value.name,
        }));
      } else {
        const selections = (order.quote.selections ?? {}) as Record<string, string>;
        const valueCodes = Object.values(selections).filter(Boolean);
        if (valueCodes.length > 0) {
          const values = await prisma.optionValue.findMany({
            where: { code: { in: valueCodes } },
            include: { group: { select: { code: true, name: true } } },
          });
          const vMap = new Map(values.map(v => [v.code, v]));
          options = Object.entries(selections)
            .filter(([, vCode]) => vMap.has(vCode))
            .map(([gCode, vCode], idx) => {
              const v = vMap.get(vCode)!;
              return { id: idx, group_code: gCode, group_name: v.group.name, value_code: vCode, value_name: v.name };
            });
        }
      }

      res.json({
        data: {
          id: order.id,
          quote_id: order.quote_id,
          maker_org_id: order.maker_org_id,
          assigned_at: order.assigned_at,
          created_at: order.created_at,
          model_code: order.quote.model_code,
          customer_name: order.quote.customer?.name ?? null,
          options,
          documents: order.documents,
          vehicle_info: (order as unknown as { vehicle_info?: unknown }).vehicle_info ?? null,
        },
      });
      return;
    }

    // ADMIN / SALES (+ is_master): 전체 응답 + options·documents
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        quote: { include: { customer: true } },
        maker_org: true,
        documents: { orderBy: { id: 'asc' } },
        options: { include: { value: { include: { group: { select: { code: true, name: true } } } } } },
      },
    });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }

    // options: order_option 우선, 비면 quote.selections 보강
    type AdminResolvedOpt = { id: number; group_code: string; group_name: string; value_code: string; value_name: string };
    let resolvedOptions: AdminResolvedOpt[] = [];
    if (order.options.length > 0) {
      resolvedOptions = order.options.map(o => ({
        id: o.id,
        group_code: o.group_code,
        group_name: o.value.group.name,
        value_code: o.value_code,
        value_name: o.value.name,
      }));
    } else {
      const selections = (order.quote.selections ?? {}) as Record<string, string>;
      const valueCodes = Object.values(selections).filter(Boolean);
      if (valueCodes.length > 0) {
        const values = await prisma.optionValue.findMany({
          where: { code: { in: valueCodes } },
          include: { group: { select: { code: true, name: true } } },
        });
        const vMap = new Map(values.map(v => [v.code, v]));
        resolvedOptions = Object.entries(selections)
          .filter(([, vCode]) => vMap.has(vCode))
          .map(([gCode, vCode], idx) => {
            const v = vMap.get(vCode)!;
            return { id: idx, group_code: gCode, group_name: v.group.name, value_code: vCode, value_name: v.name };
          });
      }
    }

    res.json({ data: { ...order, model_code: order.quote.model_code, customer_name: order.quote.customer?.name ?? null, options: resolvedOptions } });
  } catch (e) {
    console.error('[GET /orders/:id]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 조회 중 오류가 발생했습니다.' } });
  }
});

/*
 * ⚠️ 옛 `PATCH /orders/:id/status` 를 걷어냈다.
 *
 * 주문 진행은 이제 단계 표(`order_step`)가 갖는다 — 6단계 직선은 확정된 적도 없고
 * 차량·특장이 따로 도는 실제 흐름을 담지 못했다. 진행을 바꾸는 길은
 * `PATCH /orders/:id/steps/:code` 하나뿐이다(선행 단계·필수 증빙을 서버가 지킨다).
 * 두 길을 열어 두면 증빙 없이 상태만 올리는 우회로가 남는다.
 */

// ── PATCH /orders/:id/accept — 특장사 주문 수락 (배정→주문, 제작 착수) ──────
// 배정된 특장사가 주문을 수락하면 견적 상태 assigned→ordered. 이후 진행은 단계 표가 갖는다.

ordersRouter.patch('/:id/accept', rbac('ADMIN', 'MAKER'), requirePermission('order.control'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { quote: { select: { id: true, status: true } } } });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }
    if (ownOrgOnly(req.auth!) && order.maker_org_id !== req.auth!.org_code) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 수락할 수 있습니다' } });
      return;
    }
    if (order.quote.status !== 'assigned') {
      res.status(409).json({ error: { code: 'CONFLICT', message: `배정 상태에서만 수락할 수 있습니다 (현재 ${order.quote.status})` } });
      return;
    }

    /*
     * 납기일은 **수락과 같은 동작으로 받는다.**
     * 나중에 따로 입력하게 두면 납기 없는 주문이 생기고, 그 순간 「언제 오냐」를
     * 시스템이 답할 수 없게 된다. 한도(발주일로부터 15영업일)는 발주서 특이사항이고,
     * 화면과 서버가 **같은 함수**로 판정한다(shared/schedule) — 화면에서 고를 수 있는데
     * 서버가 거부하는 상황을 만들지 않기 위해서다.
     */
    const dueRaw = typeof (req.body as { delivery_due?: unknown })?.delivery_due === 'string'
      ? (req.body as { delivery_due: string }).delivery_due : '';
    const due = fromDateInput(dueRaw);
    if (!due) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '납기일(delivery_due)을 YYYY-MM-DD 로 보내야 합니다' } });
      return;
    }
    // 기산점은 **배정일**(= 발주일). 없으면 주문 생성일로 대신한다.
    const orderedAt = order.assigned_at ?? order.created_at;
    const check = checkDeliveryDue(due, orderedAt);
    if (!check.ok) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: check.reason } });
      return;
    }

    const now = new Date();
    await prisma.order.update({ where: { id }, data: { delivery_due: toDbDate(due), accepted_at: now } });
    await setQuoteStatus(order.quote.id, 'ordered', req.auth?.email ?? 'unknown');
    const updated = await prisma.quote.findUnique({ where: { id: order.quote.id } });
    res.json({ data: { quote: updated, delivery_due: toDateInput(due) } });
  } catch (e) {
    console.error('[PATCH /orders/:id/accept]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 수락 중 오류가 발생했습니다.' } });
  }
});

// ── GET /orders/:orderId/documents ────────────────────────────────────────

ordersRouter.get('/:orderId/documents', rbac('ADMIN', 'MAKER'), requirePermission('doc.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const orderId = Number(req.params['orderId']);
  if (isNaN(orderId)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }
  try {
    // MAKER: 자기 org 주문만
    if (ownOrgOnly(req.auth!)) {
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { maker_org_id: true } });
      if (!order || order.maker_org_id !== req.auth!.org_code) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
        return;
      }
    }
    const docs = await prisma.document.findMany({ where: { order_id: orderId }, orderBy: { id: 'asc' } });
    res.json({ data: docs });
  } catch (e) {
    console.error('[GET /orders/:orderId/documents]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '문서 조회 중 오류가 발생했습니다.' } });
  }
});
