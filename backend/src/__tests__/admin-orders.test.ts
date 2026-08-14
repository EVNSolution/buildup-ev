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
import { authCookie } from './helpers.js';

const shouldSkip = !process.env['DATABASE_URL'];

const ADMIN     = 'admin@evnsolution.com';
const SALES     = 'sales1@evnsolution.com';
const MAKER     = 'maker1@partner.com';
const MAKER_ORG = 'ORG_BRAIN';

const ADMIN_COOKIE = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const SALES_COOKIE = authCookie(SALES, 'SALES', 'ORG_HQ');
const MAKER_COOKIE = authCookie(MAKER, 'MAKER', MAKER_ORG);

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
      .set('Cookie', SALES_COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: REEFER_SELECTIONS, customer: CUSTOMER });
    expect(res.status).toBe(201);
    quoteId = res.body.data.quote_id;
  }, 20_000);

  // ── GET /quotes — 역할 스코프 ────────────────────────────────────────────

  it('ADMIN — 전체 견적 조회', async () => {
    const res = await request(app)
      .get('/api/v1/quotes')
      .set('Cookie', ADMIN_COOKIE)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('SALES — 자기 견적만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/quotes')
      .set('Cookie', SALES_COOKIE)
      .expect(200);
    const quotes = res.body.data as { sales_user_id: string | null }[];
    expect(quotes.every(q => q.sales_user_id === SALES || q.sales_user_id === null)).toBe(true);
  });

  it('MAKER — 견적 조회 권한 없음 → 403', async () => {
    await request(app).get('/api/v1/quotes').set('Cookie', MAKER_COOKIE).expect(403);
  });

  // ── PATCH /quotes/:id/confirm ────────────────────────────────────────────

  it('ADMIN 확정 — maker_org_id 없으면 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('Cookie', ADMIN_COOKIE)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('ADMIN 확정 — 유효하지 않은 org → 400', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('Cookie', ADMIN_COOKIE)
      .send({ maker_org_id: 'ORG_HQ' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('SALES — 확정 권한 없음 → 403', async () => {
    await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('Cookie', SALES_COOKIE)
      .send({ maker_org_id: MAKER_ORG })
      .expect(403);
  });

  it('ADMIN 확정 성공 — quote.confirmed + order 생성 + maker_org 배정', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('Cookie', ADMIN_COOKIE)
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
      .set('Cookie', ADMIN_COOKIE)
      .send({ maker_org_id: MAKER_ORG })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  // ── GET /orders — 역할 스코프 ────────────────────────────────────────────

  it('ADMIN — 전체 주문 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Cookie', ADMIN_COOKIE)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('MAKER — 자기 org 배정 주문만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Cookie', MAKER_COOKIE)
      .expect(200);
    const orders = res.body.data as { maker_org_id: string }[];
    expect(orders.every(o => o.maker_org_id === MAKER_ORG)).toBe(true);
    expect(orders.length).toBeGreaterThanOrEqual(1);
  });

  it('SALES — 자기 견적에서 파생된 주문만 조회', async () => {
    const res = await request(app)
      .get('/api/v1/orders')
      .set('Cookie', SALES_COOKIE)
      .expect(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  /*
   * ⚠️ 옛 `PATCH /orders/:id/status` 를 검사하던 4개를 걷어냈다.
   *    그 라우트를 없앴기 때문이다 — 진행은 이제 `PATCH /orders/:id/steps/:code` 가 갖고,
   *    선행 단계·필수 증빙을 서버가 지킨다(단계 규칙 자체는 shared/process 에서 테스트한다).
   *    사라진 기능을 검사하는 테스트를 남겨 두면 실패가 일상이 되어 진짜 실패를 못 알아본다.
   */

  it('옛 상태 전이 라우트는 더 이상 없다', async () => {
    await request(app)
      .patch(`/api/v1/orders/${orderId}/status`)
      .set('Cookie', ADMIN_COOKIE)
      .send({ status: '구조변경' })
      .expect(404);
  });

  // ── GET /orgs?type=MAKER ─────────────────────────────────────────────────

  it('ADMIN — MAKER 타입 org 목록', async () => {
    const res = await request(app)
      .get('/api/v1/orgs?type=MAKER')
      .set('Cookie', ADMIN_COOKIE)
      .expect(200);
    const orgs = res.body.data as { type: string; code: string }[];
    expect(orgs.every(o => o.type === 'MAKER')).toBe(true);
    expect(orgs.some(o => o.code === MAKER_ORG)).toBe(true);
  });

  it('SALES — org 조회 권한 없음 → 403', async () => {
    await request(app).get('/api/v1/orgs').set('Cookie', SALES_COOKIE).expect(403);
  });
});
