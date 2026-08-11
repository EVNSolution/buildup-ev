import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { setQuoteStatus } from '../services/quote-status.js';
import type { Prisma } from '@prisma/client';

export const ordersRouter = Router();

// 주문 상태 진행 순서 (앞으로만 전이 가능)
const ORDER_STATUS_SEQ = [
  '제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료',
] as const;
type OrderStatusStr = typeof ORDER_STATUS_SEQ[number];

// ── GET /orders — 목록 (ADMIN=전체, MAKER=자기 배정, SALES=자기 견적) ─────

ordersRouter.get('/', rbac('ADMIN', 'SALES', 'MAKER'), requirePermission('order.view'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const auth = req.auth!;
  const { status, from, to } = req.query as Record<string, string | undefined>;

  const where: Prisma.OrderWhereInput = {};
  if (auth.role === 'MAKER' && !auth.is_master) {
    where.maker_org_id = auth.org_code;
  } else if (auth.role === 'SALES') {
    where.quote = { sales_user_id: auth.email };
  }
  if (status) where.status = status;
  if (from || to) {
    where.created_at = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  try {
    const orders = await prisma.order.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        quote: {
          select: {
            model_code: true, supply_price: true, final_price: true,
            status: true, customer_id: true,
            customer: { select: { id: true, name: true } },
          },
        },
        maker_org: { select: { code: true, name: true } },
      },
    });
    res.json({ data: orders });
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

    if (auth.role === 'MAKER') {
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
          status: order.status,
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

// ── PATCH /orders/:id/status — 상태 전이 (ADMIN=전체, MAKER=자기 org, 양방향) ─

ordersRouter.patch('/:id/status', rbac('ADMIN', 'MAKER'), requirePermission('order.control'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const id = Number(req.params['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return;
  }

  const { status } = req.body as { status?: string };
  if (!status || !ORDER_STATUS_SEQ.includes(status as OrderStatusStr)) {
    res.status(400).json({
      error: { code: 'BAD_INPUT', message: `status는 [${ORDER_STATUS_SEQ.join(', ')}] 중 하나` },
    });
    return;
  }

  try {
    const order = await prisma.order.findUnique({ where: { id } });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }

    // MAKER는 자기 org 주문만 변경 가능
    if (req.auth!.role === 'MAKER' && order.maker_org_id !== req.auth!.org_code) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 변경할 수 있습니다' } });
      return;
    }

    const updated = await prisma.order.update({ where: { id }, data: { status } });

    // 특장사가 마지막 공정(인도완료)을 찍으면 견적 단계도 '완료' 로 올린다.
    // 되돌리는 전이(인도완료 → 이전 단계)면 주문진행으로 되돌린다 — 양방향 전이를 허용하므로.
    const LAST = ORDER_STATUS_SEQ[ORDER_STATUS_SEQ.length - 1];
    const order2 = await prisma.order.findUnique({ where: { id }, select: { quote_id: true } });
    if (order2) {
      const want = status === LAST ? 'completed' : 'ordered';
      const q = await prisma.quote.findUnique({ where: { id: order2.quote_id }, select: { status: true } });
      if (q && ['ordered', 'completed'].includes(q.status) && q.status !== want) {
        await setQuoteStatus(order2.quote_id, want, req.auth?.email ?? 'unknown');
        console.info(`[orders] 주문 ${id} ${status} → 견적 ${order2.quote_id} 단계 ${q.status} → ${want}`);
      }
    }
    res.json({ data: updated });
  } catch (e) {
    console.error('[PATCH /orders/:id/status]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '상태 변경 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /orders/:id/accept — 특장사 주문 수락 (배정→주문, 제작 착수) ──────
// 배정된 특장사가 주문을 수락하면 견적 상태 assigned→ordered. 주문 현황은 제작착수부터.

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
    if (req.auth!.role === 'MAKER' && order.maker_org_id !== req.auth!.org_code) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 수락할 수 있습니다' } });
      return;
    }
    if (order.quote.status !== 'assigned') {
      res.status(409).json({ error: { code: 'CONFLICT', message: `배정 상태에서만 수락할 수 있습니다 (현재 ${order.quote.status})` } });
      return;
    }
    await setQuoteStatus(order.quote.id, 'ordered', req.auth?.email ?? 'unknown');
    const updated = await prisma.quote.findUnique({ where: { id: order.quote.id } });
    res.json({ data: { quote: updated } });
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
    if (req.auth!.role === 'MAKER') {
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
