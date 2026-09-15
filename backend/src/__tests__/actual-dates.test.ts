import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * **실제 날짜** — 차량 도착 · 납기 · 고객 인도 칸(2026-09-14 지시).
 *   · 특장사가 차량 도착을 완료하면 그 날짜, 출고하면 출고일, 인도 완료면 실제 인도일
 *   · 되돌리면 실제 날짜가 비어 예정일(또는 미정)로 돌아간다
 *   · 목록·상세(관리자·특장사) 응답이 같은 값을 준다
 */
process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'true';
const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { businessDue } = await import('./due-helper.js');
const { readFileSync } = await import('node:fs');
const path = (await import('node:path')).default;

const app = createApp();
const live = !!prisma;
const ADMIN = 'actual-admin@example.invalid';
const MAKER = 'actual-maker@example.invalid';
const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const maker = authCookie(MAKER, 'MAKER', 'ORG_BRAIN');
let customerId = 0;
const quotes: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN']] as const) {
    await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '실제날짜시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
  }
  customerId = (await prisma.customer.create({ data: { name: '실제날짜_테스트고객' } })).id;
});
afterAll(async () => {
  if (!prisma) return;
  for (const id of quotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.notification.deleteMany({ where: { user_email: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

describe.runIf(live)('차량 도착 · 출고 실제 날짜', () => {
  it('🔴 완료하면 실제 날짜가 실리고, 되돌리면 비어 예정일로 돌아간다 — 목록·상세·특장사 상세 모두', async () => {
    const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', assign_requested_at: new Date(), customer_id: customerId, final_price: 1 }, select: { id: true } });
    quotes.push(q.id);
    expect((await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' })).status).toBe(200);
    const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
    expect((await request(app).patch(`/api/v1/orders/${o.id}/accept`).set('Cookie', maker).send({ delivery_due: await businessDue() })).status).toBe(200);

    const read = async () => {
      const list = await request(app).get('/api/v1/orders').set('Cookie', admin);
      const row = (list.body.data as { id: number; car_arrived_on?: string | null; shipped_on?: string | null }[]).find(x => x.id === o.id)!;
      const det = (await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', admin)).body.data;
      const mk = (await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', maker)).body.data;
      return {
        list: [row.car_arrived_on, row.shipped_on],
        admin: [det.car_arrived_on, det.shipped_on],
        maker: [mk.car_arrived_on, mk.shipped_on],
      };
    };
    const none = { list: [null, null], admin: [null, null], maker: [null, null] };
    expect(await read()).toEqual(none);

    // 한국 시각 9/11 새벽 완료 — UTC 로 자르면 9/10 이 된다
    await prisma!.orderStep.update({ where: { order_id_code: { order_id: o.id, code: 'car_arrived' } }, data: { status: 'done', done_at: new Date('2026-09-10T20:30:00Z') } });
    const arrived = ['2026-09-11', null];
    expect(await read()).toEqual({ list: arrived, admin: arrived, maker: arrived });

    // 되돌리기(실제 경로) — 실제 날짜가 사라진다
    const u = await request(app).patch(`/api/v1/orders/${o.id}/steps/car_arrived/undo`).set('Cookie', admin).send({});
    expect(u.status, JSON.stringify(u.body)).toBe(200);
    expect(await read()).toEqual(none);

    // 출고 — 출고할 때 적은 출고일
    await prisma!.orderStep.update({ where: { order_id_code: { order_id: o.id, code: 'delivered' } }, data: { status: 'done', done_at: new Date(), planned_at: new Date('2026-09-12T00:00:00Z') } });
    const shipped = [null, '2026-09-12'];
    expect(await read()).toEqual({ list: shipped, admin: shipped, maker: shipped });
  }, 60_000);
});

describe('되돌리면 실제 날짜가 지워진다(서버 규칙)', () => {
  it('🔴 단계 되돌리기는 done_at·출고일을, 인도 완료 되돌리기는 실제 인도일을 비운다', () => {
    const steps = readFileSync(path.resolve(__dirname, '../routes/steps.ts'), 'utf8');
    const undo = steps.slice(steps.indexOf("stepsRouter.patch('/:id/steps/:code/undo'"));
    expect(undo).toMatch(/status: 'pending',\s*done_at: null,/);
    expect(undo).toMatch(/planned_at: null,/);
    const addon = readFileSync(path.resolve(__dirname, '../routes/addon.ts'), 'utf8');
    expect(addon).toMatch(/if \(code === ADDON_LAST\) \{\s*await prisma\.orderAddon\.updateMany\(\{ where: \{ order_id: id \}, data: \{ customer_delivered_on: null \} \}\)/);
  });
});

describe('화면 — 예정 검정 · 완료 초록 · 늦은 완료 빨강', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  it('🔴 목록 카드와 상세 날짜 띠가 같은 규칙(shownDate)을 쓴다', () => {
    const board = src('frontend/src/components/OrderStepsBoard.tsx');
    expect(board).toMatch(/shownDate\(o\.car_arrival_planned_at, o\.car_arrived_on\)/);
    expect(board).toMatch(/shownDate\(o\.delivery_due, o\.shipped_on\)/);
    expect(board).toMatch(/shownDate\(o\.addon\.target_on, o\.addon\.finished \? o\.addon\.delivered_on : null\)/);
    expect(board).toMatch(/tone === 'done' \? s\.dateDone : tone === 'done_late' \? s\.dateDoneLate : tone === 'planned' \? s\.dateVal : s\.dateNone/);
    // 출고한 주문은 「납기 n일 경과」·지연을 띄우지 않는다
    expect(board).toMatch(/!shipped && o\.delivery_due && dueLabel\(due\)/);
    expect(board).toMatch(/\(!shipped && due\.state === 'overdue'\)/);
    const strip = src('frontend/src/components/DateStrip.tsx');
    expect(strip).toMatch(/const shown = shownDate\(c\.value, c\.actual\)/);
    expect(strip).toMatch(/shown\.tone === 'done' \? s\.valueDone/);
  });
  it('🔴 단계·부가작업을 바꾸면 상세의 날짜 띠가 다시 읽는다', () => {
    const det = src('frontend/src/components/OrderDetail.tsx');
    expect(det).toMatch(/<AddonStepsPanel orderId=\{detail\.id\} onChanged=\{refreshDates\} \/>/);
    expect(det).toMatch(/onChanged=\{refreshDates\}\s*\/>/);
    expect(det).toMatch(/refreshKey=\{datesKey\}/);
    const panel = src('frontend/src/components/OrderStepsPanel.tsx');
    expect(panel).toMatch(/await undoStep\(orderId, code\); load\(\); onChanged\?\.\(\)/);
  });
});
