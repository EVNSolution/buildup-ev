/**
 * 관리자 관제 통합 테스트 (DB 필요 — DATABASE_URL 없으면 skip)
 *
 * GET  /quotes          — 역할 스코프 조회
 * PATCH /quotes/:id/confirm — 확정 + 특장사 배정 + 주문 생성
 * GET  /orders          — 역할 스코프 조회
 * PATCH /orders/:id/status — 상태 전이
 * GET  /orgs?type=MAKER — 특장사 목록
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

const shouldSkip = !process.env['DATABASE_URL'];

const ADMIN  = 'admin@evnsolution.com';
const SALES  = 'sales1@evnsolution.com';
const MAKER  = 'maker1@partner.com';
const MAKER_ORG = 'ORG_MAKER1';

const REEFER_SELECTIONS = {
  TRIM: 'TRIM_PLUS', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW',
  DOORTYPE: 'DOOR_SLIDE', DOORADD: 'ADD_NONE', TEMP: 'TEMP_O', PARTITION: 'PART_NET',
};
const CUSTOMER = { name: '홍길동', biz_type: 'individual', is_sosang: true, region: '경기 남양주시' };

describe.skipIf(shouldSkip)('관리자 관제 — 확정·배정·주문·조회', () => {
  const app = createApp();
  let quoteId: number;
  let orderId: number;

  // ── 사전 데이터: draft 견적 생성 ────────────────────────────────────────
  beforeAll(async () => {
    const res = await request(app)
      .post('/api/v1/quotes')
      .set('X-User', SALES)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: REEFER_SELECTIONS, customer: CUSTOMER });
    expect(res.status).toBe(201);
    quoteId = res.body.data.quote_id;
  }, 20_000);

  // ── GET /quotes — 역할 스코프 ────────────────────────────────────────────

  it('ADMIN — 전체 견적 조회', async () => {
    const res = await request(app)
      .get('/api/v1/quotes')
      .set('X-User', ADMIN)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('SALES — 자기 견적만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/quotes')
      .set('X-User', SALES)
      .expect(200);
    const quotes = res.body.data as { sales_user_id: string | null }[];
    expect(quotes.every(q => q.sales_user_id === SALES || q.sales_user_id === null)).toBe(true);
  });

  it('MAKER — 견적 조회 권한 없음 → 403', async () => {
    await request(app).get('/api/v1/quotes').set('X-User', MAKER).expect(403);
  });

  // ── PATCH /quotes/:id/confirm ────────────────────────────────────────────

  it('ADMIN 확정 — maker_org_id 없으면 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('X-User', ADMIN)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('ADMIN 확정 — 유효하지 않은 org → 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('X-User', ADMIN)
      .send({ maker_org_id: 'ORG_HQ' })  // HQ is not MAKER type
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('SALES — 확정 권한 없음 → 403', async () => {
    await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('X-User', SALES)
      .send({ maker_org_id: MAKER_ORG })
      .expect(403);
  });

  it('ADMIN 확정 성공 — quote.confirmed + order 생성 + maker_org 배정', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('X-User', ADMIN)
      .send({ maker_org_id: MAKER_ORG })
      .expect(200);

    const { quote, order } = res.body.data;
    expect(quote.status).toBe('confirmed');
    expect(order.quote_id).toBe(quoteId);
    expect(order.maker_org_id).toBe(MAKER_ORG);
    expect(order.status).toBe('제작착수');
    orderId = order.id;
  });

  it('이미 confirmed → 재확정 409', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('X-User', ADMIN)
      .send({ maker_org_id: MAKER_ORG })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  // ── GET /orders — 역할 스코프 ────────────────────────────────────────────

  it('ADMIN — 전체 주문 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('X-User', ADMIN)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('MAKER — 자기 org 배정 주문만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('X-User', MAKER)
      .expect(200);
    const orders = res.body.data as { maker_org_id: string }[];
    expect(orders.every(o => o.maker_org_id === MAKER_ORG)).toBe(true);
    expect(orders.length).toBeGreaterThanOrEqual(1);
  });

  it('SALES — 자기 견적에서 파생된 주문만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('X-User', SALES)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ── PATCH /orders/:id/status — 상태 전이 ────────────────────────────────

  it('ADMIN 상태 전이 — 제작착수 → 구조변경 성공', async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('X-User', ADMIN)
      .send({ status: '구조변경' })
      .expect(200);
    expect(res.body.data.status).toBe('구조변경');
  });

  it('상태 후진 → 409', async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('X-User', ADMIN)
      .send({ status: '제작착수' })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('잘못된 status → 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('X-User', ADMIN)
      .send({ status: '없는상태' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('MAKER — 상태 전이 권한 없음 → 403', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('X-User', MAKER)
      .send({ status: '튜닝신청' })
      .expect(403);
  });

  // ── GET /orgs?type=MAKER ─────────────────────────────────────────────────

  it('ADMIN — MAKER 타입 org 목록', async () => {
    const res = await request(app)
      .get('/api/v1/orgs?type=MAKER')
      .set('X-User', ADMIN)
      .expect(200);
    const orgs = res.body.data as { type: string; code: string }[];
    expect(orgs.every(o => o.type === 'MAKER')).toBe(true);
    expect(orgs.some(o => o.code === MAKER_ORG)).toBe(true);
  });

  it('SALES — org 조회 권한 없음 → 403', async () => {
    await request(app).get('/api/v1/orgs').set('X-User', SALES).expect(403);
  });
});
