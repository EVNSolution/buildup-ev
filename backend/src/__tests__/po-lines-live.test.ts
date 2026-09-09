import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * 발주서 **공급가 표** — 우리가 특장사에 **지급하는** 금액.
 *
 * 고객 견적가(`option_price`)와 다른 축이다. 근거는 특장사별 기본거래계약서 [별첨1] 단가표.
 * 여기서 볼 것은 하나다 — **계약이 정한 값이 계약대로 실리는가.**
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
const ADMIN = 'poline-admin@example.invalid';
const COOKIE = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const MAKER_ORG = 'ORG_BRAIN';

let customerId = 0;
const madeQuotes: number[] = [];

/** 저상 · 냉동 · 슬라이딩 · 그물망 격벽 — 계약 단가표에 다 있는 조합 */
const SEL = {
  TRIM: 'TRIM_PLUS', BODYTYPE: 'BODY_REEFER', TOP: 'TOP_LOW',
  DOORTYPE: 'DOOR_SLIDE', DOORADD: 'ADD_NONE', TEMP: 'TEMP_O', PARTITION: 'PART_NET',
};

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
  await ensureFixtureUsers({ email: ADMIN, role: 'ADMIN', org_code: 'ORG_HQ' });
  await grantAll(ADMIN);
  const c = await prisma.customer.create({ data: { name: '공급가표_테스트고객' } });
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
  await prisma.accessControl.deleteMany({ where: { subject_ref: ADMIN } });
});

async function newQuote(sel: Record<string, string> = SEL): Promise<number> {
  const q = await prisma!.quote.create({
    data: {
      model_code: 'PV5_OPENBED', selections: sel, inputs: {}, status: 'contracted',
      customer_id: customerId, final_price: 50_000_000,
    },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return q.id;
}

type Line = { label: string; unit: string; qty: number; unit_price: number; amount: number; source: string; section: string; ref?: string };
const find = (ls: Line[], label: string) => ls.find(l => l.label === label);

/**
 * 저절로 생긴 줄(계약에 단가가 없는 옵션)의 **금액을 채워** 돌려준다.
 * 하나라도 비어 있으면 서버가 배정을 거부하므로, 그 줄이 관심사가 아닌 시험은 이걸 쓴다.
 */
async function filledAutoLines(quoteId: number, price = 100_000): Promise<Line[]> {
  const res = await request(app)
    .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
  return (res.body.data.po_lines as Line[])
    .filter(l => l.source === 'AUTO')
    .map(l => ({ ...l, unit_price: price, amount: price * l.qty }));
}

describe.runIf(live)('발주서 공급가 표', () => {
  it('🔴 계약 단가가 계약대로 채워진다', async () => {
    const quoteId = await newQuote();
    const res = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`)
      .set('Cookie', COOKIE);
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const lines = res.body.data.po_lines as Line[];

    // 기본형 — 저상이므로 저상형 단가다(표준형 6,900,000 이 오면 안 된다)
    const base = find(lines, 'STEGO K1 저상형');
    expect(base, JSON.stringify(lines)).toBeTruthy();
    expect(base!.unit_price).toBe(6_700_000);
    expect(base!.unit).toBe('SET');
    expect(base!.section).toBe('BASE');

    // 슬라이딩 도어 변경은 **좌·우 2개** — 계약서 발주서 예시가 그렇다
    const slide = find(lines, '슬라이딩 도어 변경');
    expect(slide!.qty).toBe(2);
    expect(slide!.unit_price).toBe(275_000);
    expect(slide!.amount).toBe(550_000);

    expect(find(lines, '격벽(그물망)')!.unit_price).toBe(65_000);
    // 도어추가를 안 골랐으니 그 줄은 없다
    expect(find(lines, '운전석 스윙도어'), '고르지 않은 옵션이 실렸다').toBeUndefined();
  }, 30_000);

  it('🔴 탑 높이가 다르면 그 높이의 단가가 온다', async () => {
    const quoteId = await newQuote({ ...SEL, TOP: 'TOP_STD' });
    const res = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
    const lines = res.body.data.po_lines as Line[];
    expect(find(lines, 'STEGO K1 표준형')!.unit_price).toBe(6_900_000);
    expect(find(lines, 'STEGO K1 저상형'), '저상 단가가 표준형 발주서에 실렸다').toBeUndefined();
    expect(find(lines, '슬라이딩 도어 변경')!.unit_price).toBe(295_000);
  }, 30_000);

  it('🔴 특장사를 안 고르면 표가 비어 온다', async () => {
    // 아무 특장사의 값이나 보여 주면 **틀린 금액을 보고 배정하게 된다**
    const quoteId = await newQuote();
    const res = await request(app).get(`/api/v1/quotes/${quoteId}/order-preview`).set('Cookie', COOKIE);
    expect(res.body.data.po_lines).toEqual([]);
  }, 30_000);

  it('🔴 계약 단가는 **보내는 쪽이 못 정한다**', async () => {
    /*
     * 화면의 「고칠 수 없음」은 사람이 타이핑하지 못하게 막을 뿐이다.
     * API 를 직접 부르면 6,700,000 짜리를 1 원으로 적어 보낼 수 있다 —
     * 서버가 계약 줄을 **다시 만들어야** 계약대로 나간다.
     */
    const quoteId = await newQuote();
    const res = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', COOKIE)
      .send({
        maker_org_id: MAKER_ORG,
        po_lines: [
          ...await filledAutoLines(quoteId),
          { label: 'STEGO K1 저상형', section: 'BASE', unit: 'SET', qty: 1, unit_price: 1, amount: 1, source: 'CONTRACT' },
          { label: '냉동기 전원 별도 배선', section: 'OPTION', unit: 'EA', qty: 1, unit_price: 150_000, amount: 150_000, source: 'MANUAL' },
        ],
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: quoteId } });
    const lines = order.po_lines as unknown as Line[];
    expect(find(lines, 'STEGO K1 저상형')!.unit_price, '1원짜리 계약 단가가 저장됐다').toBe(6_700_000);
    // 직접 적은 줄은 그대로 실린다 — 계약에 없는 사양이라 정본이 없다
    expect(find(lines, '냉동기 전원 별도 배선')!.unit_price).toBe(150_000);
  }, 30_000);

  it('🔴 금액은 단가×수량으로 **다시 센다**', async () => {
    // 보낸 합계를 그대로 믿으면 표가 스스로 거짓말을 한다
    const quoteId = await newQuote();
    await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', COOKIE)
      .send({
        maker_org_id: MAKER_ORG,
        po_lines: [
          ...await filledAutoLines(quoteId),
          { label: '추가 배선', section: 'OPTION', unit: 'EA', qty: 3, unit_price: 100_000, amount: 999_999_999, source: 'MANUAL' },
        ],
      });
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: quoteId } });
    const lines = order.po_lines as unknown as Line[];
    expect(find(lines, '추가 배선')!.amount).toBe(300_000);
  }, 30_000);

  it('🔴 차량은 발주서에 실리지 않는다', async () => {
    /*
     * 베이스 차량은 **갑이 을에게 지급한다**(계약 제7조). 우리가 주는 것을
     * 특장사에 지급할 금액으로 실으면 안 된다.
     */
    const quoteId = await newQuote();
    const res = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
    const lines = res.body.data.po_lines as Line[];
    expect(lines.some(l => /트림|Plus|Basic/.test(l.label)), '차량 트림이 발주서에 실렸다').toBe(false);
  }, 30_000);

  it('🔴 EV& 가 직접 하는 작업은 발주서에 실리지 않는다', async () => {
    /*
     * 특장 인도 뒤 EV& 가 직접 붙이는 항목까지 발주서에 실으면,
     * **우리가 안 시킨 일의 대금을 청구받는다.**
     */
    const row = await prisma!.makerPrice.findFirstOrThrow({
      where: { maker_org_id: MAKER_ORG, value_code: 'PART_NET', top_code: 'TOP_LOW' },
    });
    await prisma!.makerPrice.update({ where: { id: row.id }, data: { work_by: 'EVN' } });
    try {
      const quoteId = await newQuote();
      const res = await request(app)
        .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
      const lines = res.body.data.po_lines as Line[];
      expect(find(lines, '격벽(그물망)'), 'EV& 작업이 발주서에 실렸다').toBeUndefined();
      // 다른 줄은 그대로다
      expect(find(lines, 'STEGO K1 저상형')).toBeTruthy();
    } finally {
      await prisma!.makerPrice.update({ where: { id: row.id }, data: { work_by: 'MAKER' } });
    }
  }, 30_000);

  it('🔴 계약에 없는 사양은 **금액만 빈 칸으로** 저절로 생긴다', async () => {
    /*
     * ⚠️ 여기 있던 「계약에 없는 사양은 줄을 만들지 않는다」를 **바꿔 썼다.**
     *    줄을 안 만들면 관리자가 「+ 항목 추가」를 눌러 품목명부터 타이핑해야 했다 —
     *    무엇을 적어야 하는지 화면이 이미 아는데 사람에게 다시 묻던 셈이다(제보).
     *    이제 그 줄이 저절로 생기고, 관리자는 **금액만** 채운다.
     *
     * 온도기록계는 계약 단가표에 없다(별첨1). 그래서 값이 빈 채로 뜬다.
     */
    const quoteId = await newQuote();
    const res = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
    const lines = res.body.data.po_lines as Line[];

    const temp = lines.find(l => /온도/.test(l.label));
    expect(temp, `온도기록계 줄이 없다: ${JSON.stringify(lines.map(l => l.label))}`).toBeTruthy();
    expect(temp!.source, '자동으로 생긴 줄이 아니다').toBe('AUTO');
    expect(temp!.unit_price, '0원이 아니라 빈 값이어야 한다').toBe(0);
  }, 30_000);

  it('🔴 금액이 빈 줄이 있으면 **배정되지 않는다**', async () => {
    /*
     * 0 원짜리 줄이 실린 발주서는 특장사에게 「무상으로 해 주기로 했다」로 읽힌다.
     * 화면에서만 막으면 API 를 직접 불러 우회되므로 서버가 본다.
     */
    const quoteId = await newQuote();
    const res = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', COOKIE)
      .send({ maker_org_id: MAKER_ORG, po_lines: [] });
    expect(res.status, `빈 금액인데 배정됐다: ${JSON.stringify(res.body).slice(0, 200)}`).toBe(400);
    expect(String(res.body?.error?.message ?? ''), JSON.stringify(res.body)).toContain('온도');
    // 막았으면 주문도 없어야 한다
    expect(await prisma!.order.count({ where: { quote_id: quoteId } })).toBe(0);
  }, 30_000);

  it('🔴 금액만 채우면 배정된다 — 품목명·수량은 옵션이 정한다', async () => {
    const quoteId = await newQuote();
    const prev = await request(app)
      .get(`/api/v1/quotes/${quoteId}/order-preview?maker_org_id=${MAKER_ORG}`).set('Cookie', COOKIE);
    const autos = (prev.body.data.po_lines as (Line & { ref?: string })[]).filter(l => l.source === 'AUTO');
    expect(autos.length, '자동으로 생긴 줄이 없다').toBeGreaterThan(0);

    const res = await request(app).patch(`/api/v1/quotes/${quoteId}/assign`).set('Cookie', COOKIE)
      .send({
        maker_org_id: MAKER_ORG,
        // 품목명을 딴 것으로 보내 봐도 옵션이 정한 이름이 남아야 한다
        po_lines: autos.map(l => ({ ...l, label: '딴 이름', unit_price: 320_000, amount: 320_000 })),
      });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);

    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: quoteId } });
    const lines = order.po_lines as unknown as Line[];
    expect(find(lines, '딴 이름'), '보낸 품목명이 그대로 저장됐다').toBeUndefined();
    const temp = lines.find(l => /온도/.test(l.label));
    expect(temp!.unit_price, '적은 금액이 안 들어갔다').toBe(320_000);
  }, 30_000);
});
