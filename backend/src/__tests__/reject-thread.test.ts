import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 거부한 특장사와 **계속 이야기한다** · 대화는 **특장사별로** 가른다.
 *
 * 20영업일 안에 못 맞추는 건은 특장사가 거부하고, 대화로 날짜를 맞춘 뒤 다시 배정한다
 * (지시: 2026-09-11). 여기서 지키는 것.
 *   ① 거부해도 그 특장사에게서 **사라지지 않는다** — 「거부됨」으로 남고 대화할 수 있다
 *   ② 거부한 특장사는 **발주 협의에만** 쓴다(단계를 누르거나 단계 자리에 쓰지 못한다)
 *   ③ 같은 특장사로 재배정하면 **수락 대기**로 돌아오고 대화가 이어진다
 *   ④ 다른 특장사로 재배정하면 앞 특장사에게서 **사라지고**, 새 특장사는 앞 대화를 **못 본다**
 *   ⑤ 수락 전에는 쓸 자리가 발주 협의 하나뿐이다
 *   ⑥ 거부된 건의 대화 알림은 **거부한 특장사**에게 간다
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
const ADMIN = 'rt-admin@example.invalid';
const BRAIN = 'rt-brain@example.invalid';
const TAEYANG = 'rt-taeyang@example.invalid';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const brainCookie = authCookie(BRAIN, 'MAKER', 'ORG_BRAIN');
const taeyangCookie = authCookie(TAEYANG, 'MAKER', 'ORG_TAEYANG');
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
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [BRAIN, 'MAKER', 'ORG_BRAIN'], [TAEYANG, 'MAKER', 'ORG_TAEYANG']] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '거부대화시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  customerId = (await prisma.customer.create({ data: { name: '거부대화_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepRead.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.poDraft.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, BRAIN, TAEYANG] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, BRAIN, TAEYANG] } } });
});

/** 브레인에 배정된 주문 */
async function assignedToBrain() {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  const a = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: 'ORG_BRAIN' });
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
  return { qid: q.id, oid: order.id };
}
const say = (oid: number, cookie: string, body: string, step = 'po') =>
  request(app).post(`/api/v1/orders/${oid}/steps/${step}/comments`).set('Cookie', cookie).field('body', body);
const thread = (oid: number, cookie: string) =>
  request(app).get(`/api/v1/orders/${oid}/step-comments`).set('Cookie', cookie);
const list = async (cookie: string) =>
  ((await request(app).get('/api/v1/orders').set('Cookie', cookie)).body.data as { id: number }[]).map(o => o.id);
const reject = (oid: number) =>
  request(app).patch(`/api/v1/orders/${oid}/reject`).set('Cookie', brainCookie).send({ reason: '10/13 까지만 가능' });

describe.runIf(live)('거부한 특장사와의 대화', () => {
  it('🔴 수락 전에도 대화할 수 있다 — 자리는 발주 협의 하나뿐', async () => {
    const { oid } = await assignedToBrain();
    const t = await thread(oid, brainCookie);
    expect(t.status).toBe(200);
    expect(t.body.data.steps.map((s: { code: string }) => s.code), '수락 전인데 진행 단계가 열려 있다').toEqual(['po']);
    expect((await say(oid, brainCookie, '납기 협의 필요합니다')).status).toBe(201);
  }, 30_000);

  it('🔴 거부해도 사라지지 않는다 — 「거부됨」으로 남고 이야기를 이어간다', async () => {
    const { qid, oid } = await assignedToBrain();
    expect((await reject(oid)).status).toBe(200);

    // 견적은 배정 대기로 돌아갔다
    expect((await prisma!.quote.findUniqueOrThrow({ where: { id: qid } })).status).toBe('contracted');

    // 그래도 브레인 목록에 남는다
    expect(await list(brainCookie), '거부하자 목록에서 사라졌다').toContain(oid);
    const d = await request(app).get(`/api/v1/orders/${oid}`).set('Cookie', brainCookie);
    expect(d.status, '거부한 발주서를 다시 볼 수 없다').toBe(200);
    expect(d.body.data.rejected).toBe(true);
    expect(d.body.data.reject_reason).toBe('10/13 까지만 가능');

    // 관리자가 묻고 브레인이 답한다
    expect((await say(oid, adminCookie, '10/13 으로 맞춰 재배정할까요?')).status).toBe(201);
    expect((await say(oid, brainCookie, '네 그 날짜면 됩니다')).status, '거부한 특장사가 답하지 못한다').toBe(201);
  }, 30_000);

  it('🔴 거부된 건은 **거부한 곳에만** 보인다 — 다른 특장사는 못 본다', async () => {
    /*
     * 거부하면 `maker_org_id` 가 비어 「누구의 것도 아닌」 건이 된다. 거기서 「비어 있으면
     * 보여 준다」로 풀면 **다른 특장사가 거부한 발주서와 대화까지** 다 보인다(되돌려 봐서 알았다).
     */
    const { oid } = await assignedToBrain();
    await say(oid, brainCookie, '브레인만의 사정');
    await reject(oid);
    expect(await list(taeyangCookie), '다른 특장사가 거부한 건이 보인다').not.toContain(oid);
    expect((await request(app).get(`/api/v1/orders/${oid}`).set('Cookie', taeyangCookie)).status).toBe(403);
    expect((await thread(oid, taeyangCookie)).status, '다른 특장사가 거부된 건의 대화를 본다').toBe(403);
  }, 30_000);

  it('🔴 거부한 특장사는 발주 협의에만 쓴다 — 단계를 건드리지 못한다', async () => {
    const { oid } = await assignedToBrain();
    await reject(oid);
    const res = await say(oid, brainCookie, '단계 자리에 쓰기', 'car_arrived');
    expect(res.status, '거부된 건의 단계 자리에 글이 붙었다').toBe(409);
    const step = await request(app).patch(`/api/v1/orders/${oid}/steps/build_started`).set('Cookie', brainCookie).send({});
    expect(step.status, '거부한 특장사가 단계를 눌렀다').toBe(403);
  }, 30_000);

  it('🔴 거부된 건의 대화 알림은 거부한 특장사에게 간다', async () => {
    const { oid } = await assignedToBrain();
    await reject(oid);
    await say(oid, adminCookie, '날짜 다시 알려 주세요');
    await new Promise(r => setTimeout(r, 400));    // 알림은 기다리지 않고 보낸다
    /*
     * ⚠️ **이 주문의 알림만** 본다. 알림은 기다리지 않고 나가서, 앞 시험에서 보낸 것이
     *    늦게 도착해 섞였다 — 그래서 알림 대상을 잘못 골라도 이 시험이 통과했다(되돌려 봐서 알았다).
     */
    const mine = notify.mock.calls.filter(c => String((c[1] as { url?: string }).url ?? '').includes(`order=${oid}&`));
    expect(mine.length, '이 주문의 대화 알림이 없다').toBeGreaterThan(0);
    const to = mine.flatMap(c => c[0] as string[]);
    expect(to, '거부한 특장사가 관리자 질문을 모른다').toContain(BRAIN);
    /*
     * 다른 특장사는 받지 않는다 — **기능모듈을 다 켜 둔 특장사라도.** 「배정 알림」 모듈이
     * 켜진 특장사가 관리자로 취급돼 남의 대화 알림을 받던 구멍이 있었다.
     */
    expect(to, '다른 특장사가 이 대화 알림을 받았다').not.toContain(TAEYANG);
  }, 30_000);

  it('🔴 같은 특장사로 재배정하면 수락 대기로 돌아오고 대화가 이어진다', async () => {
    const { qid, oid } = await assignedToBrain();
    await say(oid, brainCookie, '거부 전 한마디');
    await reject(oid);
    await say(oid, adminCookie, '재배정합니다');

    const again = await request(app).patch(`/api/v1/quotes/${qid}/assign`).set('Cookie', adminCookie).send({ maker_org_id: 'ORG_BRAIN' });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await prisma!.quote.findUniqueOrThrow({ where: { id: qid } })).status).toBe('assigned');

    const bodies = (await thread(oid, brainCookie)).body.data.comments.map((c: { body: string }) => c.body);
    expect(bodies, '재배정하자 앞의 대화가 끊겼다').toEqual(['거부 전 한마디', '재배정합니다']);
  }, 30_000);

  it('🔴 다른 특장사로 재배정하면 — 앞 특장사에게서 사라지고, 새 특장사는 앞 대화를 못 본다', async () => {
    const { qid, oid } = await assignedToBrain();
    await say(oid, brainCookie, '브레인 단가 사정 이야기');
    await reject(oid);

    const other = await request(app).patch(`/api/v1/quotes/${qid}/assign`).set('Cookie', adminCookie).send({ maker_org_id: 'ORG_TAEYANG' });
    expect(other.status, JSON.stringify(other.body)).toBe(200);

    // 브레인에게서 사라진다
    expect(await list(brainCookie), '다른 곳으로 넘어갔는데 브레인에게 남아 있다').not.toContain(oid);
    expect((await request(app).get(`/api/v1/orders/${oid}`).set('Cookie', brainCookie)).status).toBe(403);
    expect((await thread(oid, brainCookie)).status, '넘어간 건의 대화를 계속 본다').toBe(403);

    // 태양은 브레인과의 대화를 못 본다
    await say(oid, taeyangCookie, '태양입니다');
    const tBodies = (await thread(oid, taeyangCookie)).body.data.comments.map((c: { body: string }) => c.body);
    expect(tBodies, '새 특장사에게 앞 특장사 대화가 보인다').toEqual(['태양입니다']);

    // 관리자는 둘 다 본다
    const aBodies = (await thread(oid, adminCookie)).body.data.comments.map((c: { body: string }) => c.body);
    expect(aBodies).toEqual(['브레인 단가 사정 이야기', '태양입니다']);
  }, 40_000);

  it('🔴 수락하면 발주 협의가 대화 탭 맨 앞에 남고 진행 단계가 열린다', async () => {
    const { oid } = await assignedToBrain();
    await say(oid, brainCookie, '협의 내용');
    await prisma!.order.update({ where: { id: oid }, data: { accepted_at: new Date() } });
    const t = (await thread(oid, brainCookie)).body.data;
    expect(t.steps[0].code).toBe('po');
    expect(t.steps.length, '수락했는데 진행 단계가 안 열렸다').toBeGreaterThan(1);
    expect(t.comments.map((c: { body: string }) => c.body)).toContain('협의 내용');
  }, 30_000);
});
