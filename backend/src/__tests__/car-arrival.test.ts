import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 차량 도착 **예정일** — 관리자가 알려 주고 특장사는 본다.
 *
 * 특장사가 완료 처리하는 「차량 도착」 단계와 다르다. 이건 예정이고, 아는 사람은
 * 차를 보내는 쪽이다. 여기서 지키는 것은 넷이다.
 *   ① 관리자만 쓴다 — 특장사는 보기만
 *   ② 수락 전이든 진행 중이든 **언제든** 쓸 수 있다(상태로 막지 않는다)
 *   ③ 바뀌면 **무엇에서 무엇으로**가 기록에 남는다
 *   ④ 바뀔 때마다 특장사에게 알림이 간다
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

const app = createApp();
const live = !!prisma;
const ADMIN = 'car-admin@example.invalid';
const MAKER = 'car-maker@example.invalid';
const MAKER_ORG = 'ORG_BRAIN';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', MAKER_ORG);
let customerId = 0;
const madeQuotes: number[] = [];

async function grantAll(email: string) {
  const mods = await prisma!.featureModule.findMany({ select: { code: true } });
  for (const m of mods) {
    await prisma!.accessControl.upsert({
      where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
      update: { enabled: true },
      create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled: true },
    });
  }
}

beforeAll(async () => {
  if (!prisma) return;
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', MAKER_ORG]] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '도착시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '도착_테스트고객' } });
  customerId = c.id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

async function assign() {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  const res = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
}

const setDate = (id: number, cookie: string, planned_at: string | null) =>
  request(app).patch(`/api/v1/orders/${id}/car-arrival`).set('Cookie', cookie).send({ planned_at });

describe.runIf(live)('차량 도착 예정일', () => {
  it('🔴 수락 전에도 찍을 수 있다 — 상태로 막지 않는다', async () => {
    const order = await assign();          // 아직 수락 전(assigned)
    const res = await setDate(order.id, adminCookie, '2031-05-20');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.car_arrival_planned_at?.toISOString().slice(0, 10)).toBe('2031-05-20');
    expect(after.car_arrival_set_by).toBe(ADMIN);
  }, 30_000);

  it('🔴 특장사는 못 쓴다 — 정하는 사람은 차를 보내는 쪽이다', async () => {
    const order = await assign();
    const res = await setDate(order.id, makerCookie, '2031-05-20');
    expect(res.status).toBe(403);
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.car_arrival_planned_at).toBeNull();
  }, 30_000);

  it('🔴 특장사는 **볼 수** 있다', async () => {
    const order = await assign();
    await setDate(order.id, adminCookie, '2031-05-20');
    const res = await request(app).get(`/api/v1/orders/${order.id}`).set('Cookie', makerCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.car_arrival_planned_at).toBe('2031-05-20');
  }, 30_000);

  it('🔴 바뀌면 무엇에서 무엇으로가 남고, 특장사에게 알림이 간다', async () => {
    const order = await assign();
    notify.mockClear();
    await setDate(order.id, adminCookie, '2031-05-20');
    await setDate(order.id, adminCookie, '2031-05-27');

    const notes = await prisma!.orderStepComment.findMany({
      where: { order_id: order.id, author_role: 'SYSTEM' }, orderBy: { id: 'asc' },
    });
    expect(notes.map(n => n.body)).toEqual([
      '차량 도착 예정일: 2031-05-20',
      '차량 도착 예정일이 2031-05-20 → 2031-05-27 로 바뀌었습니다',
    ]);
    // 기록은 그 단계 대화에 붙는다 — 특장사가 이미 보고 있는 자리다
    expect(notes.every(n => n.step_code === 'car_arrived')).toBe(true);

    // 바뀔 때마다 알린다 — 현장은 이 날짜에 맞춰 사람을 뺀다
    expect(notify.mock.calls.length, '알림이 두 번 가지 않았다').toBe(2);
    const [to, payload] = notify.mock.calls[1] as [string[], { body: string; tag: string }];
    expect(to).toContain(MAKER);
    expect(to, '관리자에게까지 알림이 갔다').not.toContain(ADMIN);
    expect(payload.body).toContain('2031-05-27');
    expect(payload.tag, '같은 주문 알림이 쌓인다').toBe(`car-arrival-${order.id}`);
  }, 30_000);

  it('🔴 같은 날짜를 다시 보내면 알리지 않는다 — 안 바뀐 것은 소식이 아니다', async () => {
    const order = await assign();
    await setDate(order.id, adminCookie, '2031-05-20');
    notify.mockClear();
    const res = await setDate(order.id, adminCookie, '2031-05-20');
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(false);
    expect(notify.mock.calls.length).toBe(0);
  }, 30_000);

  it('🔴 지울 수 있다 — 잘못 찍었을 때 되돌릴 길', async () => {
    const order = await assign();
    await setDate(order.id, adminCookie, '2031-05-20');
    const res = await setDate(order.id, adminCookie, '');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.car_arrival_planned_at).toBeNull();
  }, 30_000);

  it('🔴 화면에서도 관리자만 고칠 수 있다', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
    const detail = read('frontend/src/components/OrderDetail.tsx');
    expect(detail, '도착 예정 줄이 화면에 없다').toMatch(/CarArrivalRow/);
    expect(detail, '특장사에게도 고치는 자리가 열린다').toMatch(/canEdit=\{isAdmin && canChangeSteps\}/);
  });
});
