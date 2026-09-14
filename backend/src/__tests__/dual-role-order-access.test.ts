import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **역할이 둘인 계정은 둘 중 하나라도 근거가 되면 그 주문을 본다.**
 *
 * 사고(2026-09-14, 모바일 PWA 제보): 특장사(브레인특장) 계정에 영업 겸직을 주었더니
 * 특장 화면에서 자기 조직에 배정된 주문을 열면 「주문 상세 로드 실패: 403」.
 * 「영업이면 본인 담당 견적만」 검사가 **특장 역할로 볼 수 있는 주문까지** 막았다.
 * 반대로 영업으로 담당한 주문이 다른 특장사에 배정돼 있으면 「자기 조직만」 검사에 막혔다.
 *
 * 규칙은 단계 화면(steps.loadOrder)이 이미 쓰던 것과 같다 —
 *   · 특장 역할 → 자기 조직에 배정된(또는 자기가 거부한) 주문
 *   · 영업 역할 → 자기가 담당한 견적의 주문
 *   · 둘 다 아니면 403 — 겸직이라고 남의 주문이 열리지는 않는다
 *   · **그 경로가 허용한 역할로만** 근거를 댄다 — 영업 전용 경로(계약서)에 특장 근거로 들어오지 못한다
 *
 * ⚠️ 실제 인증 경로를 탄다. 시험용 우회는 토큰의 주 역할 하나만 보므로 겸직을 재현하지 못한다.
 */
process.env['ALLOW_TEST_AUTH_BYPASS'] = 'false';
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
const DUAL = 'dual-maker-sales@example.invalid';       // 주 역할 특장 + 겸직 영업 (제보 계정과 같은 모양)
const OTHER_SALES = 'dual-other-sales@example.invalid';
const PURE_SALES = 'dual-pure-sales@example.invalid';
const MY_ORG = 'ORG_BRAIN';
const OTHER_ORG = 'ORG_TAEYANG';
const dual = authCookie(DUAL, 'MAKER', MY_ORG);
const pureSales = authCookie(PURE_SALES, 'SALES', 'ORG_HQ');
let customerId = 0;
const madeQuotes: number[] = [];
const USERS = [DUAL, OTHER_SALES, PURE_SALES];

beforeAll(async () => {
  if (!prisma) return;
  const rows: [string, 'MAKER' | 'SALES', ('SALES')[], string][] = [
    [DUAL, 'MAKER', ['SALES'], MY_ORG],
    [OTHER_SALES, 'SALES', [], 'ORG_HQ'],
    [PURE_SALES, 'SALES', [], 'ORG_HQ'],
  ];
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  for (const [email, role, extra, org] of rows) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active', role, extra_roles: extra, org_code: org },
      create: { email, name: '겸직시험', role, extra_roles: extra, org_code: org, active: true, status: 'active', password_hash: 'x', must_change_pw: false },
    });
    for (const m of mods) {
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
        update: { enabled: true },
        create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled: true },
      });
    }
  }
  customerId = (await prisma.customer.create({ data: { name: '겸직_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    // 계약서 경로가 실제로 만든 서류 기록 — 이 시험의 주문 것만
    await prisma.generatedDocument.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: USERS } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
  process.env['ALLOW_TEST_AUTH_BYPASS'] = 'true';
});

/** 주문 하나 — 누가 영업 담당이고 어느 특장사에 배정됐는지 */
async function order(salesBy: string, makerOrg: string | null, extra: { rejected_by_org?: string } = {}) {
  const q = await prisma!.quote.create({
    data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'assigned', customer_id: customerId, final_price: 50_000_000, sales_user_id: salesBy },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return prisma!.order.create({
    data: { quote_id: q.id, maker_org_id: makerOrg, assigned_at: new Date(), ...extra },
    select: { id: true },
  });
}
const get = (path: string, cookie: string) => request(app).get(`/api/v1/orders${path}`).set('Cookie', cookie);

describe.runIf(live)('겸직 계정의 주문 접근', () => {
  it('🔴 제보 재현 — 특장+영업 계정이 자기 조직에 배정된 주문을 연다(남이 영업 담당)', async () => {
    const o = await order(OTHER_SALES, MY_ORG);
    const res = await get(`/${o.id}`, dual);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 특장 근거로 연 것이므로 특장사 화면 — 금액은 싣지 않는다
    expect(res.body.data.quote?.final_price, '특장 근거로 열었는데 실구매가가 나간다').toBeUndefined();
  }, 30_000);

  it('🔴 전자서명(구조변경) 상태도 본다 — 단계를 넘기려면 알아야 한다', async () => {
    const o = await order(OTHER_SALES, MY_ORG);
    expect((await get(`/${o.id}/tuning`, dual)).status).not.toBe(403);
  }, 30_000);

  it('🔴 자기가 거부한 주문도 연다 — 「거부됨」에서 대화하려면', async () => {
    const o = await order(OTHER_SALES, null, { rejected_by_org: MY_ORG });
    expect((await get(`/${o.id}`, dual)).status).toBe(200);
  }, 30_000);

  it('🔴 영업으로 담당한 주문은 다른 특장사에 배정돼 있어도 연다', async () => {
    const o = await order(DUAL, OTHER_ORG);
    const res = await get(`/${o.id}`, dual);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }, 30_000);

  it('🔴 영업 전용 경로(계약서)는 영업 담당 근거로만 — 특장 근거로는 못 들어온다', async () => {
    const mine = await order(DUAL, OTHER_ORG);
    const status = (await request(app).get(`/api/v1/orders/${mine.id}/docs/contract`).set('Cookie', dual)).status;
    expect(status, '자기 담당 고객 계약서가 막힌다').not.toBe(403);
    const makerOnly = await order(OTHER_SALES, MY_ORG);
    expect((await request(app).get(`/api/v1/orders/${makerOnly.id}/docs/contract`).set('Cookie', dual)).status,
      '특장사 근거로 남의 고객 계약서(개인정보)가 열린다').toBe(403);
  }, 60_000);

  it('🔴 특장 전용 경로(하중계산서)는 자기 조직 주문만 — 영업 담당이라고 남의 특장사 서류를 만들지 않는다', async () => {
    const mine = await order(DUAL, OTHER_ORG);
    expect((await get(`/${mine.id}/docs/load-calc`, dual)).status).toBe(403);
  }, 30_000);

  it('🔴 둘 다 아니면 막힌다 — 겸직이라고 남의 주문이 열리지 않는다', async () => {
    const o = await order(OTHER_SALES, OTHER_ORG);
    expect((await get(`/${o.id}`, dual)).status).toBe(403);
    expect((await get(`/${o.id}/tuning`, dual)).status).toBe(403);
    expect((await get(`/${o.id}/steps`, dual)).status).toBe(403);
  }, 30_000);

  it('🔴 영업만 가진 계정은 그대로 — 남의 담당 주문은 막힌다', async () => {
    const o = await order(OTHER_SALES, MY_ORG);
    expect((await get(`/${o.id}`, pureSales)).status).toBe(403);
    expect((await get(`/${o.id}/tuning`, pureSales)).status).toBe(403);
  }, 30_000);

  it('🔴 목록과 상세가 같은 규칙이다 — 목록에 뜬 주문은 전부 열린다', async () => {
    const a = await order(OTHER_SALES, MY_ORG);
    const b = await order(DUAL, OTHER_ORG);
    const c = await order(OTHER_SALES, null, { rejected_by_org: MY_ORG });
    const list = await get('', dual);
    expect(list.status).toBe(200);
    const ids = (list.body.data as { id: number }[]).map(x => x.id);
    for (const o of [a, b, c]) {
      expect(ids, `주문 #${o.id} 가 목록에 없다`).toContain(o.id);
      expect((await get(`/${o.id}`, dual)).status, `목록에 뜬 주문 #${o.id} 가 열리지 않는다`).toBe(200);
    }
  }, 60_000);
});
