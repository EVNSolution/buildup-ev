import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **배정 취소 · 배정 요청 필요건만** — 2026-09-15 지시.
 *   ① 수락 대기 주문을 관리자가 거둬 배정 대기로 — 영업 요청은 살아 있어 바로 재배정
 *   ② 수락한 뒤에는 못 한다 · 특장사는 못 한다 · 특장사 수락과 동시에 눌러도 하나만
 *   ③ 누구에게 맡겼다 누가 거뒀는지 견적 이력에 남고, 거둔 특장사에게서 사라진다
 *   ④ 영업 목록 「배정 요청 필요건만」 — 관리자 「배정 필요건만」과 같은 방식
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { businessDue } = await import('./due-helper.js');
const { readFileSync } = await import('node:fs');
const path = (await import('node:path')).default;

const app = createApp();
const live = !!prisma;
const ADMIN = 'unassign-admin@example.invalid';
const MAKER = 'unassign-maker@example.invalid';
const USERS = [ADMIN, MAKER];
const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const maker = authCookie(MAKER, 'MAKER', 'ORG_BRAIN');
let customerId = 0;
const quotes: number[] = [];
const orders: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN']] as const) {
    await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '배정취소시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
  }
  customerId = (await prisma.customer.create({ data: { name: '배정취소_테스트고객' } })).id;
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
  // 알림은 조직 사용자·관리자 전원에게 간다 — 이 시험이 만든 건의 것만 거둔다
  await prisma.notification.deleteMany({ where: { OR: [
    { user_email: { in: USERS } },
    { tag: { in: [...orders.map(id => `unassign-${id}`), ...quotes.map(id => `assign-maker-${id}`)] } },
  ] } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
});

async function pendingOrder() {
  const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', assign_requested_at: new Date(), customer_id: customerId, final_price: 1 }, select: { id: true } });
  quotes.push(q.id);
  const a = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
  orders.push(o.id);
  return { id: o.id, quoteId: q.id };
}
const unassign = (id: number, cookie = admin, reason = '특장사 변경') => request(app).patch(`/api/v1/orders/${id}/unassign`).set('Cookie', cookie).send({ reason });
const makerSees = async (id: number) => ((await request(app).get('/api/v1/orders').set('Cookie', maker)).body.data as { id: number }[]).some(o => o.id === id);

describe.runIf(live)('배정 취소', () => {
  it('🔴 수락 대기를 거두면 배정 대기로 — 특장사 목록에서 사라지고, 요청 없이 바로 재배정', async () => {
    const { id, quoteId } = await pendingOrder();
    expect(await makerSees(id)).toBe(true);
    const r = await unassign(id);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: quoteId }, select: { status: true, assign_requested_at: true } });
    expect(q.status).toBe('contracted');
    expect(q.assign_requested_at).not.toBeNull();
    expect((await prisma!.order.findUniqueOrThrow({ where: { id } })).maker_org_id).toBeNull();
    expect(await makerSees(id), '거둔 특장사에게 남아 있다').toBe(false);
    const log = await prisma!.quoteChangeLog.findFirst({ where: { quote_id: quoteId, field: 'assign_canceled' } });
    expect(log?.old_value).toContain('ORG_BRAIN');
    expect(log?.new_value).toBe('특장사 변경');
    const again = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
  }, 30_000);

  it('🔴 수락한 주문은 거둘 수 없다 · 특장사는 못 한다 · 두 번은 안 된다', async () => {
    const { id } = await pendingOrder();
    expect((await unassign(id, maker)).status).toBe(403);
    const acc = await request(app).patch(`/api/v1/orders/${id}/accept`).set('Cookie', maker).send({ delivery_due: await businessDue() });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect((await unassign(id)).status).toBe(409);

    const p = await pendingOrder();
    expect((await unassign(p.id)).status).toBe(200);
    expect((await unassign(p.id)).status).toBe(409);
  }, 30_000);

  it('🔴 특장사 수락과 동시에 눌러도 둘 중 하나만 된다', async () => {
    const { id, quoteId } = await pendingOrder();
    const due = await businessDue();
    const [u, a] = await Promise.all([
      unassign(id),
      request(app).patch(`/api/v1/orders/${id}/accept`).set('Cookie', maker).send({ delivery_due: due }),
    ]);
    expect([u.status, a.status].filter(s => s === 200).length, `unassign ${u.status} accept ${a.status}`).toBe(1);
    const o = await prisma!.order.findUniqueOrThrow({ where: { id } });
    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: quoteId } });
    if (u.status === 200) { expect(o.maker_org_id).toBeNull(); expect(o.accepted_at).toBeNull(); expect(q.status).toBe('contracted'); }
    else { expect(o.maker_org_id).toBe('ORG_BRAIN'); expect(q.status).toBe('ordered'); }
  }, 30_000);
});

describe.runIf(live)('배정 취소한 주문은 뒤 단계에서 사라진다(2026-09-15 제보)', () => {
  const listed = async (id: number, cookie: string, q = '') => ((await request(app).get(`/api/v1/orders${q}`).set('Cookie', cookie)).body.data as { id: number }[]).some(o => o.id === id);

  it('🔴 목록에 안 나온다 — 견적 상태(계약완료)만 보고 「특장 진행」으로 분류되던 것', async () => {
    const { id } = await pendingOrder();
    expect((await unassign(id)).status).toBe(200);
    expect(await listed(id, admin), '관리자 목록에 남았다').toBe(false);
    expect(await listed(id, admin, '?board=admin')).toBe(false);
    expect(await listed(id, maker)).toBe(false);
  }, 30_000);

  it('🔴 단계를 진행할 수 없다', async () => {
    const { id } = await pendingOrder();
    expect((await unassign(id)).status).toBe(200);
    const r = await request(app).patch(`/api/v1/orders/${id}/steps/build_started`).set('Cookie', admin).send({});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_ASSIGNED');
  }, 30_000);

  it('🔴 발주서를 다시 열면 「거부」가 아니라 「배정 취소로 돌아온」 발주서 — 누가·왜', async () => {
    const { id, quoteId } = await pendingOrder();
    expect((await unassign(id, admin, '사양 재확인')).status).toBe(200);
    const d = (await request(app).get(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', admin)).body.data;
    expect([d.from_unassigned, d.from_rejected, d.saved_by, d.reject_reason]).toEqual([true, false, ADMIN, '사양 재확인']);
  }, 30_000);

  it('🔴 거부로 돌아온 건은 여전히 「거부」로 말하고 배정 대기 표시를 위해 목록에 남는다', async () => {
    const { id, quoteId } = await pendingOrder();
    const rej = await request(app).patch(`/api/v1/orders/${id}/reject`).set('Cookie', maker).send({ reason: '일정 불가' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(200);
    const d = (await request(app).get(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', admin)).body.data;
    expect([d.from_rejected, d.from_unassigned, d.reject_reason]).toEqual([true, false, '일정 불가']);
    expect(await listed(id, admin)).toBe(true);
  }, 30_000);

  it('🔴 관리자 주문 진행(board=admin)은 숨긴 견적의 주문을 뺀다 — 특장사 목록에는 남는다', async () => {
    const { id, quoteId } = await pendingOrder();
    await prisma!.quote.update({ where: { id: quoteId }, data: { hidden_at: new Date(), hidden_by: ADMIN } });
    expect(await listed(id, admin, '?board=admin')).toBe(false);
    expect(await listed(id, maker), '제작 중인 특장사 목록에서 사라졌다').toBe(true);
  }, 30_000);
});

describe('화면', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const src = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  it('🔴 배정 취소는 수락 대기 목록 줄 끝과 발주서 조회 창에만 — 제작 배정 권한이 있을 때', () => {
    const page = src('frontend/src/pages/AdminPage.tsx');
    expect(page).toMatch(/onUnassign=\{canAssign && sel\.kind === 'tile' && sel\.key === 'pending' \? o => setUnassigning\(o\) : undefined\}/);
    expect(page).toMatch(/onUnassign=\{canAssign && !viewingPo\.accepted_at && !!viewingPo\.maker_org_id/);
    const modal = src('frontend/src/components/AcceptOrderModal.tsx');
    expect(modal).toMatch(/\{readOnly && onUnassign && \(/);
  });
  it('🔴 배정 취소 확인창은 발주서 조회 창보다 위에 뜬다 — 발주서 창에서 여는 창이다', () => {
    const z = (f: string) => Number(/overlay: \{[^}]*zIndex: (\d+)/.exec(src(f).replace(/\/\/[^\n]*\n/g, '\n'))?.[1]);
    const po = z('frontend/src/components/AcceptOrderModal.tsx');
    expect(po).toBeGreaterThan(0);
    expect(z('frontend/src/components/OrderUnassignModal.tsx'), '발주서 창에 가린다').toBeGreaterThan(po);
  });
  it('🔴 주문 구획·현황판은 특장사가 없는 행을 진행 칸에 넣지 않는다', () => {
    expect(src('frontend/src/components/OrderSections.tsx')).toMatch(/const active  = orders\.filter\(o => assigned\(o\) && /);
    expect(src('frontend/src/lib/orderDashboard.ts')).toMatch(/const live = orders\.filter\(o => o\.maker_org_id != null\)/);
    expect(src('frontend/src/pages/AdminPage.tsx')).toMatch(/fetchOrders\(\{ board: 'admin' \}\)/);
  });
  it('🔴 영업 목록 「배정 요청 필요건만」 — 버튼과 같은 조건으로 거른다', () => {
    const page = src('frontend/src/pages/SalesPage.tsx');
    expect(page).toMatch(/function needsAssignRequest\(q: ApiQuote\): boolean \{\s*return q\.status === 'contracted' && !q\.assign_requested_at/);
    expect(page).toMatch(/filterByCustomer\(quotes, nameQuery\)\.filter\(q => !onlyRequest \|\| needsAssignRequest\(q\)\)/);
    expect(page).toMatch(/\{needsAssignRequest\(q\) && \(/);
    expect(page).toMatch(/t\('배정 요청 필요건만'\)/);
  });
});
