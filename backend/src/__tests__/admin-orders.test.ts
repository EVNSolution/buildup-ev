/**
 * 관리자 관제 통합 테스트 (DB 필요 — DATABASE_URL 없으면 skip)
 *
 * GET  /quotes          — 역할 스코프 조회
 * PATCH /quotes/:id/confirm — 확정(영업, draft→confirmed)
 * PATCH /quotes/:id/assign  — 제작 배정(관리자, contracted→assigned + 주문 생성)
 * GET  /orders          — 역할 스코프 조회
 * PATCH /orders/:id/status — 상태 전이
 * GET  /orgs?type=MAKER — 특장사 목록
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { authCookie, authFixtureReady, ensureFixtureUsers } from './helpers.js';

const shouldSkip = !process.env['DATABASE_URL'];
/* seed 계정이 없으면 로그인부터 막혀 beforeAll 이 통째로 실패한다 — 준비의 문제다 */
const AUTH_OK = await authFixtureReady('sales1@evnsolution.com', 'admin@evnsolution.com');

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

describe.skipIf(shouldSkip || !AUTH_OK)('관리자 관제 — 확정·배정·주문·조회', () => {
  const app = createApp();
  let quoteId: number;
  let orderId: number;

  // ── 사전 데이터: draft 견적 생성 ────────────────────────────────────────
  beforeAll(async () => {
    /*
     * 계정부터 마련한다. `user.csv` 는 비어 있어(실계정 비커밋) 시드로는 생기지 않는데,
     * 인증 우회로 로그인은 통과해도 **소유권 검사는 행이 없으면 막힌다** —
     * 영업이 만든 견적의 `sales_user_id` 가 붙지 않아 「자기 견적」이 되지 못했다.
     */
    await ensureFixtureUsers(
      { email: ADMIN, role: 'ADMIN', org_code: 'ORG_HQ' },
      { email: SALES, role: 'SALES', org_code: 'ORG_HQ' },
      { email: MAKER, role: 'MAKER', org_code: MAKER_ORG },
    );

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

  /*
   * ⚠️ 「확정하면서 특장사까지 배정된다」를 검사하던 3개를 **지금 설계에 맞게 고쳐 썼다.**
   *
   *    예전엔 `confirm` 하나가 확정·배정·주문생성을 한꺼번에 했다. 지금은 갈라져 있다 —
   *      · `confirm` = **영업**의 견적 확정(draft→confirmed). 특장사를 받지 않는다.
   *      · `assign`  = **관리자**의 제작 배정. **계약완료(전자서명 끝)** 에서만 열리고,
   *                    이때 비로소 주문이 생긴다.
   *    서명 전 선배정을 허용하면 계약이 깨졌을 때 이미 특장사가 제작에 들어가 있을 수 있다.
   *
   *    그래서 옛 검사는 통과할 수 없는 것이 됐다(확정에 maker_org_id 를 안 줘도 200 이다).
   *    지우지 않고 **갈라진 그 경계를 지키도록** 바꾼다 — 이 경계가 무너지면
   *    서명 전에 배정되는 길이 다시 열린다.
   */

  it('SALES — 확정은 영업의 일이다', async () => {
    // 확정(= 견적서 생성)은 영업의 업무다(CLAUDE.md 주문흐름). 관리자의 관문은 다음 단계인 배정이다.
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/confirm`)
      .set('Cookie', SALES_COOKIE)
      .send({})
      .expect(200);
    expect(res.body.data.quote.status).toBe('confirmed');
  });

  it('🔴 확정은 특장사를 배정하지 않는다 — 주문도 생기지 않는다', async () => {
    /*
     * 확정과 배정이 다시 붙으면 **서명 전에 특장사가 제작에 들어갈 수 있다.**
     * maker_org_id 를 보내도 무시돼야 하고, 주문은 없어야 한다.
     */
    const { prisma } = await import('../lib/prisma.js');
    const orders = await prisma!.order.count({ where: { quote_id: quoteId } });
    expect(orders, '확정만 했는데 주문이 생겼다').toBe(0);
  });

  it('🔴 확정만으로는 배정할 수 없다 — 계약완료여야 열린다', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
      .set('Cookie', ADMIN_COOKIE)
      .send({ maker_org_id: MAKER_ORG })
      .expect(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('배정 — 특장사가 없으면 400', async () => {
    const { prisma } = await import('../lib/prisma.js');
    // 전자서명까지 끝난 상태로 옮긴다 — 배정은 여기서만 열린다
    await prisma!.quote.update({ where: { id: quoteId }, data: { status: 'contracted' } });

    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
      .set('Cookie', ADMIN_COOKIE)
      .send({})
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('배정 — 특장사가 아닌 org → 400', async () => {
    // 본사(ORG_HQ)에 제작을 맡길 수는 없다
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
      .set('Cookie', ADMIN_COOKIE)
      .send({ maker_org_id: 'ORG_HQ' })
      .expect(400);
    expect(res.body.error.code).toBe('BAD_INPUT');
  });

  it('SALES — 배정 권한 없음 → 403', async () => {
    // 배정이 관리자의 관문이다 — 영업이 스스로 특장사를 정하지 못한다
    await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
      .set('Cookie', SALES_COOKIE)
      .send({ maker_org_id: MAKER_ORG })
      .expect(403);
  });

  it('배정 성공 — quote.assigned + order 생성 + maker_org 배정', async () => {
    /*
     * 계약 단가가 없는 옵션은 발주서에 **금액만 빈 칸으로** 뜨고, 비어 있으면 배정이 막힌다.
     * 여기서 볼 것은 그게 아니라 배정 자체라, 미리보기에서 받은 그 줄들에 금액을 채워 보낸다.
     */
    const prev = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`)
      .set('Cookie', ADMIN_COOKIE);
    const auto = (prev.body.data.po_lines as { source: string; qty: number }[])
      .filter(l => l.source === 'AUTO')
      .map(l => ({ ...l, unit_price: 100_000, amount: 100_000 * l.qty }));

    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
      .set('Cookie', ADMIN_COOKIE)
      .send({ maker_org_id: MAKER_ORG, po_lines: auto })
      .expect(200);

    const { quote, order } = res.body.data;
    expect(quote.status).toBe('assigned');
    expect(order.quote_id).toBe(quoteId);
    expect(order.maker_org_id).toBe(MAKER_ORG);
    // 배정된 시각이 곧 발주일 — 납기 한도의 기산점이다
    expect(order.assigned_at).toBeTruthy();
    orderId = order.id;
  });

  it('이미 배정된 견적 → 재배정 409', async () => {
    const res = await request(app)
      .patch(`/api/v1/quotes/${quoteId}/assign`)
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
