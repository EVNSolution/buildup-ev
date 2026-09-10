import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 납기 한도 — **배정일부터 20영업일, 연휴는 빼고.**
 *
 * 주말만 빼고 세면 연휴가 낀 달에 고를 수 있는 날짜가 실제보다 적어진다.
 * 추석 연휴를 앞두고 납기를 못 찍는 일이 실제로 생겼다(제보).
 *
 * 여기서 실제 API 로 확인하는 것은 넷이다.
 *   ① 연휴 당일은 납기로 저장되지 않는다
 *   ② 연휴만큼 한도가 뒤로 밀려, 예전 한도(15일·주말만) 밖의 날짜가 받아진다
 *   ③ 한도는 **주문에 얼려 둔 값**을 쓴다 — 15일로 나간 발주서는 15일 그대로
 *   ④ 한도가 지난 배정은 여전히 막힌다(재배정해야 열린다)
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { toDateInput, addBusinessDays, setHolidays } = await import('@buildup-ev/shared/schedule');

const app = createApp();
const live = !!prisma;
const ADMIN = 'due-admin@example.invalid';
const MAKER = 'due-maker@example.invalid';
const MAKER_ORG = 'ORG_BRAIN';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', MAKER_ORG);
let customerId = 0;
const madeQuotes: number[] = [];
/** 시험용 연휴 — 실제 달력과 겹치지 않게 먼 미래에 둔다 */
const HOL = ['2031-03-05', '2031-03-06'];   // 수·목

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
      create: { email, name: '납기시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '납기_테스트고객' } });
  customerId = c.id;
  for (const day of HOL) {
    await prisma.holiday.upsert({
      where: { day: new Date(`${day}T00:00:00Z`) },
      update: { active: true },
      create: { day: new Date(`${day}T00:00:00Z`), name: '시험용 연휴', source: 'manual', active: true },
    });
  }
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.holiday.deleteMany({ where: { day: { in: HOL.map(d => new Date(`${d}T00:00:00Z`)) } } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
  setHolidays([]);
});

/** 배정된 주문 하나. `assignedAt` 을 주면 그 날짜로 배정한 것처럼 만든다. */
async function assign(assignedAt?: Date) {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  const res = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
  if (assignedAt) {
    await prisma!.order.update({ where: { id: order.id }, data: { assigned_at: assignedAt } });
    return { ...order, assigned_at: assignedAt };
  }
  return order;
}

const accept = (id: number, due: string) =>
  request(app).patch(`/api/v1/orders/${id}/accept`).set('Cookie', makerCookie).send({ delivery_due: due });

describe.runIf(live)('납기 한도', () => {
  it('🔴 배정하면 그때의 한도(20영업일)가 주문에 얼려진다', async () => {
    const order = await assign();
    expect(order.due_limit_days).toBe(20);
  }, 30_000);

  it('🔴 연휴 당일은 납기로 저장되지 않는다', async () => {
    const order = await assign(new Date(2031, 1, 20));       // 2031-02-20 목
    const res = await accept(order.id, HOL[0]!);
    expect(res.status, `연휴가 저장됐다: ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body?.error?.message ?? '').toContain('공휴일');
  }, 30_000);

  it('🔴 연휴만큼 한도가 밀린다 — 예전 계산이면 거부됐을 날짜가 받아진다', async () => {
    const base = new Date(2031, 1, 20);                       // 2031-02-20 목
    // 주말만 빼면 20영업일 뒤가 한도. 연휴 이틀이 빠지므로 실제 한도는 그보다 뒤다.
    setHolidays([]);
    const weekendOnly = addBusinessDays(base, 20);
    setHolidays(HOL);
    const withHoliday = addBusinessDays(base, 20);
    expect(toDateInput(withHoliday) > toDateInput(weekendOnly), '연휴가 반영되지 않았다').toBe(true);

    const order = await assign(base);
    const res = await accept(order.id, toDateInput(withHoliday));
    expect(res.status, `연휴를 뺀 한도가 거부됐다: ${JSON.stringify(res.body)}`).toBe(200);
  }, 30_000);

  it('🔴 15일로 나간 발주서는 15일 그대로 — 상수를 올려도 소급되지 않는다', async () => {
    const base = new Date(2031, 1, 20);
    const order = await assign(base);
    await prisma!.order.update({ where: { id: order.id }, data: { due_limit_days: 15 } });
    setHolidays(HOL);
    const far = toDateInput(addBusinessDays(base, 18));       // 15일 밖 · 20일 안
    const res = await accept(order.id, far);
    expect(res.status, `15일 발주서가 18영업일을 받았다: ${JSON.stringify(res.body)}`).toBe(400);
    expect(res.body?.error?.message ?? '').toContain('15영업일');
  }, 30_000);

  it('🔴 한도가 지난 배정은 여전히 막힌다 — 재배정해야 열린다', async () => {
    const order = await assign(new Date(2020, 0, 6));         // 한참 지난 배정
    const res = await accept(order.id, toDateInput(addBusinessDays(new Date(), 3)));
    expect(res.status).toBe(400);
    expect(res.body?.error?.message ?? '').toContain('영업일 이내');
  }, 30_000);

  it('🔴 달력은 로그인한 누구나 받는다 — 화면이 서버와 같은 목록을 써야 한다', async () => {
    const res = await request(app).get('/api/v1/holidays?from=2031-01-01&to=2031-12-31').set('Cookie', makerCookie);
    expect(res.status).toBe(200);
    expect(res.body.data.map((h: { day: string }) => h.day)).toEqual(HOL);
  }, 30_000);

  it('🔴 다음 해는 **화면에서** 넣을 수 있다 — 배포를 기다리지 않는다', async () => {
    /*
     * 2026년 값을 migration 에 넣어 두었지만 그건 시작점일 뿐이다. 해가 바뀔 때마다
     * 배포해야 한다면 임시공휴일 하나에도 배포가 필요해진다 — 그러라고 표로 뺀 것이 아니다.
     */
    const YEAR = 2033;
    const put = await request(app).put('/api/v1/holidays').set('Cookie', adminCookie)
      .send({ year: YEAR, days: [{ day: `${YEAR}-02-14`, name: '시험 임시공휴일' }] });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    // 넣자마자 계산에 반영된다 — 고치고 나서 반영을 기다리게 하지 않는다
    const order = await assign(new Date(YEAR, 1, 10));
    const res = await accept(order.id, `${YEAR}-02-14`);
    expect(res.status, '방금 넣은 공휴일이 납기로 저장됐다').toBe(400);
    expect(res.body?.error?.message ?? '').toContain('공휴일');

    // 뺀 날은 지워지지 않고 꺼진다 — 「안 쉬는 날로 정했다」도 기록이다
    await request(app).put('/api/v1/holidays').set('Cookie', adminCookie).send({ year: YEAR, days: [] });
    const row = await prisma!.holiday.findUnique({ where: { day: new Date(`${YEAR}-02-14T00:00:00Z`) } });
    expect(row, '공휴일이 지워졌다').not.toBeNull();
    expect(row!.active).toBe(false);

    await prisma!.holiday.deleteMany({ where: { name: '시험 임시공휴일' } });
  }, 60_000);

  it('🔴 공휴일 표를 고치는 것은 권한이 있는 관리자만', async () => {
    const res = await request(app).put('/api/v1/holidays').set('Cookie', makerCookie)
      .send({ year: 2033, days: [] });
    expect(res.status).toBe(403);
  }, 30_000);

  it('🔴 로그인 없이는 못 받는다 — 인증 없이 DB 를 두드릴 자리를 두지 않는다', async () => {
    // 공휴일은 비밀이 아니지만 문을 열어 두지는 않는다(배포 뒤에 열려 있는 것을 발견했다)
    const res = await request(app).get('/api/v1/holidays');
    expect(res.status, '인증 없이 열려 있다').toBe(403);
  }, 30_000);
});
