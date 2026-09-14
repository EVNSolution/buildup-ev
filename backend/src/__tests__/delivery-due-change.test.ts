import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **관리자가 수락된 주문의 납기일을 바꾼다**(2026-09-14 요청 — 관리자 주문진행 탭).
 *
 * 납기는 특장사가 수락하며 고른다. 협의 끝에 날짜가 달라져도 고칠 자리가 없어
 * 시스템의 납기와 실제 약속이 어긋났다. 여기서 지키는 것:
 *   ① 관리자만, 수락된 주문만 바꾼다
 *   ② 발주일 이후의 영업일만 — 20영업일 한도는 보지 않는다(관리자가 늦춰 주는 것)
 *   ③ 지우지 않는다 — 처음 약속한 날은 한 번만 옮겨 적고, 바뀐 기록은 발주 협의 대화에 남는다
 *   ④ 특장사에게 알림이 가고, 특장사 화면의 납기도 바뀐다
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
const { businessDue } = await import('./due-helper.js');
const { addBusinessDays, toDateInput, isHoliday, holidaySet } = await import('@buildup-ev/shared/schedule');

const app = createApp();
const live = !!prisma;
const ADMIN = 'duechg-admin@example.invalid';
const MAKER = 'duechg-maker@example.invalid';
const MAKER_ORG = 'ORG_BRAIN';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', MAKER_ORG);
let customerId = 0;
const madeQuotes: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', MAKER_ORG]] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '납기변경시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    for (const m of mods) {
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
        update: { enabled: true },
        create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled: true },
      });
    }
  }
  customerId = (await prisma.customer.create({ data: { name: '납기변경_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderDueNotice.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

async function assigned() {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  const res = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
}
async function accepted() {
  const o = await assigned();
  const due = await businessDue();
  const res = await request(app).patch(`/api/v1/orders/${o.id}/accept`).set('Cookie', makerCookie).send({ delivery_due: due });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: o.id, due };
}
const change = (id: number, cookie: string, delivery_due: string, reason = '') =>
  request(app).patch(`/api/v1/orders/${id}/delivery-due`).set('Cookie', cookie).send({ delivery_due, reason });
const dueOf = async (id: number) => {
  const o = await prisma!.order.findUniqueOrThrow({ where: { id } });
  return {
    due: o.delivery_due?.toISOString().slice(0, 10),
    original: o.delivery_due_original?.toISOString().slice(0, 10) ?? null,
    by: o.delivery_due_changed_by,
  };
};
/** 오늘부터 n 영업일 뒤 — 서버와 같은 달력 */
const bday = async (n: number) => { await businessDue(); return toDateInput(addBusinessDays(new Date(), n)); };
/** 가장 가까운 토요일(발주일 이후) */
function nextSaturday(): string {
  const d = new Date(); d.setDate(d.getDate() + 14);
  while (d.getDay() !== 6) d.setDate(d.getDate() + 1);
  return toDateInput(d);
}

describe.runIf(live)('관리자 납기일 변경', () => {
  it('🔴 관리자가 바꾸면 납기가 바뀌고, 20영업일 한도를 넘겨도 된다', async () => {
    const { id, due } = await accepted();
    const later = await bday(40);          // 발주 한도(20영업일)를 한참 넘는 날
    const res = await change(id, adminCookie, later, '차량 입고 지연');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(await dueOf(id)).toEqual({ due: later, original: due, by: ADMIN });
  }, 30_000);

  it('🔴 처음 약속한 날은 한 번만 옮겨 적는다 — 두 번째로 바꿔도 덮어쓰지 않는다', async () => {
    const { id, due } = await accepted();
    await change(id, adminCookie, await bday(25));
    const third = await bday(30);
    expect((await change(id, adminCookie, third)).status).toBe(200);
    const after = await dueOf(id);
    expect(after.due).toBe(third);
    expect(after.original, '처음 약속이 두 번째 날짜로 덮였다').toBe(due);
  }, 30_000);

  it('🔴 특장사는 못 바꾼다', async () => {
    const { id, due } = await accepted();
    expect((await change(id, makerCookie, await bday(25))).status).toBe(403);
    expect((await dueOf(id)).due).toBe(due);
  }, 30_000);

  it('🔴 수락 전 주문은 못 바꾼다 — 그 납기는 특장사가 수락하며 고른다', async () => {
    const o = await assigned();
    const res = await change(o.id, adminCookie, await bday(12));
    expect(res.status).toBe(409);
    expect((await dueOf(o.id)).due).toBeUndefined();
  }, 30_000);

  it('🔴 취소된 주문은 못 바꾼다', async () => {
    const { id, due } = await accepted();
    await prisma!.order.update({ where: { id }, data: { canceled_at: new Date() } });
    expect((await change(id, adminCookie, await bday(25))).status).toBe(409);
    expect((await dueOf(id)).due).toBe(due);
  }, 30_000);

  it('🔴 주말·공휴일·발주일 이전은 고를 수 없다', async () => {
    const { id, due } = await accepted();
    expect((await change(id, adminCookie, nextSaturday())).status, '주말이 들어갔다').toBe(400);
    const holiday = [...holidaySet()].find(d => d > toDateInput(new Date()) && isHoliday(new Date(`${d}T00:00:00`)));
    if (holiday) expect((await change(id, adminCookie, holiday)).status, '공휴일이 들어갔다').toBe(400);
    expect((await change(id, adminCookie, '2020-01-02')).status, '발주일 이전이 들어갔다').toBe(400);
    expect((await change(id, adminCookie, 'not-a-date')).status).toBe(400);
    expect((await dueOf(id)).due).toBe(due);
  }, 30_000);

  it('🔴 바뀐 기록이 발주 협의 대화에 남고, 특장사에게만 알림이 간다', async () => {
    const { id, due } = await accepted();
    const next = await bday(22);
    notify.mockClear();
    await change(id, adminCookie, next, '차량 입고 지연');
    const notes = await prisma!.orderStepComment.findMany({ where: { order_id: id, author_role: 'SYSTEM' } });
    const note = notes.find(n => n.body.includes('납기일'));
    expect(note?.body).toBe(`납기일이 ${due} → ${next} 로 바뀌었습니다 — 사유: 차량 입고 지연`);
    expect(note?.step_code, '발주 협의 대화가 아닌 곳에 남았다').toBe('po');
    expect(note?.maker_org_id).toBe(MAKER_ORG);

    const calls = notify.mock.calls.filter(c => String((c[1] as { url: string }).url).includes(`order=${id}`));
    expect(calls.length).toBe(1);
    const [to, payload] = calls[0] as [string[], { tag: string; body: string }];
    expect(to).toContain(MAKER);
    expect(to).not.toContain(ADMIN);
    expect(payload.body).toContain(next);
    expect(payload.tag).toBe(`due-change-${id}`);
  }, 30_000);

  it('🔴 같은 날짜면 아무것도 남기거나 알리지 않는다', async () => {
    const { id, due } = await accepted();
    notify.mockClear();
    const res = await change(id, adminCookie, due);
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(false);
    expect((await dueOf(id)).original, '안 바뀌었는데 처음 약속이 적혔다').toBeNull();
    expect(notify.mock.calls.filter(c => String((c[1] as { url: string }).url).includes(`order=${id}`)).length).toBe(0);
  }, 30_000);

  it('🔴 특장사 화면에도 새 납기가 보이고, 발주 협의 대화에서 기록을 읽는다', async () => {
    const { id } = await accepted();
    const next = await bday(24);
    await change(id, adminCookie, next, '사양 변경');
    const steps = await request(app).get(`/api/v1/orders/${id}/steps`).set('Cookie', makerCookie);
    expect(steps.status).toBe(200);
    expect(steps.body.order.delivery_due).toBe(next);
    const thread = await request(app).get(`/api/v1/orders/${id}/steps/po/comments`).set('Cookie', makerCookie);
    expect(thread.status).toBe(200);
    expect(JSON.stringify(thread.body)).toContain('사유: 사양 변경');
    const detail = await request(app).get(`/api/v1/orders/${id}`).set('Cookie', adminCookie);
    expect(detail.body.data.delivery_due_original).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  }, 30_000);

  it('🔴 동시에 여러 번 바꿔도 한 번만 바뀐다 — 기록과 최종 날짜가 어긋나지 않는다', async () => {
    const { id } = await accepted();
    const dates = await Promise.all([21, 22, 23, 24, 25, 26, 27, 28].map(n => bday(n)));
    notify.mockClear();
    const results = await Promise.all(dates.map(d => change(id, adminCookie, d)));
    const ok = results.filter(r => r.status === 200 && r.body.data.changed);
    expect(results.filter(r => r.status === 500).length, '500 이 나갔다').toBe(0);
    expect(ok.length, `${ok.length}번 바뀌었다`).toBe(1);
    expect(results.filter(r => r.status === 409).length).toBe(dates.length - 1);
    const notes = await prisma!.orderStepComment.findMany({ where: { order_id: id, author_role: 'SYSTEM', body: { contains: '납기일이' } } });
    expect(notes.length, '기록이 여러 줄 남았다').toBe(1);
    expect(notes[0]!.body).toContain(`→ ${(await dueOf(id)).due} 로`);
  }, 30_000);

  it('🔴 화면: 관리자에게만, 수락된 주문에만 바꾸는 줄이 열린다', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    const detail = readFileSync(path.join(ROOT, 'frontend/src/components/OrderDetail.tsx'), 'utf8');
    expect(detail).toMatch(/\{isAdmin && canChangeSteps && detail\.accepted_at && detail\.delivery_due && \(\s*<DeliveryDueRow/);
    // 바꾸면 단계 탭의 납기 머리말도 다시 읽는다
    const panel = readFileSync(path.join(ROOT, 'frontend/src/components/OrderStepsPanel.tsx'), 'utf8');
    expect(panel).toMatch(/useEffect\(\(\) => \{ load\(\) \}, \[orderId, dueKey\]\)/);
  });
});
