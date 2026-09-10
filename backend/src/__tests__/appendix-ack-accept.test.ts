import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 커스텀 주문 수락 — **한 동작은 한 요청이다.**
 *
 * 사고: 화면이 「확인」을 따로 쏘고 **기다리지 않은 채** 곧바로 「수락」을 보냈다.
 * 수락 쪽이 확인 쪽 쓰기보다 먼저 읽어 409 로 튕겼다. 재현해 보니 **6번 중 6번** —
 * 경합이 아니라 사실상 언제나였다. 체크를 했는데도 「확인해야 수락할 수 있습니다」가
 * 떠서 커스텀 주문은 화면에서 받을 방법이 없었다(제보).
 *
 * 그래서 확인 표시를 수락 요청에 실어 보낸다. 여기서 지키는 것은 셋이다 —
 *   ① 확인을 실으면 **한 번에** 수락된다
 *   ② 안 실으면 여전히 막힌다(화면만 믿지 않는다)
 *   ③ 수락된 주문에는 **누가 언제 확인했는지**가 남는다
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');

const app = createApp();
const live = !!prisma;
const ADMIN = 'ackacc-admin@example.invalid';
const MAKER = 'ackacc-maker@example.invalid';
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
      create: { email, name: '수락시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '수락_테스트고객' } });
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

function weekdayDue(): string {
  const d = new Date(Date.now() + 20 * 864e5);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

async function assignCustom(appendix = '적재함 좌측벽 12mm 합판 보강') {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  const res = await request(app).patch(`/api/v1/quotes/${q.id}/assign`)
    .set('Cookie', adminCookie).send({ maker_org_id: MAKER_ORG, custom_badge: true, appendix });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
}

describe.runIf(live)('커스텀 주문 수락', () => {
  it('🔴 확인을 실으면 한 번에 수락된다 — 따로 쏘지 않는다', async () => {
    const order = await assignCustom();
    const res = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue(), appendix_ack: true });
    expect(res.status, `수락이 막혔다: ${JSON.stringify(res.body)}`).toBe(200);

    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.accepted_at, '수락 시각이 없다').toBeTruthy();
    // 확인 기록도 같은 쓰기에 남는다 — 수락은 됐는데 근거만 없는 상태를 만들지 않는다
    expect(after.appendix_ack_at, '확인 기록이 없다').toBeTruthy();
    expect(after.appendix_ack_by).toBe(MAKER);

    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: order.quote_id }, select: { status: true } });
    expect(q.status).toBe('ordered');
  }, 30_000);

  it('🔴 확인을 싣지 않으면 여전히 막힌다 — 화면만 믿지 않는다', async () => {
    const order = await assignCustom();
    const res = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(res.status, `막히지 않았다: ${JSON.stringify(res.body)}`).toBe(409);
    expect(res.body?.error?.code).toBe('APPENDIX_UNREAD');
    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: order.quote_id }, select: { status: true } });
    expect(q.status, '막았다면서 상태는 넘어갔다').toBe('assigned');
  }, 30_000);

  it('🔴 먼저 확인해 둔 주문은 처음 확인 시각을 덮어쓰지 않는다', async () => {
    const order = await assignCustom();
    await request(app).patch(`/api/v1/orders/${order.id}/appendix-ack`).set('Cookie', makerCookie).send({});
    const first = (await prisma!.order.findUniqueOrThrow({ where: { id: order.id } })).appendix_ack_at;
    await new Promise(r => setTimeout(r, 30));
    const res = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue(), appendix_ack: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const after = await prisma!.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.appendix_ack_at?.getTime()).toBe(first?.getTime());
  }, 30_000);

  it('🔴 커스텀 요청사항이 없으면 확인 없이도 수락된다', async () => {
    const order = await assignCustom('   ');
    expect(order.appendix, '공백뿐인 요청사항이 값으로 저장됐다').toBeNull();
    const res = await request(app).patch(`/api/v1/orders/${order.id}/accept`)
      .set('Cookie', makerCookie).send({ delivery_due: weekdayDue() });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }, 30_000);

  it('🔴 화면이 확인을 따로 쏘고 곧바로 수락하지 않는다', () => {
    /*
     * 소스로 못 박는다. 이 사고는 **순서**가 원인이라 API 시험만으로는 다시 들어와도
     * 잡히지 않는다 — 두 요청을 나란히 내는 코드가 돌아오면 여기서 걸린다.
     */
    const ROOT = path.resolve(__dirname, '../../..');
    /* 주석을 걷어내고 본다 — 「예전엔 ackAppendix 를 쐈다」는 설명글에 걸리면 안 된다 */
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const read = (p: string) => strip(readFileSync(path.join(ROOT, p), 'utf8'));
    const modal = read('frontend/src/components/AcceptOrderModal.tsx');
    expect(modal, '수락 화면이 ackAppendix 를 다시 쏘고 있다').not.toMatch(/ackAppendix/);
    expect(modal, '수락에 확인 표시를 실어 보내지 않는다').toMatch(/onAccept\?\.\(due,\s*acked\)/);

    const api = read('frontend/src/api/orders.ts');
    expect(api, 'accept 요청에 appendix_ack 가 실리지 않는다').toMatch(/appendix_ack:\s*appendixAck/);
  });
});
