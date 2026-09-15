import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **배정 거부** — 2026-09-15 지시.
 *   ① 관리자가 영업의 배정 요청을 **사유와 함께** 돌려보낸다(사유 필수)
 *   ② 돌려보낸 견적은 배정 대기에서 빠지고(요청이 걷힌다) 영업 목록 맨 위에 빨간 줄 — 담당 영업에게 알림
 *   ③ 영업이 다시 요청하면 거부 표시가 걷히고 배정 대기로 돌아온다
 *   ④ 관리자 + 제작 배정 권한만 · 요청 들어온 건만 · 동시에 눌러도 한 번
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
const notify = vi.fn();
vi.mock('../services/push.js', async (orig) => {
  const real = await orig<typeof import('../services/push.js')>();
  return { ...real, notify: (...a: unknown[]) => notify(...a) };
});
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
const ADMIN = 'arej-admin@example.invalid';
const SALES = 'arej-sales@example.invalid';
const USERS = [ADMIN, SALES];
const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const sales = authCookie(SALES, 'SALES', 'ORG_SALES1');
let customerId = 0;
const quotes: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [SALES, 'SALES', 'ORG_SALES1']] as const) {
    await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '배정거부시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
  }
  customerId = (await prisma.customer.create({ data: { name: '배정거부_테스트고객' } })).id;
});
afterAll(async () => {
  if (!prisma) return;
  for (const id of quotes) {
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.notification.deleteMany({ where: { OR: [{ user_email: { in: USERS } }, { tag: { in: quotes.map(id => `assign-maker-${id}`) } }] } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
});

async function requestedQuote() {
  const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 1, sales_user_id: SALES, quote_no: `AREJ-${Date.now() % 100000}` }, select: { id: true } });
  quotes.push(q.id);
  expect((await request(app).patch(`/api/v1/quotes/${q.id}/assign-request`).set('Cookie', sales).send({})).status).toBe(200);
  return q.id;
}
const reject = (id: number, reason: unknown = '서명본에 고객 서명 누락', cookie = admin) =>
  request(app).patch(`/api/v1/quotes/${id}/assign-reject`).set('Cookie', cookie).send({ reason });
const row = (id: number) => prisma!.quote.findUniqueOrThrow({ where: { id } });

describe.runIf(live)('배정 거부', () => {
  it('🔴 사유와 함께 돌려보낸다 — 요청이 걷혀 배정이 막히고, 거부 표시·이력·담당 영업 알림', async () => {
    const id = await requestedQuote();
    notify.mockClear();
    const r = await reject(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);

    const q = await row(id);
    expect(q.assign_requested_at).toBeNull();
    expect([q.assign_rejected_by, q.assign_reject_reason]).toEqual([ADMIN, '서명본에 고객 서명 누락']);
    expect(q.assign_rejected_at).not.toBeNull();
    expect(q.status, '견적 상태가 바뀌었다').toBe('contracted');

    // 배정 대기에서 빠진다 — 제작 배정이 막힌다
    const a = await request(app).patch(`/api/v1/quotes/${id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' });
    expect(a.body.error?.code).toBe('ASSIGN_NOT_REQUESTED');

    const log = await prisma!.quoteChangeLog.findFirst({ where: { quote_id: id, field: 'assign_rejected' } });
    expect(log?.new_value).toBe('서명본에 고객 서명 누락');
    expect(log?.old_value, '누가 요청했는지가 이력에 없다').toContain(SALES);

    await vi.waitFor(() => expect(notify.mock.calls.some(([to, p]) => (to as string[]).includes(SALES) && (p as { title: string }).title.startsWith('배정 거부'))).toBe(true), { timeout: 3000 });
    const [, payload] = notify.mock.calls.find(([to, p]) => (to as string[]).includes(SALES) && (p as { title: string }).title.startsWith('배정 거부'))! as [string[], { body: string; url: string }];
    expect(payload.body).toContain('서명본에 고객 서명 누락');
    expect(payload.url).toBe('/sales?tab=list');

    // 영업 목록 응답에 실린다(화면이 맨 위 빨간 줄로 그린다)
    const list = (await request(app).get('/api/v1/quotes?scope=mine').set('Cookie', sales)).body.data as { id: number; assign_rejected_at: string | null; assign_reject_reason: string | null }[];
    expect(list.find(x => x.id === id)?.assign_reject_reason).toBe('서명본에 고객 서명 누락');
  }, 30_000);

  it('🔴 영업이 다시 요청하면 거부 표시가 걷히고 배정할 수 있다', async () => {
    const id = await requestedQuote();
    expect((await reject(id)).status).toBe(200);
    expect((await request(app).patch(`/api/v1/quotes/${id}/assign-request`).set('Cookie', sales).send({})).status).toBe(200);
    const q = await row(id);
    expect([q.assign_rejected_at, q.assign_rejected_by, q.assign_reject_reason]).toEqual([null, null, null]);
    expect(q.assign_requested_at).not.toBeNull();
    const a = await request(app).patch(`/api/v1/quotes/${id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
  }, 30_000);

  it('🔴 사유 필수 · 영업은 못 한다 · 요청 없는 건은 409 · 동시에 눌러도 한 번', async () => {
    const id = await requestedQuote();
    expect((await reject(id, '   ')).status).toBe(400);
    expect((await reject(id, '사유', sales)).status).toBe(403);
    const rs = await Promise.all(Array.from({ length: 6 }, () => reject(id)));
    expect(rs.filter(r => r.status === 200).length).toBe(1);
    expect(await prisma!.quoteChangeLog.count({ where: { quote_id: id, field: 'assign_rejected' } })).toBe(1);
    expect((await reject(id)).status, '요청 없는 건을 거부했다').toBe(409);
  }, 30_000);
});

describe('화면', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  it('🔴 관리자 — 제작 배정 옆 「배정 거부」(견적 목록 카드·표, 현황판 배정 대기), 사유 필수 창은 맨 위 층', () => {
    const page = src('frontend/src/pages/AdminPage.tsx');
    expect(page.match(/onClick=\{\(\) => setRejectingAssign\(q\)\}>\{t\('배정 거부'\)\}/g)?.length).toBe(2);
    expect(page).toMatch(/onRejectAssign=\{canAssign \? q => setRejectingAssign\(q\) : undefined\}/);
    expect(src('frontend/src/components/OrderDashboard.tsx')).toMatch(/onRejectAssign\(w\.quote\)\}>\{t\('배정 거부'\)\}/);
    const modal = src('frontend/src/components/AssignRejectModal.tsx');
    expect(Number(/zIndex: (\d+)/.exec(modal)?.[1])).toBeGreaterThanOrEqual(1100);
    expect(modal).toMatch(/disabled=\{!reason\.trim\(\) \|\| busy\}/);
  });
  it('🔴 영업 — 거부된 견적은 맨 위 묶음·빨간 하이라이트·사유 표시, 날짜 묶음에는 다시 안 나온다', () => {
    const page = src('frontend/src/pages/SalesPage.tsx');
    expect(page).toMatch(/return \[\.\.\.\(rejected\.length \? \[\[REJECTED_GROUP, rejected\]/);
    expect(page).toMatch(/if \(isAssignRejected\(q\)\) continue/);
    expect(page).toMatch(/style=\{isAssignRejected\(q\) \? lv\.rowRejected : needsAssignRequest\(q\) \? lv\.rowNeed : undefined\}/);
    expect(page).toMatch(/rowRejected: \{ background: 'var\(--warnbg\)' \}/);
    expect(page).toMatch(/tf\('배정 거부 · \{0\}', q\.assign_reject_reason/);
  });
});
