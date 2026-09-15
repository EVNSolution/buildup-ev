import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **배정 요청** — 2026-09-15 지시.
 *   ① 서명(전자서명·서명본 등록)이 끝나도 곧장 제작 배정이 열리지 않는다 — 영업이 「배정 요청」을 눌러야 한다
 *   ② 요청은 담당 영업이 영업 화면에서(남의 견적은 못 한다) · 한 번만
 *   ③ 배정 거부·주문 삭제로 돌아온 건은 요청을 다시 누르지 않아도 바로 재배정된다(이 기능 전의 옛 주문도)
 *   ④ 이미 배정 대기 중이던 건(요청 기록 없음)은 요청해야 넘어간다 — 새 칸은 비어서 시작한다
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { readFileSync } = await import('node:fs');
const path = (await import('node:path')).default;

const app = createApp();
const live = !!prisma;
const ADMIN = 'areq-admin@example.invalid';
const SALES = 'areq-sales@example.invalid';
const OTHER = 'areq-other@example.invalid';
const USERS = [ADMIN, SALES, OTHER];
const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const sales = authCookie(SALES, 'SALES', 'ORG_SALES1');
const other = authCookie(OTHER, 'SALES', 'ORG_SALES1');
let customerId = 0;
const quotes: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [SALES, 'SALES', 'ORG_SALES1'], [OTHER, 'SALES', 'ORG_SALES1']] as const) {
    await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '배정요청시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
  }
  customerId = (await prisma.customer.create({ data: { name: '배정요청_테스트고객' } })).id;
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
  await prisma.notification.deleteMany({ where: { user_email: { in: USERS } } });
  // 요청 알림은 활성 관리자 전원에게 간다 — 이 시험이 만든 견적의 알림만 거둔다(다른 계정 알림함에 남지 않게)
  await prisma.notification.deleteMany({ where: { tag: { in: quotes.map(id => `assign-maker-${id}`) } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
});

async function signedQuote(status: 'contracted' | 'confirmed' = 'contracted') {
  const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status, customer_id: customerId, final_price: 1, sales_user_id: SALES }, select: { id: true } });
  quotes.push(q.id);
  return q.id;
}
const ask = (id: number, cookie = sales) => request(app).patch(`/api/v1/quotes/${id}/assign-request`).set('Cookie', cookie).send({});
const assign = (id: number) => request(app).patch(`/api/v1/quotes/${id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' });
const requested = async (id: number) => (await prisma!.quote.findUniqueOrThrow({ where: { id }, select: { assign_requested_at: true } })).assign_requested_at;

describe.runIf(live)('배정 요청', () => {
  it('🔴 서명만 끝난 건은 관리자가 배정할 수 없다 — 영업이 요청하면 열린다', async () => {
    const id = await signedQuote();
    const blocked = await assign(id);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('ASSIGN_NOT_REQUESTED');

    const r = await ask(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await requested(id)).not.toBeNull();
    const ok = await assign(id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  }, 30_000);

  it('🔴 남의 견적은 요청 못 한다 · 서명 전은 못 한다 · 두 번은 안 된다', async () => {
    const id = await signedQuote();
    expect((await ask(id, other)).status).toBe(403);
    expect(await requested(id)).toBeNull();
    expect((await ask(await signedQuote('confirmed'))).status).toBe(409);
    expect((await ask(id)).status).toBe(200);
    expect((await ask(id)).status).toBe(409);
  }, 30_000);

  it('🔴 동시에 여러 번 눌러도 한 번만 요청된다(이력·알림 한 번)', async () => {
    const id = await signedQuote();
    const rs = await Promise.all(Array.from({ length: 8 }, () => ask(id)));
    expect(rs.filter(r => r.status === 200).length).toBe(1);
    const logs = await prisma!.quoteChangeLog.count({ where: { quote_id: id, field: 'assign_requested_at' } });
    expect(logs).toBe(1);
  }, 30_000);

  it('🔴 배정 거부로 돌아온 건은 요청 없이 바로 재배정 — 이 기능 전에 배정된 옛 건도', async () => {
    const id = await signedQuote();
    expect((await ask(id)).status).toBe(200);
    expect((await assign(id)).status).toBe(200);
    // 옛 건 흉내 — 요청 기록 없이 배정돼 있던 주문
    await prisma!.quote.update({ where: { id }, data: { assign_requested_at: null } });
    const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: id } });
    const rej = await request(app).patch(`/api/v1/orders/${o.id}/reject`).set('Cookie', authCookie('areq-maker@example.invalid', 'MAKER', 'ORG_BRAIN')).send({ reason: '일정 불가' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    expect(await requested(id), '거부로 돌아온 건이 요청 전 상태가 됐다').not.toBeNull();
    expect((await assign(id)).status).toBe(200);
  }, 30_000);

  it('🔴 주문 삭제로 돌아온 건도 요청 없이 바로 재배정 — 삭제 기록은 이력으로 옮기고 진행은 처음부터(예전엔 재배정이 막혔다)', async () => {
    const id = await signedQuote();
    await prisma!.quote.update({ where: { id }, data: { assign_requested_at: new Date() } });
    expect((await assign(id)).status).toBe(200);
    await prisma!.quote.update({ where: { id }, data: { assign_requested_at: null } });   // 옛 건 흉내
    const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: id } });
    // 앞 특장사가 수락하고 차량 도착까지 한 상태에서 삭제
    await prisma!.order.update({ where: { id: o.id }, data: { accepted_at: new Date(), delivery_due: new Date('2026-10-01T00:00:00Z') } });
    await prisma!.quote.update({ where: { id }, data: { status: 'ordered' } });
    await prisma!.orderStep.update({ where: { order_id_code: { order_id: o.id, code: 'car_arrived' } }, data: { status: 'done', done_at: new Date('2026-09-10T01:00:00Z'), done_by: 'old-maker' } });
    const c = await request(app).patch(`/api/v1/orders/${o.id}/cancel`).set('Cookie', admin).send({ reason: '잘못 배정' });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(await requested(id)).not.toBeNull();
    const again = await assign(id);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: o.id }, select: { canceled_at: true, accepted_at: true, delivery_due: true, maker_org_id: true } });
    expect(after).toEqual({ canceled_at: null, accepted_at: null, delivery_due: null, maker_org_id: 'ORG_BRAIN' });
    const car = await prisma!.orderStep.findUniqueOrThrow({ where: { order_id_code: { order_id: o.id, code: 'car_arrived' } } });
    expect(car.status).toBe('pending');
    expect(car.note, '이전 진행이 메모로 남지 않았다').toMatch(/주문 삭제 후 재배정으로 초기화 \(이전 done 2026-09-10 old-maker\)/);
    const log = await prisma!.quoteChangeLog.findFirst({ where: { quote_id: id, field: 'order_cancel_reassigned' } });
    expect(log?.old_value, '삭제 사유가 이력에 없다').toContain('잘못 배정');
  }, 30_000);
});

describe('규칙이 한 곳씩', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  it('🔴 마이그레이션은 칸만 더한다 — 기존 행을 채우지 않아 대기 중인 건도 요청해야 넘어간다', () => {
    const sql = src('backend/prisma/migrations/20260915010000_assign_request/migration.sql');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS "assign_requested_at" TIMESTAMP\(3\)/);
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP|DEFAULT/i);
  });
  it('🔴 영업 화면 — 계약완료 + 요청 전에만 「배정 요청」, 요청 뒤엔 글씨', () => {
    const page = src('frontend/src/pages/SalesPage.tsx');
    expect(page).toMatch(/\{q\.status === 'contracted' && !q\.assign_requested_at && \(/);
    expect(page).toMatch(/t\('배정 요청'\)/);
    expect(page).toMatch(/\{q\.status === 'contracted' && q\.assign_requested_at && \(/);
  });
  it('🔴 관리자 — 제작 배정 버튼·현황판 배정 대기는 요청된 건만', () => {
    const admin = src('frontend/src/pages/AdminPage.tsx');
    expect(admin.match(/canAssignMaker\(q\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(admin).not.toMatch(/\{q\.status === 'contracted' && \(\s*<button style=\{qt\.assignBtn\}/);
    expect(src('frontend/src/lib/orderDashboard.ts')).toMatch(/q\.status === 'contracted' && !!q\.assign_requested_at/);
  });
  it('🔴 거부·삭제 경로가 계약완료로 돌리기 전에 요청을 살린다', () => {
    const orders = src('backend/src/routes/orders.ts');
    expect(orders.match(/await keepAssignRequested\(order\.quote\.id, [^)]*\);\s*await setQuoteStatus\(order\.quote\.id, 'contracted'/g)?.length).toBe(2);
  });
  it('🔴 특장만 견적서에 차량가·탁송료·보조금 안내 문구가 없다', () => {
    expect(src('doc-templates/quote-template.html')).not.toContain('차량 가격·탁송료·EV보조금·차량 등록비는 포함되지 않습니다');
  });
});
