import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 발주서 **임시저장** — 실제 API 로 밟아 본다.
 *
 * 이 기능이 있는 이유는 하나다: **적는 사람과 배정을 누르는 사람이 다를 수 있다.**
 * 그러니 여기서 볼 것도 하나다 — A 가 적어 둔 것을 **B 가 그대로 이어 받는가.**
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

const A = 'pod-a@example.invalid';          // 발주서를 적는 관리자
const B = 'pod-b@example.invalid';          // 배정을 누르는 관리자
const MAKER_ORG = 'ORG_BRAIN';
const cookieA = authCookie(A, 'ADMIN', 'ORG_HQ');
const cookieB = authCookie(B, 'ADMIN', 'ORG_HQ');

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
  for (const email of [A, B]) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '임시저장시험', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '임시저장_테스트고객' } });
  customerId = c.id;
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.poDraft.deleteMany({ where: { quote_id: { in: madeQuotes } } });
  for (const id of madeQuotes) {
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [A, B] } } });
  await prisma.user.deleteMany({ where: { email: { in: [A, B] } } });
});

async function newQuote(status: 'contracted' | 'confirmed' = 'contracted'): Promise<number> {
  const q = await prisma!.quote.create({
    data: {
      model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status,
      customer_id: customerId, final_price: 50_000_000,
    },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return q.id;
}

describe.runIf(live)('발주서 임시저장', () => {
  it('🔴 A 가 적어 두면 B 가 그대로 이어 받는다', async () => {
    const quoteId = await newQuote();
    const body = {
      maker_org_id: MAKER_ORG, custom_badge: true,
      appendix: '적재함 좌측벽 12mm 합판 보강', remark: '이건 커스텀이라 무시된다',
    };
    const saved = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA).send(body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const seen = await request(app).get(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieB);
    expect(seen.status).toBe(200);
    expect(seen.body?.data?.maker_org_id).toBe(MAKER_ORG);
    expect(seen.body?.data?.appendix).toBe('적재함 좌측벽 12mm 합판 보강');
    expect(seen.body?.data?.custom_badge).toBe(true);
    // **누가 적어 뒀는지** — 이어 받는 사람이 물어볼 데가 있어야 한다
    expect(seen.body?.data?.saved_by).toBe(A);
  }, 30_000);

  it('🔴 배정하면 초안은 다시 뜨지 않는다 — 지우지는 않는다', async () => {
    const quoteId = await newQuote();
    await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: MAKER_ORG, custom_badge: true, appendix: '측면 도어 폭 1200mm' });

    const assigned = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', cookieB)
      .send({ maker_org_id: MAKER_ORG, custom_badge: true, appendix: '측면 도어 폭 1200mm' });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);

    // 다시 뜨지 않는다 — 되살아나면 이미 한 번 쓴 내용을 또 채운다
    const after = await request(app).get(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieB);
    expect(after.body?.data).toBeNull();

    // ⚠️ 그래도 **행은 남는다** — 누가 적어 둔 것이 배정으로 이어졌는지가 기록이다
    const row = await prisma!.poDraft.findUniqueOrThrow({ where: { quote_id: quoteId } });
    expect(row.saved_by).toBe(A);
    expect(row.consumed_at, '초안을 지워 버렸다').toBeTruthy();
  }, 30_000);

  it('🔴 특장사를 아직 못 골라도 적어 둘 수 있다', async () => {
    /*
     * 고르는 것은 **배정**의 조건이지 적어 두는 것의 조건이 아니다. 여기서 막으면
     * 「누구에게 맡길지는 나중에 정하고 내용부터 적어 두는」 쓰임이 통째로 사라진다.
     */
    const quoteId = await newQuote();
    const res = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: null, custom_badge: false, remark: '납기 협의 요망' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body?.data?.maker_org_id).toBeNull();
    expect(res.body?.data?.remark).toBe('납기 협의 요망');
  }, 30_000);

  it('🔴 길이는 배정과 **같은 규칙**으로 자른다', async () => {
    /*
     * 여기서 안 자르면 임시저장에는 들어갔는데 배정할 때 잘려,
     * 적어 둔 사람과 배정하는 사람이 **다른 글을 본다.**
     */
    const quoteId = await newQuote();
    const huge = Array.from({ length: 60 }, (_, i) => `${i + 1}행 ${'가'.repeat(80)}`).join('\n');
    const res = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: MAKER_ORG, custom_badge: true, appendix: huge });
    const lines = (res.body?.data?.appendix ?? '').split('\n');
    expect(lines.length).toBe(30);
    expect(Math.max(...lines.map((l: string) => l.length))).toBe(40);
  }, 30_000);

  it('🔴 커스텀이 아니면 별지는 담기지 않는다 — 배정과 같은 판단', async () => {
    const quoteId = await newQuote();
    const res = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: MAKER_ORG, custom_badge: false, appendix: '들어가면 안 된다' });
    expect(res.body?.data?.appendix).toBeNull();
  }, 30_000);

  it('🔴 이미 배정된 건에는 적어 둘 수 없다', async () => {
    // 발주서는 이미 나갔다 — 고칠 곳은 초안이 아니다
    const quoteId = await newQuote();
    await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', cookieB).send({ maker_org_id: MAKER_ORG });
    const res = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: MAKER_ORG, custom_badge: false, remark: '늦었다' });
    expect(res.status).toBe(409);
  }, 30_000);

  it('🔴 나중 저장이 남는다 — 둘이 같이 적으면 마지막이 이긴다', async () => {
    const quoteId = await newQuote();
    await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieA)
      .send({ maker_org_id: MAKER_ORG, custom_badge: false, remark: 'A 가 적음' });
    const second = await request(app).put(`/api/v1/quotes/${quoteId}/po-draft`).set('Cookie', cookieB)
      .send({ maker_org_id: MAKER_ORG, custom_badge: false, remark: 'B 가 고침' });
    expect(second.status).toBe(200);
    expect(second.body?.data?.remark).toBe('B 가 고침');
    expect(second.body?.data?.saved_by, '누가 마지막에 적었는지가 안 남는다').toBe(B);
    // 견적 하나에 초안 하나 — 여럿이면 무엇이 최신인지 알 수 없다
    expect(await prisma!.poDraft.count({ where: { quote_id: quoteId } })).toBe(1);
  }, 30_000);
});
