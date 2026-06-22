import { Router } from 'express';
import { calcLoad } from '@buildup-ev/shared/load-calc';
import { rbac } from '../middleware/rbac.js';

type LoadCalcInput = Parameters<typeof calcLoad>[0];

export const loadCalcRouter = Router();

loadCalcRouter.post('/', rbac('SALES', 'ADMIN', 'MAKER'), (req, res): void => {
  const input = req.body as Partial<LoadCalcInput>;

  if (
    typeof input?.wheelbase_mm !== 'number' ||
    !input?.tire_front?.allowable_load_kg ||
    !input?.tire_rear?.allowable_load_kg
  ) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '필수 필드 누락: wheelbase_mm, tire_front, tire_rear' } });
    return;
  }

  const result = calcLoad(input as LoadCalcInput);
  res.json({ data: result });
});
