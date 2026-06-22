import { Router } from 'express';
import { rbac, orgScope } from '../middleware/rbac.js';

export const ordersRouter = Router();

// POST /orders — 주문 생성 (견적 확정 전환)
ordersRouter.post('/', rbac('SALES'), orgScope, (_req, res) => {
  // TODO: DB 연결
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});

// GET /orders/:id
ordersRouter.get('/:id', rbac('SALES', 'ADMIN', 'MAKER'), orgScope, (_req, res) => {
  // TODO: DB 연결 + orgScope 쿼리 필터 적용
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});

// PATCH /orders/:id/status — 관리자 상태 전이 게이트
ordersRouter.patch('/:id/status', rbac('ADMIN'), (_req, res) => {
  // TODO: DB 연결 — 허용 전이: 견적확정→관리자검증→제작착수→구조변경→튜닝신청→안전검사→튜닝승인→인도완료
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});

// GET /orders/:orderId/documents
ordersRouter.get('/:orderId/documents', rbac('ADMIN', 'MAKER'), orgScope, (_req, res) => {
  // TODO: DB 연결
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});
