/**
 * POST /api/v1/load-calc 통합 테스트
 *
 * API 엔드포인트가 shared/load-calc 코어와 동일한 결과를 반환하는지 검증.
 * 기준: shared/load-calc/core.test.ts 의 PV5 검증 케이스 (cyberts 실측값).
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { calcLoad } from '@buildup-ev/shared/load-calc';

const PV5_INPUT = {
  curb_axle_front_kg: 1105,
  curb_axle_rear_kg: 800,
  wheelbase_mm: 2995,
  tire_front: { allowable_load_kg: 1000, wheels: 2 },
  tire_rear: { allowable_load_kg: 1000, wheels: 2 },
  cargo: { weight_kg: 600, dist_to_rear_axle_mm: 35 },
  crew_items: [{ weight_kg: 130, dist_to_rear_axle_mm: 1500 }],
};

describe('POST /api/v1/load-calc — PV5 통합 테스트', () => {
  const app = createApp();

  it('shared/load-calc 코어 결과와 일치 (cyberts 검증값)', async () => {
    const expected = calcLoad(PV5_INPUT);

    const res = await request(app)
      .post('/api/v1/load-calc')
      .set('X-Role', 'sales')
      .send(PV5_INPUT)
      .expect(200);

    expect(res.body.data).toEqual(expected);
    // 핵심 수치 명시 검증
    expect(res.body.data.loaded.front_kg).toBe(1180);
    expect(res.body.data.loaded.rear_kg).toBe(1455);
    expect(res.body.data.gvw_kg).toBe(2635);
    expect(res.body.data.steering_axle_ratio_pct).toBe(44.8);
  });

  it('필수 필드 누락(wheelbase_mm 없음) → 400', async () => {
    const res = await request(app)
      .post('/api/v1/load-calc')
      .set('X-Role', 'sales')
      .send({
        curb_axle_front_kg: 1105,
        curb_axle_rear_kg: 800,
        tire_front: { allowable_load_kg: 1000, wheels: 2 },
        tire_rear: { allowable_load_kg: 1000, wheels: 2 },
      })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('X-Role 헤더 없음 → 403', async () => {
    await request(app).post('/api/v1/load-calc').send(PV5_INPUT).expect(403);
  });

  it('conversion 역할도 허용', async () => {
    await request(app)
      .post('/api/v1/load-calc')
      .set('X-Role', 'conversion')
      .send(PV5_INPUT)
      .expect(200);
  });
});
