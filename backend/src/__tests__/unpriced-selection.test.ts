import { describe, it, expect, beforeAll, vi } from 'vitest';

/**
 * **단가가 없는 사양은 0원이 아니다.**
 *
 * 예전에는 `priceMap[code] ?? 0` 이라 단가표에 **행이 없는** 사양도 0원으로 계산돼
 * 견적이 그대로 저장됐다. 실제로 운영 DB 에는 미닫이(`DOPT_*_COUPANG`)와
 * 저상 스포일러(`SPL_LOW`) 행이 없어, 고르면 그 값이 **0원으로 고객에게 나가고 있었다.**
 *
 * 0원과 「정해지지 않음」은 다른 말이다. 0원은 0으로 정해 둔 것이고(계약상 무상 등),
 * 행이 없는 것은 아직 아무도 값을 정하지 않은 것이다. 앞은 팔 수 있고 뒤는 팔 수 없다.
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
const { authCookie, ensureFixtureUsers } = await import('./helpers.js');

const app = createApp();
const live = !!prisma;
const SALES = 'unpriced-sales@example.invalid';
const COOKIE = authCookie(SALES, 'SALES', 'ORG_HQ');

/** 미닫이만 다르고 나머지는 값이 다 있는 선택 */
const BASE = {
  TRIM: 'TRIM_PLUS', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW',
  DOORTYPE: 'DOOR_SLIDE', DOORADD: 'ADD_NONE', TEMP: 'TEMP_O', PARTITION: 'PART_NET',
};
const CUSTOMER = { biz_type: 'individual', is_sosang: true, region: '경기 남양주시' };

/** 이 시험이 「없다」고 보는 단가를 실제로 없애 둔다 — 로컬 시드에는 0원 행이 있다 */
let removed: { model_code: string; value_code: string; supply_price: number; memo: string | null }[] = [];
const GONE = 'DOPT_REEFER_LOW_COUPANG';

beforeAll(async () => {
  if (!prisma) return;
  await ensureFixtureUsers({ email: SALES, role: 'SALES', org_code: 'ORG_HQ' });
  const rows = await prisma.optionPrice.findMany({ where: { value_code: GONE } });
  removed = rows.map(r => ({
    model_code: r.model_code, value_code: r.value_code,
    supply_price: Number(r.supply_price), memo: r.memo,
  }));
  await prisma.optionPrice.deleteMany({ where: { value_code: GONE } });
});

/*
 * ⚠️ 지운 행은 되돌린다 — 시험이 남의 단가표를 바꿔 놓고 끝나면 안 된다.
 *    (afterAll 이 아니라 마지막 시험에서 되돌리면 중간에 실패했을 때 남는다)
 */
import { afterAll } from 'vitest';
afterAll(async () => {
  if (!prisma || !removed.length) return;
  for (const r of removed) {
    await prisma.optionPrice.upsert({
      where: { model_code_value_code: { model_code: r.model_code, value_code: r.value_code } },
      update: { supply_price: r.supply_price, memo: r.memo },
      create: r,
    });
  }
});

describe.runIf(live)('단가가 없는 사양', () => {
  it('🔴 계산이 거부된다 — 0원으로 계산되지 않는다', async () => {
    const res = await request(app).post('/api/v1/quotes/calculate').set('Cookie', COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: { ...BASE, DOORTYPE: 'DOOR_COUPANG' }, customer: CUSTOMER });
    expect(res.status, `0원으로 계산됐다: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(422);
    expect(res.body?.error?.code).toBe('UNSUPPORTED');
  }, 30_000);

  it('🔴 저장도 거부된다 — 화면과 저장이 같은 답을 낸다', async () => {
    /*
     * 계산만 막고 저장을 열어 두면 API 를 직접 불러 0원짜리 견적이 남는다.
     * 그 견적은 견적서·계약서까지 그 금액으로 나간다.
     */
    const res = await request(app).post('/api/v1/quotes').set('Cookie', COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: { ...BASE, DOORTYPE: 'DOOR_COUPANG' }, customer: CUSTOMER });
    expect(res.status, `0원짜리 견적이 저장됐다: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(422);
    expect(res.body?.error?.code).toBe('UNSUPPORTED');
  }, 30_000);

  it('🔴 무엇을 고쳐야 하는지 **이름으로** 말한다', async () => {
    // 「DOPT_REEFER_LOW_COUPANG 단가 없음」은 영업이 읽고 고칠 수 없는 말이다
    const res = await request(app).post('/api/v1/quotes/calculate').set('Cookie', COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: { ...BASE, DOORTYPE: 'DOOR_COUPANG' }, customer: CUSTOMER });
    const msg = String(res.body?.error?.message ?? '');
    expect(msg, msg).toContain('미닫이');
    expect(msg, '내부 코드가 그대로 나갔다').not.toMatch(/DOPT_|SPL_|PART_/);
  }, 30_000);

  it('🔴 0원으로 **정해 둔** 사양은 통과한다 — 없는 것과 다르다', async () => {
    /*
     * 계약상 무상인 항목은 0원 행으로 적혀 있다. 그것까지 막으면
     * 팔 수 있는 사양이 팔 수 없게 된다.
     */
    const zero = 'DADD_REEFER_LOW_SLIDE';
    const before = await prisma!.optionPrice.findFirst({ where: { value_code: zero } });
    await prisma!.optionPrice.update({
      where: { model_code_value_code: { model_code: 'PV5_OPENBED', value_code: zero } },
      data: { supply_price: 0 },
    });
    const res = await request(app).post('/api/v1/quotes/calculate').set('Cookie', COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: { ...BASE, DOORADD: 'ADD_DRIVER' }, customer: CUSTOMER });
    await prisma!.optionPrice.update({
      where: { model_code_value_code: { model_code: 'PV5_OPENBED', value_code: zero } },
      data: { supply_price: Number(before!.supply_price) },
    });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  }, 30_000);

  it('값이 다 있는 선택은 그대로 통과한다', async () => {
    const res = await request(app).post('/api/v1/quotes/calculate').set('Cookie', COOKIE)
      .send({ model_code: 'PV5_OPENBED', year: 2026, selections: BASE, customer: CUSTOMER });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(res.body?.data?.status).toBe('ok');
  }, 30_000);
});
