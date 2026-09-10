import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 특장사가 거부한 뒤 — **다시 배정할 수 있어야 하고, 적은 것이 남아야 한다.**
 *
 * 사고: `order.quote_id` 가 유일한데 거부해도 그 **행은 남는다**(배정만 풀린다).
 * 그래서 다시 배정하면 유일 제약에 부딪혀 「이미 배정된 견적입니다」로 막혔다 —
 * **재배정이 아예 안 됐다.** 실제로 확인하고 고쳤다.
 *
 * 그리고 발주서를 처음부터 다시 적게 하면 커스텀 요청사항과 계약에 없는 항목의
 * 금액을 똑같이 두 번 적는다(제보). 고칠 수는 있어야 하되 다시 적을 일은 없어야 한다.
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
const ADMIN = 'ra-admin@example.invalid';
const MAKER = 'ra-maker@example.invalid';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', 'ORG_BRAIN');
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
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN']] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '재배정시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  customerId = (await prisma.customer.create({ data: { name: '재배정_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.poDraft.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER] } } });
});

async function contracted() {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 50_000_000 },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return q.id;
}
const assign = (qid: number, body: object) =>
  request(app).patch(`/api/v1/quotes/${qid}/assign`).set('Cookie', adminCookie).send(body);
const reject = (oid: number, reason: string) =>
  request(app).patch(`/api/v1/orders/${oid}/reject`).set('Cookie', makerCookie).send({ reason });
const draft = (qid: number) =>
  request(app).get(`/api/v1/quotes/${qid}/po-draft`).set('Cookie', adminCookie);

const APX = '적재함 좌측벽 12mm 합판 보강';

describe.runIf(live)('거부 뒤 재배정', () => {
  it('🔴 다시 배정할 수 있다 — 거부한 건이 영영 갇히지 않는다', async () => {
    const qid = await contracted();
    expect((await assign(qid, { maker_org_id: 'ORG_BRAIN' })).status).toBe(200);
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: qid } });
    expect((await reject(order.id, '납기 불가')).status).toBe(200);

    // 견적은 계약완료로 돌아와 다시 배정 대기가 된다
    const q = await prisma!.quote.findUniqueOrThrow({ where: { id: qid }, select: { status: true } });
    expect(q.status).toBe('contracted');

    const again = await assign(qid, { maker_org_id: 'ORG_TAEYANG' });
    expect(again.status, `재배정이 막혔다: ${JSON.stringify(again.body)}`).toBe(200);

    // 행을 새로 만들지 않고 **그 행을 다시 쓴다** — 견적당 주문은 하나다
    const all = await prisma!.order.findMany({ where: { quote_id: qid } });
    expect(all).toHaveLength(1);
    expect(all[0]!.maker_org_id).toBe('ORG_TAEYANG');
    expect(all[0]!.assigned_at).toBeTruthy();
    // 왜 한 번 돌아왔는지는 남는다
    expect(all[0]!.reject_reason).toBe('납기 불가');
  }, 40_000);

  it('🔴 이미 배정된 건을 또 배정하면 여전히 막힌다', async () => {
    const qid = await contracted();
    expect((await assign(qid, { maker_org_id: 'ORG_BRAIN' })).status).toBe(200);
    const again = await assign(qid, { maker_org_id: 'ORG_TAEYANG' });
    expect(again.status, '배정된 건이 또 배정됐다').toBe(409);
    const row = await prisma!.order.findFirstOrThrow({ where: { quote_id: qid } });
    expect(row.maker_org_id, '특장사가 바뀌었다').toBe('ORG_BRAIN');
  }, 40_000);

  it('🔴 적은 발주서 내용이 남는다 — 똑같은 것을 두 번 적지 않는다', async () => {
    const qid = await contracted();
    await assign(qid, { maker_org_id: 'ORG_BRAIN', custom_badge: true, appendix: APX });
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: qid } });
    /*
     * 공급가 표는 배정이 옵션에서 만들어 준다(임의로 줄을 더할 수 없다). 여기서 보려는 것은
     * 「거부돼 돌아왔을 때 그 표가 남는가」이므로, 나간 발주서에 표가 있었던 상태를 만든다.
     */
    await prisma!.order.update({
      where: { id: order.id },
      data: { po_lines: [{ label: '온도기록계 장착', unit: 'EA', qty: 1, amount: 100_000, source: 'MANUAL' }] },
    });
    await reject(order.id, '사양 제작 불가');

    const d = await draft(qid);
    expect(d.status).toBe(200);
    expect(d.body.data, '거부돼 돌아왔는데 이어 적을 것이 없다').not.toBeNull();
    expect(d.body.data.appendix, '커스텀 요청사항을 다시 적어야 한다').toBe(APX);
    expect(d.body.data.custom_badge).toBe(true);
    expect(d.body.data.from_rejected, '초안과 구분되지 않는다').toBe(true);
    expect(d.body.data.reject_reason).toBe('사양 제작 불가');
    // 특장사는 다시 고른다 — 그 특장사가 거부한 건이다
    expect(d.body.data.maker_org_id).toBeNull();
    // 손으로 적은 금액이 남는다
    const lines = d.body.data.po_lines as { label: string; amount: number }[];
    expect(lines.find(l => l.label === '온도기록계 장착')?.amount).toBe(100_000);
  }, 40_000);

  it('🔴 커스텀 건의 비고는 돌려주지 않는다 — 서버가 넣는 안내 문구다', async () => {
    const qid = await contracted();
    await assign(qid, { maker_org_id: 'ORG_BRAIN', custom_badge: true, appendix: APX });
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: qid } });
    expect(order.remark).toContain('커스텀 주문');          // 서버가 넣은 문구
    await reject(order.id, '거부');
    expect((await draft(qid)).body.data.remark, '안내 문구가 비고 칸에 들어갔다').toBe('');
  }, 40_000);

  it('🔴 배정 전에는 이어 적을 것이 없다', async () => {
    const qid = await contracted();
    expect((await draft(qid)).body.data).toBeNull();
  }, 30_000);

  it('🔴 임시저장이 있으면 그것이 먼저다 — 방금 적은 것이 최신이다', async () => {
    const qid = await contracted();
    await assign(qid, { maker_org_id: 'ORG_BRAIN', custom_badge: true, appendix: APX });
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: qid } });
    await reject(order.id, '거부');
    await request(app).put(`/api/v1/quotes/${qid}/po-draft`).set('Cookie', adminCookie)
      .send({ maker_org_id: 'ORG_TAEYANG', remark: '새로 적은 것', custom_badge: false, appendix: '', po_lines: [] });
    const d = await draft(qid);
    expect(d.body.data.remark).toBe('새로 적은 것');
    expect(d.body.data.from_rejected).toBeFalsy();
  }, 40_000);
});
