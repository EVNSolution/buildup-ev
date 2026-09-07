import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **같은 버튼을 동시에 누르면 무슨 일이 벌어지는가.**
 *
 * 상태를 바꾸는 자리는 대부분 「읽고 → 따져 보고 → 쓴다」 순서다. 그 사이에 다른 요청이
 * 끼어들면 둘 다 조건을 통과한다. 사람이 두 번 누르는 일은 흔하고(느려서 다시 누른다),
 * 휴대폰에서는 더 흔하다.
 *
 * 여기서 보는 것은 두 가지다:
 *   · **하나만 성공하는가** — 둘 다 성공하면 같은 일이 두 번 벌어진다
 *   · **실패가 500 이 아닌가** — DB 제약에 부딪힌 500 은 사용자에게 「오류」로만 보인다.
 *     같은 상황이라도 409(이미 처리됨)여야 화면이 옳게 안내한다.
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
const N = 10;                                   // 동시에 누르는 횟수

const ADMIN = 'conc-admin@example.invalid';
const MAKER = 'conc-maker@example.invalid';
const SALES = 'conc-sales@example.invalid';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');

let customerId = 0;
const madeQuotes: number[] = [];

/** 모든 모듈을 켠 관리자 — 권한 때문에 막혀서 「하나만 성공」이 되는 착시를 없앤다 */
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
  for (const [email, role, org] of [[ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN'], [SALES, 'SALES', 'ORG_SALES1']] as const) {
    await prisma.user.upsert({
      where: { email },
      update: { active: true, status: 'active' },
      create: { email, name: '동시성시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    await grantAll(email);
  }
  const c = await prisma.customer.create({ data: { name: '동시성_테스트고객' } });
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
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MAKER, SALES] } } });
  await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MAKER, SALES] } } });
});

async function newQuote(status: 'contracted' | 'assigned', salesUser?: string) {
  const q = await prisma!.quote.create({
    data: {
      model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status,
      customer_id: customerId, final_price: 50_000_000, sales_user_id: salesUser ?? null,
    },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return q.id;
}

/** 응답 상태를 세어 본다 */
function tally(rs: { status: number }[]): Record<number, number> {
  const t: Record<number, number> = {};
  for (const r of rs) t[r.status] = (t[r.status] ?? 0) + 1;
  return t;
}

describe.runIf(live)('같은 버튼을 동시에 누르면', () => {
  it('🔴 제작 배정 — 주문이 하나만 생긴다', async () => {
    const quoteId = await newQuote('contracted');
    const org = await prisma!.org.findFirst({ where: { type: 'MAKER' }, select: { code: true } });
    const results = await Promise.all(Array.from({ length: N }, () =>
      request(app).patch(`/api/v1/quotes/${quoteId}/assign`)
        .set('Cookie', adminCookie).send({ maker_org_id: org?.code ?? 'ORG_BRAIN' })));
    const t = tally(results);
    const orders = await prisma!.order.count({ where: { quote_id: quoteId } });
    console.log('배정=' + JSON.stringify({ 응답: t, 주문수: orders, 본문: results.find(r => r.status >= 400)?.body }));

    expect(orders, `주문이 ${orders}개 생겼다`).toBe(1);
    expect(t[500] ?? 0, `500 이 ${t[500]}개 — DB 제약에 부딪힌 오류가 그대로 나갔다`).toBe(0);
    expect(t[200] ?? 0, '성공이 여러 번').toBeLessThanOrEqual(1);
  }, 30_000);

  it('🔴 주문 수락 — 한 번만 받아진다', async () => {
    const quoteId = await newQuote('assigned');
    const org = await prisma!.org.findFirst({ where: { type: 'MAKER' }, select: { code: true } });
    const order = await prisma!.order.create({
      data: { quote_id: quoteId, maker_org_id: org?.code ?? 'ORG_BRAIN', assigned_at: new Date() },
      select: { id: true },
    });
    /* 주말이면 400 이라 경합을 보기도 전에 막힌다 — 평일로 민다 */
    const d = new Date(Date.now() + 20 * 864e5);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    const due = d.toISOString().slice(0, 10);
    const results = await Promise.all(Array.from({ length: N }, () =>
      request(app).patch(`/api/v1/orders/${order.id}/accept`).set('Cookie', adminCookie).send({ delivery_due: due })));
    const t = tally(results);
    const after = await prisma!.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
    console.log('수락=' + JSON.stringify({ 응답: t, 상태: after?.status, 본문: results.find(r => r.status >= 400)?.body }));

    expect(t[500] ?? 0, '500 이 나갔다').toBe(0);
    expect(after?.status, '수락 뒤 상태가 ordered 가 아니다').toBe('ordered');
    expect(t[200] ?? 0, '수락이 여러 번 성공했다').toBeLessThanOrEqual(1);
  }, 30_000);

  it('🔴 영업 배정 수락 — 한 번만', async () => {
    const quoteId = await newQuote('contracted', SALES);
    const results = await Promise.all(Array.from({ length: N }, () =>
      request(app).patch(`/api/v1/quotes/${quoteId}/accept-sales`)
        .set('Cookie', authCookie(SALES, 'SALES', 'ORG_SALES1')).send({})));
    const t = tally(results);
    const logs = await prisma!.quoteChangeLog.count({ where: { quote_id: quoteId, field: 'sales_accepted_at' } });
    console.log('영업수락=' + JSON.stringify({ 응답: t, 이력행: logs }));
    expect(t[500] ?? 0, '500 이 나갔다').toBe(0);
    expect(t[200] ?? 0, '수락이 여러 번 성공했다').toBeLessThanOrEqual(1);
  }, 30_000);
});

/**
 * **읽고 → 따져 보고 → 쓴다** 를 남겨 두지 않는다.
 *
 * 「이미 했는가」를 읽어서 본 다음 쓰면, 그 사이에 끼어든 요청이 같은 답을 보고 함께 통과한다.
 * 조건을 **쓰는 순간에 함께** 걸어야(`updateMany` + where 에 그 조건) DB 가 한 번만 바꿔 준다.
 */
describe('되돌릴 수 없는 처리는 한 번만', () => {
  it('🔴 「이미 했는지」를 보고 나서 그냥 update 하지 않는다', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const DIR = path.resolve(__dirname, '../routes');
    const FLAGS = ['accepted_at', 'rejected_at', 'canceled_at', 'sales_accepted_at'];
    const bad: string[] = [];

    for (const file of readdirSync(DIR).filter(f => f.endsWith('.ts'))) {
      const src = readFileSync(path.join(DIR, file), 'utf8');
      const ms = [...src.matchAll(/(\w+Router)\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)];
      ms.forEach((m, i) => {
        if (m[2] === 'get') return;
        const body = src.slice(m.index!, i + 1 < ms.length ? ms[i + 1]!.index! : src.length);
        if (body.includes('updateMany')) return;          // 조건부 쓰기 — 안전하다
        for (const flag of FLAGS) {
          if (new RegExp(`if \\([\\w.]*${flag}\\)`).test(body) && /\.update\(/.test(body)) {
            bad.push(`${m[2]!.toUpperCase()} ${m[3]} (${file}) ← ${flag}`);
            break;
          }
        }
      });
    }
    expect(bad, `경합이 남은 곳:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
