import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';

export const modelsRouter = Router();

// GET /models — 차종 목록
modelsRouter.get('/', rbac('sales', 'admin'), (_req, res) => {
  // TODO: DB 연결
  res.json({
    data: [
      {
        model_id: 1,
        code: 'PV5_OPENBED',
        name: 'PV5 오픈베드',
        drive_type: '4x2',
        seats_default: 2,
        wheelbase_mm: 2995,
        curb_weight_kg: 1905,
        curb_axle_front_kg: 1105,
        curb_axle_rear_kg: 800,
        gvw_limit_kg: null,
        active: true,
      },
    ],
  });
});

// GET /models/:modelCode/options — 차종별 옵션그룹+값+규칙
modelsRouter.get('/:modelCode/options', rbac('sales', 'admin'), (req, res) => {
  // TODO: DB 연결 — option_group, option_value, option_rule 조회
  res.json({ data: [] });
});
