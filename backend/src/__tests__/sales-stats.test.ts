import { describe, it, expect, afterAll } from 'vitest';

/**
 * **영업 성과를 세는 규칙**(2026-09-16 전면 재정비).
 *
 * 세 가지가 실제로 틀려 있었고, 셋 다 화면에서는 그럴듯해 보였다.
 *   ① 배정을 취소해 계약완료로 되돌린 건이 **배정완료에 그대로 남았다**(제보)
 *   ② 한 고객에게 견적을 여러 번 내면 **고객이 여러 명으로** 세어졌다(제보)
 *   ③ 기간을 견적 **만든 날**로 걸러서, 8월에 만들어 9월에 계약한 건이 「9월 계약」에 없었다
 *
 * 숫자는 틀려도 오류가 안 난다. 그래서 여기서 못 박는다.
 */
const { prisma } = await import('../lib/prisma.js');
const { salesStats, salesStatsFull, attentionList } = await import('../services/sales-stats.js');

const live = !!prisma;
const MODEL = 'PV5_OPENBED';
/**
 * **시험마다 계정을 새로 만든다.** 한 계정을 나눠 쓰면 앞 시험이 만든 견적이
 * 뒤 시험의 합계에 섞여, 코드가 멀쩡해도 숫자가 안 맞는다(실제로 두 번 걸렸다).
 */
const USERS: string[] = [];
let seq = 0;
async function user(): Promise<string> {
  const email = `stats-${++seq}-${Date.now()}@example.invalid`;
  USERS.push(email);
  await prisma!.user.create({
    data: { email, name: '성과시험', role: 'SALES', extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: 'x' },
  });
  return email;
}
const quotes: number[] = [];
const customers: number[] = [];

const day = (iso: string) => new Date(`${iso}T03:00:00Z`);   // 한국 정오 — 경계 시비를 피한다

async function customer(name: string, phone?: string): Promise<number> {
  const c = await prisma!.customer.create({ data: { name, ...(phone ? { phone } : {}) } });
  customers.push(c.id);
  return c.id;
}

/** 견적 하나 — 상태·담당·고객·생성일과 전이 이력을 한 번에 심는다 */
async function quote(o: {
  user: string; customerId?: number; status: string; price?: number; createdAt?: Date;
  /** 상태 전이 이력 — [바뀐 상태, 날짜] */
  log?: [string, Date][];
  hidden?: boolean;
}): Promise<number> {
  const q = await prisma!.quote.create({
    data: {
      model_code: MODEL, selections: {}, inputs: {},
      status: o.status as never, sales_user_id: o.user,
      ...(o.customerId ? { customer_id: o.customerId } : {}),
      final_price: o.price ?? 1_000_000,
      ...(o.createdAt ? { created_at: o.createdAt } : {}),
      ...(o.hidden ? { hidden_at: new Date(), hidden_by: 'vitest' } : {}),
    },
    select: { id: true },
  });
  quotes.push(q.id);
  for (const [status, at] of o.log ?? []) {
    await prisma!.quoteChangeLog.create({
      data: { quote_id: q.id, section: 'status', field: 'status', new_value: status, changed_by: 'vitest', changed_at: at },
    });
  }
  return q.id;
}

afterAll(async () => {
  if (!prisma) return;
  await prisma.quoteChangeLog.deleteMany({ where: { quote_id: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
});

describe.runIf(live)('영업 성과 집계', () => {
  it('🔴 배정을 취소해 계약완료로 돌아온 건은 배정완료에서 빠진다 — 지금 상태로 센다', async () => {
    const A = await user();
    const c = await customer('성과시험_배정취소');
    await quote({
      user: A, customerId: c, status: 'contracted',
      log: [['contracted', day('2026-09-02')], ['assigned', day('2026-09-03')], ['contracted', day('2026-09-04')]],
    });
    const [st] = await salesStats({ salesUser: A });
    expect(st!.reached.assigned, '되돌린 건이 배정완료에 남았다').toBe(0);
    expect(st!.reached.contracted).toBe(1);
  }, 30_000);

  it('🔴 한 고객에게 여러 건을 내도 견적완료 고객은 1명 — 건수는 그대로 센다', async () => {
    const B = await user();
    const c = await customer('성과시험_한고객여러건');
    for (const n of [1, 2, 3]) {
      await quote({ user: B, customerId: c, status: 'confirmed', price: n * 1_000_000, log: [['confirmed', day('2026-09-05')]] });
    }
    const [st] = await salesStats({ salesUser: B });
    expect(st!.reached.confirmed, '건수는 세 건이어야 한다').toBe(3);
    expect(st!.customers.confirmed, '고객은 한 명이어야 한다').toBe(1);
    expect(st!.customers.draft, '상담고객도 한 명').toBe(1);
    // 금액도 고객당 한 건 — 같은 차를 세 번 견적내면 세 배가 되면 안 된다
    expect(st!.amount.confirmed).toBe(3_000_000);
  }, 30_000);

  it('🔴 같은 사람인데 고객 행이 둘이면 한 명으로 묶는다 — 서류함과 같은 규칙', async () => {
    const A = await user();
    const one = await customer('성과시험_중복인물', '010-7777-0001');
    const two = await customer('성과시험_중복인물', '010-7777-0001');
    await quote({ user: A, customerId: one, status: 'confirmed', log: [['confirmed', day('2026-09-06')]] });
    await quote({ user: A, customerId: two, status: 'confirmed', log: [['confirmed', day('2026-09-06')]] });
    const [st] = await salesStats({ salesUser: A });
    expect(st!.customers.confirmed, '고객 행이 둘이라고 두 명으로 세면 안 된다').toBe(1);
  }, 30_000);

  it('🔴 기간은 「그 단계에 도달한 날」로 가른다 — 지난달 만들어 이번 달 계약한 건', async () => {
    const B = await user();
    const c = await customer('성과시험_기간');
    await quote({
      user: B, customerId: c, status: 'contracted', createdAt: day('2026-08-20'),
      log: [['confirmed', day('2026-08-21')], ['contracted', day('2026-09-10')]],
    });
    const sep = { salesUser: B, from: day('2026-09-01'), to: new Date('2026-09-30T23:59:59.999+09:00') };
    const [st] = await salesStats(sep);
    expect(st!.reached.contracted, '9월에 계약한 건이 9월 집계에 없다').toBe(1);
    expect(st!.reached.draft, '8월에 만든 견적은 9월 활동이 아니다').toBe(0);
    expect(st!.customers.contracted).toBe(1);
  }, 30_000);

  it('🔴 이름 없는 임시저장은 상담고객이 아니다 — 건수로만 센다', async () => {
    const A = await user();
    await quote({ user: A, status: 'draft' });
    await quote({ user: A, status: 'draft' });
    const [st] = await salesStats({ salesUser: A });
    expect(st!.reached.draft, '견적 두 건은 두 건').toBe(2);
    expect(st!.customers.draft, '고객 정보가 없는데 두 명을 만난 것이 된다').toBe(0);
  }, 30_000);

  it('🔴 전이 이력이 없는 옛 건 — 끝이 열린 기간이면 만든 날로 갈음하고, 지난 달을 볼 땐 세지 않는다', async () => {
    const A = await user();
    const c = await customer('성과시험_이력없음');
    const madeToday = new Date();
    await quote({ user: A, customerId: c, status: 'contracted', createdAt: madeToday });   // 상태 전이 이력 없음

    const from = new Date(madeToday.getFullYear(), madeToday.getMonth(), 1);
    const open = await salesStats({ salesUser: A, from });
    expect(open[0]!.reached.contracted, '계약완료인데 이번 달 계약이 0 이 된다').toBe(1);

    // 끝이 닫힌 지난 기간 — 언제 계약했는지 모르므로 지어내지 않는다
    const closed = await salesStats({ salesUser: A, from: day('2026-01-01'), to: day('2026-01-31') });
    expect(closed[0]?.reached.contracted ?? 0).toBe(0);
  }, 30_000);

  it('🔴 전체 합계는 서버가 낸다 — 한 고객을 둘이 맡아도 두 명이 되지 않는다', async () => {
    const A = await user();
    const B = await user();
    const c = await customer('성과시험_공동고객');
    const totalCustomers = async () => (await salesStatsFull({})).total.customers.confirmed;

    const before = await totalCustomers();
    await quote({ user: A, customerId: c, status: 'confirmed', log: [['confirmed', day('2026-09-07')]] });
    expect(await totalCustomers(), '새 고객 한 명이 늘어야 한다').toBe(before + 1);

    // 같은 고객을 다른 영업도 맡았다 — 계정별로는 각자 1명이지만 **합계는 그대로 1명**이다
    await quote({ user: B, customerId: c, status: 'confirmed', log: [['confirmed', day('2026-09-07')]] });
    expect(await totalCustomers(), '합계를 더해서 만들면 한 사람이 두 명이 된다').toBe(before + 1);

    const { rows } = await salesStatsFull({});
    const mine = rows.filter(r => r.sales_user_id === A || r.sales_user_id === B);
    expect(mine.map(r => r.customers.confirmed), '계정별로는 각자 한 명').toEqual([1, 1]);
  }, 30_000);

  it('🔴 숨긴 견적은 성과에도, 「처리 필요 견적」에도 나오지 않는다', async () => {
    const A = await user();
    const c = await customer('성과시험_숨김');
    await quote({ user: A, customerId: c, status: 'draft', createdAt: day('2026-01-02'), hidden: true });
    const [st] = await salesStats({ salesUser: A, from: day('2026-01-01'), to: day('2026-01-31') });
    expect(st?.reached.draft ?? 0, '숨긴 견적이 성과에 잡혔다').toBe(0);
    const att = await attentionList(A);
    expect(att.some(x => x.customer === '성과시험_숨김'), '숨긴 견적이 오늘 할 일에 떴다').toBe(false);
  }, 30_000);
});
