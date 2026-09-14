import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **부가작업** — 특장사 공장 출고 뒤, 고객 인도까지 우리 쪽 작업(2026-09-14).
 *
 *   ① 공장 출고 전에는 못 한다 · 반드시 거친다(건너뛰기 없음)
 *   ② 작업 전(차량 도착) → 작업 중(배선/배관·외관·기타, 순서 무관) → 고객 인도(PDI → 차량 출발 → 인도 완료)
 *   ③ 인도 완료는 실제 인도일을 적는다(앞날 불가) · 이때 견적이 「완료」 — 특장사 출고 때가 아니다
 *   ④ 고객 인도 목표일은 배정 이후 언제든, 특장사에게는 보이지 않는다
 *   ⑤ 관리자 + 기능모듈 addon.manage 만
 */
process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'false';
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { businessDue } = await import('./due-helper.js');
const { STEPS } = await import('@buildup-ev/shared/process');
const { toDateInput } = await import('@buildup-ev/shared/schedule');

const app = createApp();
const live = !!prisma;
const ADMIN = 'addon-admin@example.invalid';
const NOPERM = 'addon-noperm@example.invalid';
const MAKER = 'addon-maker@example.invalid';
const USERS = [ADMIN, NOPERM, MAKER];
const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const noperm = authCookie(NOPERM, 'ADMIN', 'ORG_HQ');
const maker = authCookie(MAKER, 'MAKER', 'ORG_BRAIN');
let customerId = 0;
const quotes: number[] = [];
const today = () => toDateInput(new Date());

beforeAll(async () => {
  if (!prisma) return;
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [NOPERM, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN']] as const) {
    await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '부가작업시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
    for (const m of mods) {
      const enabled = !(email === NOPERM && m.code === 'addon.manage');
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
        update: { enabled }, create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled },
      });
    }
  }
  customerId = (await prisma.customer.create({ data: { name: '부가작업_테스트고객' } })).id;
});
afterAll(async () => {
  if (!prisma) return;
  for (const id of quotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderAddonStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderAddon.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.notification.deleteMany({ where: { user_email: { in: USERS } } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: USERS } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
  process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'true';
});

async function acceptedOrder() {
  const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 1 }, select: { id: true } });
  quotes.push(q.id);
  expect((await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' })).status).toBe(200);
  const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
  expect((await request(app).patch(`/api/v1/orders/${o.id}/accept`).set('Cookie', maker).send({ delivery_due: await businessDue() })).status).toBe(200);
  return { id: o.id, quoteId: q.id };
}
/** 특장사 단계를 전부 끝낸 상태로 만든다(공장 출고) — 증빙 절차는 다른 시험이 본다 */
async function factoryDone(id: number) {
  for (const s of STEPS) {
    await prisma!.orderStep.upsert({
      where: { order_id_code: { order_id: id, code: s.code } },
      update: { status: 'done', done_at: new Date() },
      create: { order_id: id, code: s.code, track: s.track, status: 'done', done_at: new Date() },
    });
  }
}
const step = (id: number, code: string, body: object = {}, cookie = admin) =>
  request(app).patch(`/api/v1/orders/${id}/addon/steps/${code}`).set('Cookie', cookie).send(body);
const undo = (id: number, code: string) => request(app).patch(`/api/v1/orders/${id}/addon/steps/${code}/undo`).set('Cookie', admin).send({});
const target = (id: number, date: string | null, cookie = admin) => request(app).patch(`/api/v1/orders/${id}/addon/target`).set('Cookie', cookie).send({ date });
const quoteStatus = async (qid: number) => (await prisma!.quote.findUniqueOrThrow({ where: { id: qid }, select: { status: true } })).status;

describe('견적 「완료」 시점', () => {
  it('🔴 특장사 출고(delivered) 완료로는 견적을 완료로 올리지 않는다 — 고객 인도 완료에서만', async () => {
    const { readFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const steps = readFileSync(path.resolve(__dirname, '../routes/steps.ts'), 'utf8');
    const complete = steps.slice(steps.indexOf("stepsRouter.patch('/:id/steps/:code',"), steps.indexOf("stepsRouter.patch('/:id/steps/:code/undo'"));
    expect(complete, '출고 완료에서 견적을 완료로 올린다').not.toMatch(/setQuoteStatus\([^)]*'completed'/);
    const addon = readFileSync(path.resolve(__dirname, '../routes/addon.ts'), 'utf8');
    expect(addon).toMatch(/if \(code === ADDON_LAST && day\) \{[^]*?setQuoteStatus\(o\.quote_id, 'completed'/);
  });
});

describe.runIf(live)('영업 성과의 「완료」는 지금 완료인 것만', () => {
  it('🔴 이력에 완료가 찍혔어도 되돌려 주문진행이면 완료로 세지 않는다 — 금액·도달·소요일 모두', async () => {
    const { salesStats } = await import('../services/sales-stats.js');
    const SALES = ADMIN;   // 담당 영업으로 쓸 실제 계정(이 파일이 만든다)
    const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'ordered', customer_id: customerId, final_price: 7_000_000, sales_user_id: SALES }, select: { id: true } });
    quotes.push(q.id);
    const at = (d: string) => new Date(`2026-09-${d}T00:00:00Z`);
    await prisma!.quoteChangeLog.createMany({ data: [
      { quote_id: q.id, section: 'status', field: 'status', old_value: 'assigned', new_value: 'ordered', changed_by: 'x', changed_at: at('10') },
      { quote_id: q.id, section: 'status', field: 'status', old_value: 'ordered', new_value: 'completed', changed_by: 'x', changed_at: at('11') },
      { quote_id: q.id, section: 'status', field: 'status', old_value: 'completed', new_value: 'ordered', changed_by: 'migration', changed_at: at('12') },
    ] });
    const [st] = await salesStats({ salesUser: SALES });
    expect(st!.reached.completed, '되돌린 건이 완료로 잡힌다').toBe(0);
    expect(st!.amount.completed).toBe(0);
    expect(st!.lead.to_completed.n).toBe(0);
    expect(st!.reached.ordered).toBeGreaterThanOrEqual(1);
  }, 30_000);
});

describe('옛 흐름 완료 되돌림(마이그레이션)', () => {
  it('🔴 출고는 끝났고 고객 인도 기록이 없는 완료 견적만 주문진행으로 — 지우지 않고 이력을 남긴다', async () => {
    const { readFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const sql = readFileSync(path.resolve(__dirname, '../../prisma/migrations/20260914060000_revert_completed_before_handover/migration.sql'), 'utf8');
    expect(sql).not.toMatch(/DELETE/i);
    expect(sql).toMatch(/INSERT INTO "quote_change_log"/);
    expect(sql.indexOf('INSERT INTO "quote_change_log"')).toBeLessThan(sql.indexOf('UPDATE "quote"'));
    for (const cond of [/s\."code" = 'delivered' AND s\."status" = 'done'/, /NOT EXISTS \(SELECT 1 FROM "order_addon_step" a WHERE a\."order_id" = o\."id" AND a\."code" = 'addon_delivered'/]) {
      expect(sql.match(new RegExp(cond.source, 'g'))?.length, String(cond)).toBe(2);   // 이력·갱신 두 곳 조건이 같다
    }
  });
});

describe.runIf(live)('부가작업', () => {
  it('🔴 공장 출고 전에는 부가작업을 못 한다', async () => {
    const { id } = await acceptedOrder();
    const r = await step(id, 'addon_car_arrived');
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/출고 전/);
  }, 30_000);

  it('🔴 고객 인도 목표일은 배정 이후 언제든 — 특장사 응답 어디에도 없다', async () => {
    const { id } = await acceptedOrder();
    const r = await target(id, '2031-03-15');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.target_on).toBe('2031-03-15');
    // 특장사 — 상세·목록·단계 어디에도 목표일·부가작업이 실리지 않는다
    for (const path of [`/api/v1/orders/${id}`, '/api/v1/orders', `/api/v1/orders/${id}/steps`]) {
      const res = await request(app).get(path).set('Cookie', maker);
      expect(res.status, path).toBe(200);
      expect(JSON.stringify(res.body), `${path} 에 부가작업이 샌다`).not.toMatch(/2031-03-15|customer_target|addon/);
    }
    // 특장사는 부가작업 경로 자체를 못 쓴다
    expect((await request(app).get(`/api/v1/orders/${id}/addon`).set('Cookie', maker)).status).toBe(403);
    expect((await target(id, '2031-04-01', maker)).status).toBe(403);
    // 비우면 지운다
    expect((await target(id, '')).body.data.target_on).toBeNull();
  }, 30_000);

  it('🔴 순서 — 차량 도착 → 작업 셋(순서 무관) → PDI → 차량 출발 → 인도 완료', async () => {
    const { id, quoteId } = await acceptedOrder();
    await factoryDone(id);
    // 특장사 출고로는 견적이 완료가 되지 않는다
    expect(await quoteStatus(quoteId)).not.toBe('completed');

    expect((await step(id, 'addon_exterior')).status, '차량 도착 전 작업').toBe(409);
    expect((await step(id, 'addon_car_arrived')).status).toBe(200);
    expect((await step(id, 'addon_etc')).status).toBe(200);          // 순서 상관없음
    expect((await step(id, 'addon_pdi')).status, '작업이 다 안 끝났는데 PDI').toBe(409);
    expect((await step(id, 'addon_wiring')).status).toBe(200);
    expect((await step(id, 'addon_exterior')).status).toBe(200);
    expect((await step(id, 'addon_departed')).status, 'PDI 전 출발').toBe(409);
    expect((await step(id, 'addon_pdi')).status).toBe(200);
    expect((await step(id, 'addon_departed')).status).toBe(200);

    // 인도 완료 — 실제 인도일 필수, 앞날 불가
    expect((await step(id, 'addon_delivered')).status).toBe(400);
    expect((await step(id, 'addon_delivered', { date: '2099-01-01' })).status).toBe(400);
    const d = await step(id, 'addon_delivered', { date: today() });
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.data.delivered_on).toBe(today());
    expect(d.body.data.finished).toBe(true);
    expect(await quoteStatus(quoteId), '고객 인도가 끝났는데 견적이 완료가 아니다').toBe('completed');

    // 관리자 목록에 요약이 실린다
    const list = await request(app).get('/api/v1/orders').set('Cookie', admin);
    const row = (list.body.data as { id: number; addon?: { finished: boolean; delivered_on: string } }[]).find(x => x.id === id)!;
    expect(row.addon?.finished).toBe(true);
    expect(row.addon?.delivered_on).toBe(today());
  }, 60_000);

  it('🔴 되돌리기 — 뒤 단계가 끝났으면 막고, 인도 완료를 되돌리면 견적도 되돌린다', async () => {
    const { id, quoteId } = await acceptedOrder();
    await factoryDone(id);
    for (const c of ['addon_car_arrived', 'addon_wiring', 'addon_exterior', 'addon_etc', 'addon_pdi', 'addon_departed']) {
      expect((await step(id, c)).status, c).toBe(200);
    }
    expect((await step(id, 'addon_delivered', { date: today() })).status).toBe(200);
    expect((await undo(id, 'addon_car_arrived')).status, '뒤가 끝났는데 차량 도착을 되돌렸다').toBe(409);
    const u = await undo(id, 'addon_delivered');
    expect(u.status).toBe(200);
    expect(u.body.data.delivered_on).toBeNull();
    expect(await quoteStatus(quoteId)).not.toBe('completed');
    // 지우지 않는다 — 행은 남고 pending
    const row = await prisma!.orderAddonStep.findFirstOrThrow({ where: { order_id: id, code: 'addon_delivered' } });
    expect(row.status).toBe('pending');
    // 다시 끝낼 수 있다
    expect((await step(id, 'addon_delivered', { date: today() })).status).toBe(200);
  }, 60_000);

  it('🔴 부가작업이 시작되면 특장사가 출고를 되돌릴 수 없다', async () => {
    const { id } = await acceptedOrder();
    await factoryDone(id);
    expect((await step(id, 'addon_car_arrived')).status).toBe(200);
    const r = await request(app).patch(`/api/v1/orders/${id}/steps/delivered/undo`).set('Cookie', maker).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/부가작업/);
  }, 30_000);

  it('🔴 동시에 여러 번 눌러도 한 번만 끝난다', async () => {
    const { id } = await acceptedOrder();
    await factoryDone(id);
    const rs = await Promise.all(Array.from({ length: 6 }, () => step(id, 'addon_car_arrived')));
    expect(rs.filter(r => r.status === 200).length).toBe(1);
    expect(rs.filter(r => r.status === 500).length).toBe(0);
    expect(await prisma!.orderAddonStep.count({ where: { order_id: id, code: 'addon_car_arrived' } })).toBe(1);
  }, 30_000);

  it('🔴 권한 — addon.manage 없는 관리자는 못 쓰고, 목록에도 부가작업이 실리지 않는다', async () => {
    const { id } = await acceptedOrder();
    expect((await request(app).get(`/api/v1/orders/${id}/addon`).set('Cookie', noperm)).status).toBe(403);
    expect((await target(id, '2031-01-01', noperm)).status).toBe(403);
    const list = await request(app).get('/api/v1/orders').set('Cookie', noperm);
    expect(JSON.stringify(list.body)).not.toMatch(/"addon"/);
  }, 30_000);
});
