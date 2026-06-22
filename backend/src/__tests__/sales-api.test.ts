/**
 * 영업 백엔드 신규 API 통합 테스트 (DB 필요 — DATABASE_URL 없으면 skip)
 *
 * GET  /models/:code/pricing-bundle
 * GET  /subsidy/local?region=…
 * POST /quotes  (재계산+저장)
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { authCookie } from './helpers.js';

const shouldSkip = !process.env['DATABASE_URL'];
const SALES_COOKIE = authCookie('sales1@evnsolution.com', 'SALES', 'ORG_SALES1');

const REEFER_SELECTIONS = {
  TRIM: 'TRIM_PLUS',
  BODYTYPE: 'BODY_REEFER',
  TOP: 'TOP_LOW',
  DOORTYPE: 'DOOR_SLIDE',
  DOORADD: 'ADD_NONE',
  TEMP: 'TEMP_O',
  PARTITION: 'PART_NET',
};
const CUSTOMER = { biz_type: 'individual', is_sosang: true, region: '경기 남양주시' };

describe.skipIf(shouldSkip)('GET /api/v1/models/:code/pricing-bundle', () => {
  const app = createApp();

  it('PV5_OPENBED — groups·rules·option_prices·door·tax·subsidy_national 포함', async () => {
    const res = await request(app)
      .get('/api/v1/models/PV5_OPENBED/pricing-bundle')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    const { data } = res.body;
    expect(Array.isArray(data.groups)).toBe(true);
    expect(data.groups.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(data.rules)).toBe(true);
    expect(data.rules.length).toBeGreaterThanOrEqual(2);
    expect(typeof data.option_prices['TRIM_PLUS']).toBe('number');
    expect(data.option_prices['TRIM_PLUS']).toBe(45_136_364);
    expect(Array.isArray(data.door_unit_prices)).toBe(true);
    expect(data.door_unit_prices.length).toBe(4);
    expect(typeof data.tax.acq_tax_rate).toBe('number');
    expect(data.subsidy_national.amount).toBe(11_500_000);
    expect(Number(data.subsidy_national.sosang_rate)).toBeCloseTo(0.3);
  });

  it('존재하지 않는 차종 → 404', async () => {
    await request(app)
      .get('/api/v1/models/UNKNOWN/pricing-bundle')
      .set('Cookie', SALES_COOKIE)
      .expect(404);
  });

  it('인증 없음 → 403', async () => {
    await request(app).get('/api/v1/models/PV5_OPENBED/pricing-bundle').expect(403);
  });
});

describe.skipIf(shouldSkip)('GET /api/v1/subsidy/local', () => {
  const app = createApp();

  it('경기 남양주시 2026 → amount=3450000', async () => {
    const res = await request(app)
      .get('/api/v1/subsidy/local?region=경기 남양주시&year=2026')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    expect(res.body.data.amount).toBe(3_450_000);
    expect(res.body.data.region).toBe('경기 남양주시');
  });

  it('없는 지역 → data: null', async () => {
    const res = await request(app)
      .get('/api/v1/subsidy/local?region=없는지역시')
      .set('Cookie', SALES_COOKIE)
      .expect(200);

    expect(res.body.data).toBeNull();
  });

  it('region 없음 → 400', async () => {
    await request(app)
      .get('/api/v1/subsidy/local')
      .set('Cookie', SALES_COOKIE)
      .expect(400);
  });
});

describe.skipIf(shouldSkip)('POST /api/v1/quotes', () => {
  const app = createApp();

  it('냉동 옵션 → 201 + quote_id + real_price=46471818(±1)', { timeout: 15_000 }, async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: REEFER_SELECTIONS, customer: CUSTOMER })
      .expect(201);

    expect(res.body.data.quote_id).toBeGreaterThan(0);
    expect(Math.abs(res.body.data.pricing.real_price - 46_471_818)).toBeLessThanOrEqual(1);
    expect(res.body.data.pricing.status).toBe('ok');
  });

  it('BODY_DRY → 422 unsupported (저장 거부)', async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({
        model_code: 'PV5_OPENBED',
        selections: { ...REEFER_SELECTIONS, BODYTYPE: 'BODY_DRY' },
        customer: CUSTOMER,
      })
      .expect(422);

    expect(res.body.error.code).toBe('UNSUPPORTED');
    expect(res.body.error.message).toMatch(/TBD/);
  });

  it('필수 파라미터 누락 → 400', async () => {
    await request(app)
      .post('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .send({ model_code: 'PV5_OPENBED' })
      .expect(400);
  });

  it('인증 없음 → 403', async () => {
    await request(app).post('/api/v1/quotes').send({}).expect(403);
  });
});
