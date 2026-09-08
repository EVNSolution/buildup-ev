import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 발주서 **별지** — 배정부터 수락까지 **실제 API 로** 밟아 본다.
 *
 * `po-appendix.test.ts` 는 소스에 규칙이 적혀 있는지를 본다. 그건 「썼는가」이지
 * **「그대로 도는가」가 아니다.** 여기서 보는 것은 하나다 —
 * 별지를 읽지 않은 특장사가 **정말로 수락하지 못하는가.**
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');

const app = createApp();
const live = !!prisma;

const ADMIN = 'apx-admin@example.invalid';
const MAKER = 'apx-maker@example.invalid';
const MAKER_ORG = 'ORG_BRAIN';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', MAKER_ORG);

let customerId = 0;
const madeQuotes: number[] = [];

/** 권한 때문에 막힌 것을 「별지가 막았다」로 잘못 읽지 않도록 모두 켠다 */
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
      create: { email, name: '별지시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '별지_테스트고객' } });
  customerId = c.id;
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
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

/** 배정할 수 있는 견적 하나 — 배정은 계약완료에서만 열린다 */
async function newContractedQuote(): Promise<number> {
  const q = await prisma!.quote.create({
    data: {
      model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted',
      customer_id: customerId, final_price: 50_000_000,
    },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return q.id;
}

/** 납기일 — 주말이면 400 이라 별지를 보기도 전에 막힌다 */
function weekdayDue(): string {
  const d = new Date(Date.now() + 20 * 864e5);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function assign(body: Record<string, unknown>) {
  const quoteId = await newContractedQuote();
  const res = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`)
    .set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG, ...body });
  expect(res.status, `배정 실패: ${JSON.stringify(res.body)}`).toBe(200);
  const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: quoteId } });
  return order;
}

describe.runIf(live)('발주서 별지 — 실제 API', () => {
  it('🔴 별지를 확인하지 않으면 수락되지 않는다', async () => {
    const order = await assign({ custom_badge: true, appendix: '적재함 좌측벽 12mm 합판 보강' });

    const blocked = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(blocked.status, `막히지 않았다: ${JSON.stringify(blocked.body)}`).toBe(409);
    expect(blocked.body?.error?.code).toBe('APPENDIX_UNREAD');

    // 견적 상태가 넘어가지 않았는지 — 409 만 주고 뒤에서 통과시키면 소용없다
    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: order.quote_id }, select: { status: true } });
    expect(q.status, '막았다면서 상태는 넘어갔다').toBe('assigned');

    // 확인을 남기면 열린다
    const ack = await request(app).patch(`/api/v1/orders/${order.id}/appendix-ack`).set('Cookie', makerCookie).send({});
    expect(ack.status, JSON.stringify(ack.body)).toBe(200);

    const ok = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(ok.status, `확인했는데도 막혔다: ${JSON.stringify(ok.body)}`).toBe(200);
  }, 30_000);

  it('🔴 누가 언제 확인했는지가 남는다', async () => {
    const order = await assign({ custom_badge: true, appendix: '냉동기 전원 별도 배선' });
    await request(app).patch(`/api/v1/orders/${order.id}/appendix-ack`).set('Cookie', makerCookie).send({});
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.appendix_ack_at).toBeTruthy();
    expect(after.appendix_ack_by).toBe(MAKER);

    // 다시 눌러도 **처음 확인한 시각**이 남는다 — 기록을 덮어쓰지 않는다
    const first = after.appendix_ack_at;
    await request(app).patch(`/api/v1/orders/${order.id}/appendix-ack`).set('Cookie', makerCookie).send({});
    const again = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(again.appendix_ack_at?.getTime()).toBe(first?.getTime());
  }, 30_000);

  it('🔴 별지가 없으면 그냥 수락된다 — 기존 주문이 갇히지 않는다', async () => {
    /*
     * 이 기능이 생기기 전에 배정된 커스텀 주문은 별지가 없다. 배지만 보고 막으면
     * 그 주문들을 특장사가 영영 받지 못한다.
     */
    const order = await assign({ custom_badge: true, appendix: '   ', remark: '납기 협의 요망' });
    expect(order.custom_badge, '커스텀 배지는 붙어 있다').toBe(true);
    expect(order.appendix, '공백뿐인 별지가 값으로 저장됐다').toBeNull();
    /*
     * 가리킬 곳이 없으면 **가리키지 않는다.** 예전엔 배지만 보고 안내 문구를 넣어,
     * 넘길 장이 없는데 「2페이지(별지)를 확인하세요」만 읽히는 발주서가 나왔다.
     */
    expect(order.remark, '없는 2페이지를 가리키고 있다').toBe('납기 협의 요망');

    const ok = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(ok.status, `별지가 없는데 막혔다: ${JSON.stringify(ok.body)}`).toBe(200);
  }, 30_000);

  it('🔴 커스텀이면 1페이지 비고는 서버가 정한다 — 보낸 값을 믿지 않는다', async () => {
    const order = await assign({ custom_badge: true, appendix: '측면 도어 폭 1200mm', remark: '화면을 거치지 않고 넣은 딴 글' });
    expect(order.remark).toBe('커스텀 주문 건입니다. 2페이지(별지)를 확인하세요.');
    expect(order.appendix).toBe('측면 도어 폭 1200mm');
  }, 30_000);

  it('🔴 커스텀이 아니면 별지는 담기지 않는다', async () => {
    // 배지를 끄면 2페이지는 없는 것이다 — 남으면 읽을 것이 있는 줄 알고 수락이 막힌다
    const order = await assign({ custom_badge: false, appendix: '이건 들어가면 안 된다', remark: '납기 협의 요망' });
    expect(order.appendix).toBeNull();
    expect(order.remark, '커스텀이 아닌데 비고를 덮어썼다').toBe('납기 협의 요망');

    const ok = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  }, 30_000);

  it('🔴 한 장을 넘는 별지는 서버가 자른다 — 화면만 막으면 우회된다', async () => {
    const huge = Array.from({ length: 60 }, (_, i) => `${i + 1}행 ${'가'.repeat(80)}`).join('\n');
    const order = await assign({ custom_badge: true, appendix: huge });
    const lines = (order.appendix ?? '').split('\n');
    expect(lines.length).toBe(30);
    expect(Math.max(...lines.map(l => l.length))).toBe(40);
  }, 30_000);

  it('🔴 남의 조직 주문의 별지는 확인할 수 없다', async () => {
    const order = await assign({ custom_badge: true, appendix: '남의 건' });
    const other = authCookie('apx-other@example.invalid', 'MAKER', 'ORG_TAEYANG');
    const res = await request(app).patch(`/api/v1/orders/${order.id}/appendix-ack`).set('Cookie', other).send({});
    expect(res.status).toBe(403);
  }, 30_000);
});
