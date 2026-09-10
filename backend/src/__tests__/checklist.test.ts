import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

/**
 * PDI 체크리스트 — **채워야 넘어간다.**
 *
 * 여기서 지키는 것.
 *   ① 서식이 **비어 있으면 막지 않는다** — 항목을 안 정한 단계에서 주문이 서면 안 된다
 *   ② 항목이 있으면 **모두 합격**이라야 그 단계를 완료할 수 있다
 *   ③ 불합격 → 조치 → 재검이 **항목별로 남는다**(마지막 판정만 남기지 않는다)
 *   ④ 서식을 고쳐도 **이미 작성한 것은 바뀌지 않는다**(작성 시점 사본)
 *   ⑤ 적는 사람이 정해져 있다 — 인도 체크리스트를 특장사가 적지 못한다
 *   ⑥ 제출하면 관리자에게 알림이 간다
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
const ADMIN = 'cl-admin@example.invalid';
const MAKER = 'cl-maker@example.invalid';
const MAKER_ORG = 'ORG_BRAIN';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', MAKER_ORG);
let customerId = 0;
const madeQuotes: number[] = [];
const STEP = 'car_arrived';

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
      create: { email, name: '체크시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '체크_테스트고객' } });
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
  await prisma.checklistItem.deleteMany({ where: { category: { startsWith: '시험' } } });
  // 빌려 썼던 서식을 되돌린다 — 시험이 남의 데이터를 끄고 끝나면 안 된다
  if (borrowed.length) {
    await prisma.checklistItem.updateMany({ where: { id: { in: borrowed } }, data: { active: true } });
  }
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

/*
 * ⚠️ 서식은 **공용 참조 데이터**다. 이 시험이 「서식이 비어 있으면 막지 않는다」를
 *    보려면 그 단계의 서식을 확실히 쥐어야 한다 — 실제로 화면에서 만들어 둔 항목과
 *    부딪혀 한 번 깨졌다. 시험이 도는 동안만 꺼 두고 끝나면 되돌린다.
 */
const STEPS_UNDER_TEST = ['car_arrived', 'build_done', 'delivered'];
let borrowed: number[] = [];

beforeEach(async () => {
  if (!prisma) return;
  await prisma.checklistItem.deleteMany({ where: { category: { startsWith: '시험' } } });
  const live = await prisma.checklistItem.findMany({
    where: { step_code: { in: STEPS_UNDER_TEST }, active: true },
    select: { id: true },
  });
  if (live.length) {
    borrowed = [...new Set([...borrowed, ...live.map(x => x.id)])];
    await prisma.checklistItem.updateMany({ where: { id: { in: live.map(x => x.id) } }, data: { active: false } });
  }
  notify.mockClear();
});

/** 수락까지 끝난 주문 — 단계를 완료할 수 있는 상태 */
async function acceptedOrder() {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG });
  const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
  await prisma!.order.update({ where: { id: order.id }, data: { accepted_at: new Date() } });
  await prisma!.quote.update({ where: { id: q.id }, data: { status: 'ordered' } });
  return order;
}

/** 서식에 항목을 넣는다 */
const putItems = (step: string, items: { category: string; content: string }[]) =>
  request(app).put('/api/v1/checklists').set('Cookie', adminCookie).send({ step, items });

const getCl = (id: number, cookie: string, step = STEP) =>
  request(app).get(`/api/v1/orders/${id}/steps/${step}/checklist`).set('Cookie', cookie);

const patchCl = (id: number, cookie: string, body: object, step = STEP) =>
  request(app).patch(`/api/v1/orders/${id}/steps/${step}/checklist`).set('Cookie', cookie).send(body);

/** 증빙까지 올려 두고 단계를 완료 시도 — 체크리스트 말고 다른 것에 막히지 않게 */
async function completeStep(id: number, cookie: string, step = STEP) {
  const def = { car_arrived: ['inspection_photo', 'receipt'] as string[] }[step] ?? [];
  for (const kind of def) {
    await prisma!.orderFile.create({
      data: { order_id: id, step_code: step, kind, path: `x/${step}-${kind}.jpg`, original_name: 'x.jpg', size_bytes: 1, mime: 'image/jpeg', uploaded_by: 'test' },
    });
  }
  return request(app).patch(`/api/v1/orders/${id}/steps/${step}`).set('Cookie', cookie).send({});
}

describe.runIf(live)('PDI 체크리스트', () => {
  it('🔴 서식이 비어 있으면 막지 않는다 — 안 정한 단계에서 주문이 서면 안 된다', async () => {
    const order = await acceptedOrder();
    expect((await getCl(order.id, makerCookie)).body.data, '서식이 없는데 체크리스트가 생겼다').toBeNull();
    const res = await completeStep(order.id, makerCookie);
    expect(res.status, `빈 서식이 완료를 막았다: ${JSON.stringify(res.body)}`).toBe(200);
  }, 30_000);

  it('🔴 항목이 있으면 모두 합격이라야 넘어간다', async () => {
    await putItems(STEP, [
      { category: '시험 외관', content: '적재함 도장 상태' },
      { category: '시험 전장', content: '실내등 점등' },
    ]);
    const order = await acceptedOrder();

    // 아직 아무것도 안 봤다 → 막힌다
    let res = await completeStep(order.id, makerCookie);
    expect(res.status).toBe(409);
    expect(res.body?.error?.code).toBe('CHECKLIST_INCOMPLETE');

    const cl = (await getCl(order.id, makerCookie)).body.data;
    expect(cl.lines).toHaveLength(2);
    expect(cl.actor).toBe('MAKER');

    // 하나만 불합격으로 두면 여전히 막힌다
    await patchCl(order.id, makerCookie, {
      lines: [{ id: cl.lines[0].id, result: 'pass' }, { id: cl.lines[1].id, result: 'fail', memo: '실내등 하나 안 들어옴' }],
    });
    res = await completeStep(order.id, makerCookie);
    expect(res.status, '불합격을 두고 넘어갔다').toBe(409);

    // 고쳐서 재검 합격 → 제출 → 열린다
    const ok = await patchCl(order.id, makerCookie, {
      lines: [{ id: cl.lines[1].id, result: 'pass', memo: '전구 교체 후 재검' }], submit: true,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    res = await completeStep(order.id, makerCookie);
    expect(res.status, `합격인데 막혔다: ${JSON.stringify(res.body)}`).toBe(200);
  }, 60_000);

  it('🔴 불합격 → 조치 → 재검이 항목별로 남는다', async () => {
    await putItems(STEP, [{ category: '시험 전장', content: '실내등 점등' }]);
    const order = await acceptedOrder();
    const cl = (await getCl(order.id, makerCookie)).body.data;
    const lineId = cl.lines[0].id;

    await patchCl(order.id, makerCookie, { lines: [{ id: lineId, result: 'fail', memo: '안 들어옴' }] });
    await patchCl(order.id, makerCookie, { lines: [{ id: lineId, result: 'pass', memo: '전구 교체' }] });

    const after = (await getCl(order.id, makerCookie)).body.data;
    expect(after.lines[0].result).toBe('pass');
    expect(after.lines[0].logs.map((l: { result: string }) => l.result), '마지막 판정만 남았다').toEqual(['fail', 'pass']);
    expect(after.lines[0].logs[0].memo).toBe('안 들어옴');
  }, 30_000);

  it('🔴 서식을 고쳐도 이미 작성한 것은 바뀌지 않는다', async () => {
    await putItems(STEP, [{ category: '시험 외관', content: '적재함 도장 상태' }]);
    const order = await acceptedOrder();
    const before = (await getCl(order.id, makerCookie)).body.data;
    expect(before.lines[0].content).toBe('적재함 도장 상태');

    // 서식을 통째로 바꾼다
    await putItems(STEP, [{ category: '시험 안전', content: '완전히 다른 항목' }]);

    const after = (await getCl(order.id, makerCookie)).body.data;
    expect(after.lines, '작성 중이던 체크리스트가 서식을 따라 바뀌었다').toHaveLength(1);
    expect(after.lines[0].content).toBe('적재함 도장 상태');
  }, 30_000);

  it('🔴 지운 항목은 꺼질 뿐 사라지지 않는다 — 옛 기록이 무엇을 봤는지 되짚을 수 있어야 한다', async () => {
    const first = await putItems(STEP, [{ category: '시험 외관', content: '적재함 도장 상태' }]);
    const id = first.body.data[0].id;
    await putItems(STEP, []);
    const row = await prisma!.checklistItem.findUnique({ where: { id } });
    expect(row, '항목이 지워졌다').not.toBeNull();
    expect(row!.active).toBe(false);
  }, 30_000);

  it('🔴 적는 사람이 정해져 있다 — 인도 체크리스트를 특장사가 적지 못한다', async () => {
    await putItems('delivered', [{ category: '시험 인수', content: '인수증 서명' }]);
    const order = await acceptedOrder();
    const cl = (await getCl(order.id, adminCookie, 'delivered')).body.data;
    expect(cl.actor).toBe('ADMIN');
    const res = await patchCl(order.id, makerCookie, { lines: [{ id: cl.lines[0].id, result: 'pass' }] }, 'delivered');
    expect(res.status, '특장사가 인도 체크리스트를 적었다').toBe(403);
  }, 30_000);

  it('🔴 제출하면 관리자에게 알림이 간다', async () => {
    await putItems(STEP, [{ category: '시험 외관', content: '적재함 도장 상태' }]);
    const order = await acceptedOrder();
    const cl = (await getCl(order.id, makerCookie)).body.data;
    notify.mockClear();
    await patchCl(order.id, makerCookie, { lines: [{ id: cl.lines[0].id, result: 'pass' }], submit: true });

    expect(notify.mock.calls.length, '알림이 가지 않았다').toBeGreaterThan(0);
    const [to, payload] = notify.mock.calls[0] as [string[], { body: string }];
    expect(to, '관리자에게 가지 않았다').toContain(ADMIN);
    expect(to, '적은 본인에게도 갔다').not.toContain(MAKER);
    expect(payload.body).toContain('차량 도착');
  }, 30_000);

  it('🔴 제출한 뒤 불합격이 생기면 제출이 거둬진다', async () => {
    await putItems(STEP, [{ category: '시험 외관', content: '적재함 도장 상태' }]);
    const order = await acceptedOrder();
    const cl = (await getCl(order.id, makerCookie)).body.data;
    await patchCl(order.id, makerCookie, { lines: [{ id: cl.lines[0].id, result: 'pass' }], submit: true });
    expect((await getCl(order.id, makerCookie)).body.data.submitted_at).not.toBeNull();

    await patchCl(order.id, makerCookie, { lines: [{ id: cl.lines[0].id, result: 'fail', memo: '재검에서 걸림' }] });
    const after = (await getCl(order.id, makerCookie)).body.data;
    expect(after.submitted_at, '불합격인데 제출 상태가 남았다').toBeNull();
    const res = await completeStep(order.id, makerCookie);
    expect(res.status).toBe(409);
  }, 30_000);

  it('🔴 서식을 고치는 것은 권한이 있는 관리자만', async () => {
    const res = await request(app).put('/api/v1/checklists')
      .set('Cookie', makerCookie).send({ step: STEP, items: [{ category: 'x', content: 'y' }] });
    expect(res.status).toBe(403);
  }, 30_000);
});
