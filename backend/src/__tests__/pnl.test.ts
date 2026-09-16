import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * **차량 판매건별 손익** — 권한과 「달 가르기」.
 *
 *   ① 돈에 관한 표라 **보는 것부터** 권한을 건다(`pnl.view`), 적는 것은 `pnl.manage`
 *   ② 「입력 필요」에 서는 시점은 **특장사 수락**이다 — 계약만 끝난 건은 아직 만들 차가 없다
 *   ③ 달을 가르는 기준은 **세금계산서 발행일** — 적는 순간 그 달 표로 들어가고 「입력 필요」에서 빠진다
 *   ④ 계약서 금액(공급가액·계약금)은 **굳는다** — 화면에서도 서버에서도 못 고친다
 *   ⑤ 삭제는 줄을 지우지 않는다 — 사유를 남기고 합계에서만 뺀다
 */
process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'false';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');

const app = createApp();
const live = !!prisma;
const KEEPER = 'pnl-keeper@example.invalid';   // pnl.manage 있음
const LOOKER = 'pnl-looker@example.invalid';   // pnl.view 만
const OUTSIDE = 'pnl-none@example.invalid';    // 손익 권한 없음
const USERS = [KEEPER, LOOKER, OUTSIDE];
const keeper = authCookie(KEEPER, 'ADMIN', 'ORG_HQ');
const looker = authCookie(LOOKER, 'ADMIN', 'ORG_HQ');
const outside = authCookie(OUTSIDE, 'ADMIN', 'ORG_HQ');

let customerId = 0;
const quotes: number[] = [];

/** 계약만 끝난 건 — 특장사 수락 전이라 「입력 필요」에 서지 않는다 */
async function contractedQuote(price = 1_000_000): Promise<number> {
  const q = await prisma!.quote.create({
    data: {
      model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted',
      customer_id: customerId, final_price: price,
    },
    select: { id: true },
  });
  quotes.push(q.id);
  return q.id;
}

/** 특장사가 **수락한** 건 — 여기서부터 「입력 필요」다 */
async function acceptedQuote(acceptedAt = new Date()): Promise<number> {
  const id = await contractedQuote();
  await prisma!.quote.update({ where: { id }, data: { status: 'ordered' } });
  await prisma!.order.create({
    data: { quote_id: id, maker_org_id: 'ORG_BRAIN', assigned_at: acceptedAt, accepted_at: acceptedAt },
  });
  return id;
}

beforeAll(async () => {
  if (!prisma) return;
  // 이 시험이 두드리는 곳은 /pnl 뿐이라 **그 둘만** 켠다(다른 모듈까지 쓰면 DB 를 오래 붙잡는다)
  const mods = [{ code: 'pnl.view' }, { code: 'pnl.manage' }];
  for (const email of USERS) {
    await prisma.user.upsert({
      where: { email }, update: { active: true, status: 'active' },
      create: { email, name: '손익시험', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: 'x' },
    });
    for (const m of mods) {
      const enabled = m.code === 'pnl.manage' ? email === KEEPER : email !== OUTSIDE;
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
        update: { enabled }, create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled },
      });
    }
  }
  customerId = (await prisma.customer.create({ data: { name: '손익_시험고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  await prisma.orderPnl.deleteMany({ where: { quote_id: { in: quotes } } });
  await prisma.order.deleteMany({ where: { quote_id: { in: quotes } } });
  await prisma.quote.deleteMany({ where: { id: { in: quotes } } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: USERS } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
  process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'true';
});

describe.runIf(live)('손익 — 권한', () => {
  it('🔴 손익 권한이 없으면 보지도 못한다 — 돈에 관한 표다', async () => {
    expect((await request(app).get('/api/v1/pnl').set('Cookie', outside)).status).toBe(403);
  });

  it('🔴 보기 권한만 있으면 읽되 적지는 못한다', async () => {
    expect((await request(app).get('/api/v1/pnl').set('Cookie', looker)).status).toBe(200);
    const id = await acceptedQuote();
    const w = await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', looker).send({ invoice_on: '2026-09-10' });
    expect(w.status, '보기 권한으로 적혔다').toBe(403);
  }, 30_000);
});

describe.runIf(live)('손익 — 언제부터 「입력 필요」인가', () => {
  it('🔴 계약만 끝난 건은 아직 아니다 — **특장사가 수락해야** 선다', async () => {
    const only = await contractedQuote();
    const before = await request(app).get('/api/v1/pnl').set('Cookie', keeper);
    expect(before.body.data.pending.some((p: { quote_id: number }) => p.quote_id === only), '계약만 끝난 건이 벌써 떴다').toBe(false);

    const accepted = await acceptedQuote();
    const after = await request(app).get('/api/v1/pnl').set('Cookie', keeper);
    expect(after.body.data.pending.some((p: { quote_id: number }) => p.quote_id === accepted), '수락한 건이 안 떴다').toBe(true);
  }, 30_000);

  it('🔴 오래 기다린 것이 맨 위다 — 밀린 건이 아래로 묻히면 안 된다', async () => {
    const old = await acceptedQuote(new Date('2020-01-02T00:00:00Z'));
    const v = await request(app).get('/api/v1/pnl').set('Cookie', keeper);
    expect(v.body.data.pending[0]?.quote_id, '가장 오래 기다린 건이 맨 위가 아니다').toBe(old);
  }, 30_000);
});

describe.runIf(live)('손익 — 세금계산서 발행일이 달을 정한다', () => {
  it('🔴 발행일을 적으면 그 달 표로 들어가고 「입력 필요」에서 빠진다', async () => {
    const id = await acceptedQuote();

    const before = await request(app).get('/api/v1/pnl?month=2026-09').set('Cookie', keeper);
    expect(before.status).toBe(200);
    expect(before.body.data.pending.some((p: { quote_id: number }) => p.quote_id === id), '새 계약이 입력 필요에 없다').toBe(true);

    const put = await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-09-10', capital: 20_450_000 });
    expect(put.status, JSON.stringify(put.body)).toBe(200);

    const sep = await request(app).get('/api/v1/pnl?month=2026-09').set('Cookie', keeper);
    const row = sep.body.data.rows.find((r: { quote_id: number }) => r.quote_id === id);
    expect(row, '9월 표에 없다').toBeTruthy();
    expect(row.capital).toBe(20_450_000);
    expect(sep.body.data.pending.some((p: { quote_id: number }) => p.quote_id === id), '입력 필요에 그대로 남았다').toBe(false);

    // 발행일을 다른 달로 바꾸면 그 달로 옮겨간다
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-10-02' });
    const sep2 = await request(app).get('/api/v1/pnl?month=2026-09').set('Cookie', keeper);
    expect(sep2.body.data.rows.some((r: { quote_id: number }) => r.quote_id === id), '9월에 남아 있다').toBe(false);
    const oct = await request(app).get('/api/v1/pnl?month=2026-10').set('Cookie', keeper);
    expect(oct.body.data.rows.some((r: { quote_id: number }) => r.quote_id === id), '10월로 옮겨오지 않았다').toBe(true);
  }, 60_000);

  it('🔴 발행일을 지우면 「입력 필요」로 돌아온다', async () => {
    const id = await acceptedQuote();
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-09-11' });
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: null });
    const v = await request(app).get('/api/v1/pnl?month=2026-09').set('Cookie', keeper);
    expect(v.body.data.rows.some((r: { quote_id: number }) => r.quote_id === id)).toBe(false);
    expect(v.body.data.pending.some((p: { quote_id: number }) => p.quote_id === id)).toBe(true);
  }, 30_000);

  it('🔴 이상한 달 값은 이번 달로 떨어진다 — 주소창 값을 믿지 않는다', async () => {
    const v = await request(app).get('/api/v1/pnl?month=2026-13').set('Cookie', keeper);
    expect(v.status).toBe(200);
    expect(v.body.data.month).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  }, 30_000);

  it('🔴 적은 값은 그대로 남는다 — 비운 칸은 건드리지 않는다(부분 저장)', async () => {
    const id = await acceptedQuote();
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-09-12', capital: 5_000_000, memo: '확인필요' });
    // 비고만 고친다 — 금액이 0 으로 밀리면 안 된다
    const r = await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ memo: '확인완료' });
    expect(r.body.data.capital).toBe(5_000_000);
    expect(r.body.data.memo).toBe('확인완료');
    expect(r.body.data.invoice_on).toBe('2026-09-12');
  }, 30_000);

  it('🔴 계약서 금액은 굳는다 — 보내도 안 바뀐다(화면에서 빼는 것만으로는 막은 것이 아니다)', async () => {
    const id = await acceptedQuote();
    const made = await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-09-14' });
    const supply = made.body.data.supply_amount as number;
    const deposit = made.body.data.deposit as number;

    const hack = await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper)
      .send({ supply_amount: 1, deposit: 2, biz_name: '바꿔치기' });
    expect(hack.status).toBe(200);
    expect(hack.body.data.supply_amount, '공급가액이 바뀌었다').toBe(supply);
    expect(hack.body.data.deposit, '계약금이 바뀌었다').toBe(deposit);
  }, 30_000);

  it('🔴 삭제는 줄을 지우지 않는다 — 사유를 남기고 합계에서만 뺀다', async () => {
    const id = await acceptedQuote();
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-11-03' });

    // 사유 없이는 못 지운다
    const bare = await request(app).post(`/api/v1/pnl/${id}/void`).set('Cookie', keeper).send({ reason: '   ' });
    expect(bare.status, '사유 없이 지워졌다').toBe(400);

    const dead = await request(app).post(`/api/v1/pnl/${id}/void`).set('Cookie', keeper).send({ reason: '계약 해지 — 차량 반납' });
    expect(dead.status, JSON.stringify(dead.body)).toBe(200);
    expect(dead.body.data.void_reason).toBe('계약 해지 — 차량 반납');

    // 표에는 그대로 있다(지우지 않는다)
    const nov = await request(app).get('/api/v1/pnl?month=2026-11').set('Cookie', keeper);
    const row = nov.body.data.rows.find((r: { quote_id: number }) => r.quote_id === id);
    expect(row, '삭제한 줄이 표에서 사라졌다').toBeTruthy();
    expect(row.voided_at).toBeTruthy();
    expect(row.voided_by).toBeTruthy();

    // 되돌리면 사유 기록이 비워진다
    const back = await request(app).post(`/api/v1/pnl/${id}/unvoid`).set('Cookie', keeper).send({});
    expect(back.body.data.voided_at).toBeNull();
    expect(back.body.data.void_reason).toBeNull();
  }, 30_000);

  it('🔴 보기 권한만으로는 지우지 못한다', async () => {
    const id = await acceptedQuote();
    await request(app).put(`/api/v1/pnl/${id}`).set('Cookie', keeper).send({ invoice_on: '2026-11-04' });
    expect((await request(app).post(`/api/v1/pnl/${id}/void`).set('Cookie', looker).send({ reason: 'x' })).status).toBe(403);
  }, 30_000);

  it('🔴 없는 견적에는 줄을 만들지 않는다', async () => {
    const r = await request(app).put('/api/v1/pnl/99999999').set('Cookie', keeper).send({ invoice_on: '2026-09-13' });
    expect(r.status).toBe(404);
  }, 30_000);
});
