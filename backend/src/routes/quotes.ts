import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';

export const quotesRouter = Router();

// POST /quotes/calculate — 견적 계산 (미저장, mock)
// TODO: DB 연결 — 옵션별 단가·보조금 파라미터 조회 후 실계산
// 회귀기준: 범석환 케이스(베이직·저상·내장·여닫이·추가X·온도계X·격벽X, 경기 남양주, 소상공인) = ₩46,471,818
quotesRouter.post('/calculate', rbac('SALES'), (_req, res) => {
  res.json({
    data: {
      supply_price: null,
      vat: null,
      vehicle_price: null,
      subsidy_national: null,
      subsidy_local: null,
      subsidy_sosang: null,
      subsidy_total: null,
      applied_price: null,
      vat_refunded_price: null,
      reg_cost: null,
      etc_cost: null,
      real_price: null, // 회귀기준: 46471818
      breakdown: {},
    },
  });
});

// POST /quotes — 견적 저장
quotesRouter.post('/', rbac('SALES'), (_req, res) => {
  // TODO: DB 연결
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});

// GET /quotes/:id
quotesRouter.get('/:id', rbac('SALES', 'ADMIN'), (_req, res) => {
  // TODO: DB 연결
  res.status(501).json({ error: { code: 'NOT_IMPLEMENTED', message: 'DB 연결 후 구현 예정' } });
});
