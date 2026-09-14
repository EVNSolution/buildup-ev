import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **튜닝 후 치수는 사양별 프리셋에서 온다**(2026-09-14 제보·지시).
 *
 * 사고: 주요제원대비표의 튜닝 후 차체제원·하대내측치수가 튜닝 전과 **똑같았다.** 치수 데이터가 없어
 * 튜닝 전 값을 복사해 넣고 있었기 때문이다 — 탑을 올려 높이가 바뀌는데 같은 숫자가 찍혔다.
 *
 * 여기서 지키는 것:
 *   ① 사양(특장형태 × 탑크기)마다 전달받은 치수가 서류(제원대비표·하중계산서)에 들어간다
 *   ② 내장은 외측이 냉동과 같고 내측만 장·폭 +60, 고 +50 (판넬 60T→30T, 바닥 60T→40T)
 *   ③ 값이 없으면 **빈칸** — 튜닝 전 값을 복사하지 않는다
 *   ④ 관리자가 고치면 다음 서류부터 반영되고, 이력이 남는다
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { afterDimensions, findDimensionPreset } = await import('../services/dimension-preset.js');
const { buildSpecTableJson, buildLoadCalcJson } = await import('../services/docgen.js');

const app = createApp();
const live = !!prisma;
const ADMIN = 'dimpreset-admin@example.invalid';
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
let customerId = 0;
const madeQuotes: number[] = [];
const MODEL = 'PV5_OPENBED';

/** 전달받은 프리셋 표(2026-09-14) */
const EXPECT = {
  'BODY_REEFER|TOP_STD': { car: [5040, 1910, 2400], outer: [2590, 1910, 1590], inner: [2420, 1790, 1480] },
  'BODY_REEFER|TOP_LOW': { car: [5040, 1910, 2100], outer: [2590, 1910, 1290], inner: [2420, 1790, 1180] },
  'BODY_DRY|TOP_STD':    { car: [5040, 1910, 2400], outer: [2590, 1910, 1590], inner: [2480, 1850, 1530] },
  'BODY_DRY|TOP_LOW':    { car: [5040, 1910, 2100], outer: [2590, 1910, 1290], inner: [2480, 1850, 1230] },
} as const;

beforeAll(async () => {
  if (!prisma) return;
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  await prisma.user.upsert({
    where: { email: ADMIN }, update: { active: true, status: 'active' },
    create: { email: ADMIN, name: '치수시험', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: 'x' },
  });
  for (const m of mods) {
    await prisma.accessControl.upsert({
      where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: ADMIN, module_code: m.code } },
      update: { enabled: true }, create: { subject_type: 'user', subject_ref: ADMIN, module_code: m.code, enabled: true },
    });
  }
  customerId = (await prisma.customer.create({ data: { name: '치수_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  // 이 시험이 남긴 변경 이력만 치운다(프리셋 값 자체는 시험 안에서 원래대로 되돌린다)
  await prisma.optionDbChangeLog.deleteMany({ where: { table_name: 'dimension_preset', changed_by: { startsWith: ADMIN } } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: ADMIN } });
  await prisma.user.deleteMany({ where: { email: ADMIN } });
});

async function orderWith(body: string, top: string, inputs: Record<string, unknown> = {}) {
  const q = await prisma!.quote.create({
    data: {
      model_code: MODEL, status: 'ordered', customer_id: customerId, final_price: 50_000_000, inputs: inputs as object,
      selections: { TRIM: 'TRIM_BASIC', BODYTYPE: body, TOP: top, DOORTYPE: body === 'BODY_REEFER' ? 'DOOR_SWING' : 'DOOR_SWING', DOORADD: 'ADD_NONE', TEMP: 'TEMP_X', PARTITION: 'PART_NONE' },
    },
    select: { id: true },
  });
  madeQuotes.push(q.id);
  return prisma!.order.create({ data: { quote_id: q.id, maker_org_id: 'ORG_BRAIN', assigned_at: new Date() }, select: { id: true } });
}

describe('튜닝 후 치수 — 빈칸 규약', () => {
  it('🔴 프리셋이 없으면 전부 빈칸이다 — 튜닝 전 값을 복사하지 않는다', () => {
    expect(afterDimensions(null)).toEqual({ length: '', width: '', height: '', bed_len: '', bed_wid: '', bed_hgt: '', offset: '' });
  });
  it('🔴 칸 하나가 비어도 그 칸만 빈칸이다', () => {
    const d = afterDimensions({ car_length: 5040, car_width: null, car_height: 2400, inner_length: 2420, inner_width: 1790, inner_height: 1480, offset: null });
    expect(d).toEqual({ length: 5040, width: '', height: 2400, bed_len: 2420, bed_wid: 1790, bed_hgt: 1480, offset: '' });
  });
});

describe.runIf(live)('튜닝 후 치수 프리셋 — 실제 DB·서류', () => {
  it('🔴 전달받은 네 사양 값이 들어 있다 — 내장 내측은 냉동 +60/+60/+50', async () => {
    for (const [k, e] of Object.entries(EXPECT)) {
      const [body, top] = k.split('|') as [string, string];
      const p = await prisma!.dimensionPreset.findUniqueOrThrow({ where: { model_code_body_type_top_size: { model_code: MODEL, body_type: body, top_size: top } } });
      expect([p.car_length, p.car_width, p.car_height], `${k} 차량`).toEqual(e.car);
      expect([p.outer_length, p.outer_width, p.outer_height], `${k} 외측`).toEqual(e.outer);
      expect([p.inner_length, p.inner_width, p.inner_height], `${k} 내측`).toEqual(e.inner);
    }
    const r = EXPECT['BODY_REEFER|TOP_STD'].inner, d = EXPECT['BODY_DRY|TOP_STD'].inner;
    expect([d[0] - r[0], d[1] - r[1], d[2] - r[2]]).toEqual([60, 60, 50]);
  });

  it('🔴 제보 재현 — 제원대비표 튜닝 후 치수가 튜닝 전 값의 복사가 아니다', async () => {
    const o = await orderWith('BODY_REEFER', 'TOP_STD');
    const { json } = await buildSpecTableJson(o.id);
    expect(json.body.hgt[1], '튜닝 후 높이가 튜닝 전과 같다(복사)').not.toBe(json.body.hgt[0]);
    expect([json.body.len[1], json.body.wid[1], json.body.hgt[1]]).toEqual([5040, 1910, 2400]);
    expect([json.bed.len[1], json.bed.wid[1], json.bed.hgt[1]]).toEqual([2420, 1790, 1480]);
    // 하대옵셋트는 아직 받지 않았다 — 빈칸
    expect(json.val.offset[1]).toBe('');
  }, 60_000);

  it('🔴 사양마다 다른 값이 들어간다 — 내장·저상', async () => {
    const o = await orderWith('BODY_DRY', 'TOP_LOW');
    const { json } = await buildSpecTableJson(o.id);
    expect([json.body.len[1], json.body.wid[1], json.body.hgt[1]]).toEqual([5040, 1910, 2100]);
    expect([json.bed.len[1], json.bed.wid[1], json.bed.hgt[1]]).toEqual([2480, 1850, 1230]);
  }, 60_000);

  it('🔴 하중계산서도 같은 값을 쓴다', async () => {
    const o = await orderWith('BODY_REEFER', 'TOP_LOW');
    const { json } = await buildLoadCalcJson(o.id);
    const a = json.after as Record<string, unknown>;
    expect([a['length'], a['width'], a['height'], a['bed_len'], a['bed_wid'], a['bed_hgt'], a['offset']])
      .toEqual([5040, 1910, 2100, 2420, 1790, 1180, '']);
  }, 60_000);

  it('🔴 특장형태·탑크기가 없으면 프리셋을 고르지 않는다(빈칸)', async () => {
    expect(await findDimensionPreset(MODEL, { BODYTYPE: 'BODY_REEFER' })).toBeNull();
    expect(await findDimensionPreset('NO_SUCH_MODEL', { BODYTYPE: 'BODY_REEFER', TOP: 'TOP_STD' })).toBeNull();
  });

  it('🔴 관리자가 고치면 다음 서류부터 반영되고, 비우면 빈칸, 이력이 남는다', async () => {
    const key = { model_code: MODEL, body_type: 'BODY_DRY', top_size: 'TOP_STD' };
    const orig = await prisma!.dimensionPreset.findUniqueOrThrow({ where: { model_code_body_type_top_size: key } });
    const o = await orderWith('BODY_DRY', 'TOP_STD');
    try {
      const put = (row: Record<string, unknown>) => request(app).put('/api/v1/option-db/dimension_preset').set('Cookie', adminCookie).send({ rows: [{ ...key, ...row }] });
      const r1 = await put({ car_height: 2410, offset: 40 });
      expect(r1.status, JSON.stringify(r1.body)).toBe(200);
      let { json } = await buildSpecTableJson(o.id);
      expect(json.body.hgt[1], '고친 값이 서류에 안 들어갔다(캐시?)').toBe(2410);
      expect(json.val.offset[1]).toBe(40);

      const r2 = await put({ inner_height: '' });
      expect(r2.status).toBe(200);
      ({ json } = await buildSpecTableJson(o.id));
      expect(json.bed.hgt[1], '비운 칸이 0 이나 튜닝 전 값으로 찍힌다').toBe('');

      const logs = await prisma!.optionDbChangeLog.findMany({ where: { table_name: 'dimension_preset', changed_by: ADMIN } });
      expect(logs.map(l => l.field).sort()).toEqual(expect.arrayContaining(['car_height', 'offset', 'inner_height']));
    } finally {
      // 전달받은 값으로 되돌린다 — 시험이 운영 기준값을 바꿔 두면 안 된다
      const { model_code: _m, body_type: _b, top_size: _t, updated_at: _u, ...vals } = orig;
      await prisma!.dimensionPreset.update({ where: { model_code_body_type_top_size: key }, data: vals });
    }
  }, 60_000);

  it('🔴 사양 탭 「상세 제원」 — 튜닝 후 차체제원·하대내측치수만 준다(관리자·특장사 모두)', async () => {
    const o = await orderWith('BODY_DRY', 'TOP_STD');
    for (const cookie of [adminCookie, authCookie('x-maker@example.invalid', 'MAKER', 'ORG_BRAIN')]) {
      const res = await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', cookie);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.detail_dims).toEqual({
        body_only: false,
        body: { length: 5040, width: 1910, height: 2400 },
        bed: { length: 2480, width: 1850, height: 1530 },
      });
    }
  }, 30_000);

  it('🔴 특장만 주문은 하대내측치수만 — 차체제원은 싣지 않는다', async () => {
    const o = await orderWith('BODY_REEFER', 'TOP_LOW', { body_only: true });
    const res = await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', adminCookie);
    expect(res.body.data.detail_dims).toEqual({
      body_only: true, body: null, bed: { length: 2420, width: 1790, height: 1180 },
    });
  }, 30_000);

  it('🔴 화면: 상세 제원은 비고 바로 위, 변경 후만 / 날짜 줄의 「알림이 갑니다」 문구는 없다', async () => {
    const { readFileSync } = await import('node:fs');
    const path = (await import('node:path')).default;
    const ROOT = path.resolve(__dirname, '../../..');
    const detail = readFileSync(path.join(ROOT, 'frontend/src/components/OrderDetail.tsx'), 'utf8');
    const dims = detail.indexOf("t('상세 제원')");
    const remark = detail.indexOf("t('커스텀 요청사항') : t('비고')");
    expect(dims, '상세 제원이 없다').toBeGreaterThan(0);
    expect(dims, '상세 제원이 비고보다 아래에 있다').toBeLessThan(remark);
    expect(detail.slice(dims, remark), '튜닝 전 값이 섞였다').not.toMatch(/변경 전|튜닝 전|before/);
    expect(detail.slice(dims, remark)).toMatch(/detail_dims\.body \?/);
    for (const f of ['CarArrivalRow.tsx', 'DeliveryDueRow.tsx']) {
      expect(readFileSync(path.join(ROOT, 'frontend/src/components', f), 'utf8'), f).not.toMatch(/알림이 갑니다/);
    }
  });

  it('🔴 특장사·영업은 프리셋을 고치지 못한다', async () => {
    const res = await request(app).put('/api/v1/option-db/dimension_preset').set('Cookie', authCookie('x-maker@example.invalid', 'MAKER', 'ORG_BRAIN'))
      .send({ rows: [{ model_code: MODEL, body_type: 'BODY_DRY', top_size: 'TOP_STD', car_height: 1 }] });
    expect(res.status).toBe(403);
  });
});

describe('사양 순서', () => {
  it('🔴 특장형태 > 탑크기 > 도어종류 > 도어추가 > 스포일러 > 그 밖 > 트림(맨 끝)', async () => {
    const { sortSpecOptions } = await import('@buildup-ev/shared/types');
    // 제보 화면의 순서 그대로 넣는다
    const given = ['TOP', 'TRIM', 'DOORADD', 'SPOILER', 'BODYTYPE', 'DOORTYPE', 'PARTITION', 'TEMP'].map(g => ({ group_code: g }));
    expect(sortSpecOptions(given).map(o => o.group_code))
      .toEqual(['BODYTYPE', 'TOP', 'DOORTYPE', 'DOORADD', 'SPOILER', 'PARTITION', 'TEMP', 'TRIM']);
  });

  it.runIf(live)('🔴 주문 상세(사양 탭·발주서)가 그 순서로 준다', async () => {
    const o = await orderWith('BODY_DRY', 'TOP_STD');
    const res = await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', adminCookie);
    const codes = (res.body.data.options as { group_code: string }[]).map(x => x.group_code);
    expect(codes.slice(0, 4)).toEqual(['BODYTYPE', 'TOP', 'DOORTYPE', 'DOORADD']);
    expect(codes[codes.length - 1]).toBe('TRIM');
    const maker = await request(app).get(`/api/v1/orders/${o.id}`).set('Cookie', authCookie('x-maker@example.invalid', 'MAKER', 'ORG_BRAIN'));
    expect((maker.body.data.options as { group_code: string }[]).map(x => x.group_code)).toEqual(codes);
  }, 30_000);
});
