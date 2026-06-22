import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';

export const ordersRouter = Router();

// 주문 상태 진행 순서 (앞으로만 전이 가능)
const ORDER_STATUS_SEQ = [
  '제작착수', '구조변경', '튜닝신청', '안전검사', '튜닝승인', '인도완료',
] as const;
type OrderStatusStr = typeof ORDER_STATUS_SEQ[number];

// ── GET /orders — 목록 (ADMIN=전체, MAKER=자기 배정, SALES=자기 견적) ─────

ordersRouter.get('/', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const auth = req.auth!;
  const { status, from, to } = req.query as Record<string, string | undefined>;

  const where: Prisma.OrderWhereInput = {};
  if (auth.role === 'MAKER') {
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

ordersRouter.get('/:id', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res): Promise<void> => {
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
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        quote: { include: { customer: true } },
        maker_org: true,
      },
    });
    if (!order) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
      return;
    }
    res.json({ data: order });
  } catch (e) {
    console.error('[GET /orders/:id]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '주문 조회 중 오류가 발생했습니다.' } });
  }
});

// ── PATCH /orders/:id/status — 상태 전이 (ADMIN만, 앞으로만) ─────────────

ordersRouter.patch('/:id/status', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
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

    const currentIdx = ORDER_STATUS_SEQ.indexOf(order.status as OrderStatusStr);
    const newIdx     = ORDER_STATUS_SEQ.indexOf(status as OrderStatusStr);

    if (newIdx <= currentIdx) {
      res.status(409).json({
        error: { code: 'CONFLICT', message: `상태는 앞으로만 진행 가능 (현재: ${order.status})` },
      });
      return;
    }

    const updated = await prisma.order.update({ where: { id }, data: { status } });
    res.json({ data: updated });
  } catch (e) {
    console.error('[PATCH /orders/:id/status]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '상태 변경 중 오류가 발생했습니다.' } });
  }
});

// ── GET /orders/:orderId/documents ────────────────────────────────────────

ordersRouter.get('/:orderId/documents', rbac('ADMIN', 'MAKER'), async (req: Request, res): Promise<void> => {
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
    const docs = await prisma.document.findMany({ where: { order_id: orderId } });
    res.json({ data: docs });
  } catch (e) {
    console.error('[GET /orders/:orderId/documents]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '문서 조회 중 오류가 발생했습니다.' } });
  }
});
