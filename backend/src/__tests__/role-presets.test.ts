import { describe, it, expect, beforeAll, afterAll } from 'vitest';

/**
 * **역할 프리셋** — 관리자 안을 하는 일로 나눈다(2026-09-16 지시).
 *   ① 프리셋이 역할 기본값을 덮는다 — 프리셋에 없는 모듈은 꺼진다
 *   ② 계정별 토글이 마지막 말 — 「프리셋을 쓰되 이 계정만 예외」
 *   ③ 프리셋이 없는 계정(옛 관리자)은 지금 권한 그대로 — 지정 전에는 아무것도 바뀌지 않는다
 *   ④ 자리마다 보이는 탭이 다르다(고객·옵션DB·공휴일·특장사 단가…)
 *   ⑤ 알림도 자리로 간다
 */
process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'false';
const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { mergePermissions } = await import('../lib/permissions.js');
const { PRESET_BY_CODE, PRESETS, NOTIFY_TOPIC_BY_CODE } = await import('@buildup-ev/shared/rbac/presets');

const app = createApp();
const live = !!prisma;
const P = (code: string) => PRESET_BY_CODE[code]!.modules;

describe('프리셋 규칙 — 계산(DB 없이)', () => {
  const roleDefaults = [
    { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'basedata.optiondb', enabled: true },
    { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.view', enabled: true },
    { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'account.manage', enabled: true },
  ];

  it('🔴 프리셋이 역할 기본값을 덮는다 — 프리셋에 없는 모듈은 꺼진다', () => {
    const got = mergePermissions('ADMIN', 'a@x.com', roleDefaults, { preset: 'sales_mgr' });
    expect(got, '영업관리에게 옵션DB가 열렸다').not.toContain('basedata.optiondb');
    expect(got, '영업관리에게 계정 관리가 열렸다').not.toContain('account.manage');
    expect(got).toContain('order.view');
    expect(got).toContain('customer.view');
  });

  /*
   * 2026-09-16 제보 — 영업+관리자 겸직 계정에 프리셋을 지정했더니 **영업 기능이 다 꺼졌다.**
   * 프리셋은 관리자 안의 자리를 정할 뿐, 영업·특장사 역할이 준 것은 건드리지 않는다.
   */
  it('🔴 겸직(영업+관리자) — 프리셋은 관리자 몫만 조정하고 영업 권한은 그대로 둔다', () => {
    const acs = [
      { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.create', enabled: true },
      { subject_type: 'role', subject_ref: 'SALES', module_code: 'doc.send.sign', enabled: true },
      { subject_type: 'role', subject_ref: 'SALES', module_code: 'stats.own', enabled: true },
      { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'basedata.optiondb', enabled: true },
      { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'account.manage', enabled: true },
    ];
    const got = mergePermissions(['SALES', 'ADMIN'], 'a@x.com', acs, { preset: 'exec' });
    // 영업이 준 것 — 경영관리 프리셋에 없어도 살아 있다
    for (const c of ['quote.create', 'doc.send.sign', 'stats.own']) expect(got, c).toContain(c);
    // 관리자가 준 것 — 자리대로 꺼진다
    expect(got).not.toContain('basedata.optiondb');
    expect(got).not.toContain('account.manage');
  });

  it('🔴 특장사+관리자 겸직도 같다 — 특장 일은 자리와 무관하다', () => {
    const acs = [
      { subject_type: 'role', subject_ref: 'MAKER', module_code: 'order.control', enabled: true },
      { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'basedata.optiondb', enabled: true },
    ];
    const got = mergePermissions(['MAKER', 'ADMIN'], 'a@x.com', acs, { preset: 'sales_mgr' });
    expect(got).toContain('order.control');
    expect(got).not.toContain('basedata.optiondb');
  });

  it('🔴 프리셋이 없으면 예전 그대로 — 지정 전에는 권한이 바뀌지 않는다', () => {
    const got = mergePermissions('ADMIN', 'a@x.com', roleDefaults, {});
    expect(got.sort()).toEqual(['account.manage', 'basedata.optiondb', 'order.view'].sort());
  });

  it('🔴 계정별 토글이 마지막 말 — 프리셋을 쓰되 이 계정만 예외', () => {
    const acs = [...roleDefaults, { subject_type: 'user', subject_ref: 'a@x.com', module_code: 'basedata.optiondb', enabled: true }];
    expect(mergePermissions('ADMIN', 'a@x.com', acs, { preset: 'sales_mgr' })).toContain('basedata.optiondb');
    const off = [...roleDefaults, { subject_type: 'user', subject_ref: 'a@x.com', module_code: 'order.view', enabled: false }];
    expect(mergePermissions('ADMIN', 'a@x.com', off, { preset: 'pm' })).not.toContain('order.view');
  });

  it('🔴 옛 우산(basedata.manage)만 켜 둔 계정은 다섯 화면을 잃지 않는다', () => {
    const acs = [{ subject_type: 'role', subject_ref: 'ADMIN', module_code: 'basedata.manage', enabled: true }];
    const got = mergePermissions('ADMIN', 'a@x.com', acs, {});
    for (const c of ['basedata.weights', 'basedata.dims', 'basedata.optiondb', 'basedata.makerprice', 'basedata.holiday']) {
      expect(got, c).toContain(c);
    }
  });

  it('🔴 자리마다 보이는 것이 다르다 — 지시한 탭 구성 그대로', () => {
    // 영업관리 — 견적/고객/성과/주문진행/파일
    expect(P('sales_mgr')).toContain('customer.view');
    expect(P('sales_mgr')).not.toContain('checklist.manage');
    expect(P('sales_mgr').some(m => m.startsWith('basedata.'))).toBe(false);
    // PM — 체크리스트 + 기준데이터 네 가지(공휴일 제외)
    for (const c of ['checklist.manage', 'basedata.weights', 'basedata.dims', 'basedata.optiondb', 'basedata.makerprice']) {
      expect(P('pm'), c).toContain(c);
    }
    expect(P('pm')).not.toContain('basedata.holiday');
    expect(P('pm')).not.toContain('customer.view');
    // 생산관리 — 체크리스트 + 특장사 단가, 제작 배정까지(배정 알림을 받는 자리라 누를 수 있어야 한다)
    expect(P('prod_mgr')).toContain('basedata.makerprice');
    expect(P('prod_mgr')).toContain('order.confirm');
    expect(NOTIFY_TOPIC_BY_CODE['assign.maker']!.presets, '배정 알림은 받는데 배정을 못 한다').toContain('prod_mgr');
    expect(P('prod_mgr')).not.toContain('basedata.optiondb');
    // 부가작업 — 네 자리 모두 본다. 누르는 것은 PM·생산관리(2026-09-16 지시)
    for (const c of ['sales_mgr', 'pm', 'prod_mgr', 'exec', 'master']) {
      const mods = P(c);
      expect(mods.includes('addon.view') || mods.includes('addon.manage'), `${c} 가 부가작업을 못 본다`).toBe(true);
    }
    expect(P('sales_mgr')).not.toContain('addon.manage');
    expect(P('exec')).not.toContain('addon.manage');
    expect(P('pm')).toContain('addon.manage');
    expect(P('prod_mgr')).toContain('addon.manage');
    // 경영관리 — 보는 자리(배정·단계·기준데이터 없음)
    expect(P('exec')).not.toContain('order.confirm');
    expect(P('exec')).not.toContain('order.control');
    expect(P('exec').some(m => m.startsWith('basedata.'))).toBe(false);
    // 마스터 — 공휴일·계정 관리까지
    for (const c of ['basedata.holiday', 'account.manage', 'customer.view']) expect(P('master'), c).toContain(c);
    // 계정 관리는 마스터만
    for (const p of PRESETS.filter(x => x.code !== 'master')) expect(p.modules, p.code).not.toContain('account.manage');
  });

  it('🔴 알림도 자리로 간다 — 지시한 목록 그대로', () => {
    const t = (c: string) => NOTIFY_TOPIC_BY_CODE[c]!;
    expect(t('assign.maker').presets).toEqual(['sales_mgr', 'pm', 'prod_mgr', 'master']);
    expect(t('assign.sales').presets).toEqual(['sales_mgr', 'master']);
    expect(t('assign.request').extra).toContain('sales_owner');
    expect(t('order.due_nudge').presets).toEqual(['pm', 'prod_mgr', 'master']);
    expect(t('order.step_chat').extra).toEqual(['maker_org', 'thread']);
    expect(t('order.handover').presets).toEqual(['sales_mgr', 'pm', 'prod_mgr', 'exec', 'master']);
    expect(t('order.car_arrival').extra).toContain('maker_org');
  });
});

describe.runIf(live)('프리셋 — 실제 API', () => {
  const ADMIN = 'preset-admin@example.invalid';    // 마스터 아님, 프리셋 지정 대상
  const MASTER = 'preset-master@example.invalid';  // 계정 관리용
  const master = authCookie(MASTER, 'ADMIN', 'ORG_HQ');
  const admin = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');

  beforeAll(async () => {
    if (!prisma) return;
    await prisma.user.upsert({ where: { email: MASTER }, update: { is_master: true, active: true, status: 'active' }, create: { email: MASTER, name: '프리셋마스터', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ', is_master: true, active: true, status: 'active', password_hash: 'x' } });
    await prisma.user.upsert({ where: { email: ADMIN }, update: { active: true, status: 'active', admin_preset: null }, create: { email: ADMIN, name: '프리셋관리자', role: 'ADMIN', extra_roles: [], org_code: 'ORG_HQ', active: true, status: 'active', password_hash: 'x' } });
    // 시험은 권한 우회를 끈 채 돈다 — 계정 관리·조회에 필요한 모듈만 이 두 계정에 켠다
    for (const [email, code] of [[MASTER, 'account.manage'], [ADMIN, 'order.view']] as const) {
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: code } },
        update: { enabled: true }, create: { subject_type: 'user', subject_ref: email, module_code: code, enabled: true },
      });
    }
  });
  afterAll(async () => {
    if (!prisma) return;
    await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADMIN, MASTER] } } });
    await prisma.user.deleteMany({ where: { email: { in: [ADMIN, MASTER] } } });
    process.env['ALLOW_TEST_PERMISSION_BYPASS'] = 'true';
  });

  const setPreset = (code: string | null) =>
    request(app).patch(`/api/v1/users/${encodeURIComponent(ADMIN)}`).set('Cookie', master).send({ admin_preset: code });

  it('🔴 자리를 지정하면 그때부터 그 자리 권한 — 옵션DB 저장이 막힌다(영업관리)', async () => {
    expect((await setPreset('sales_mgr')).status).toBe(200);
    const blocked = await request(app).put('/api/v1/option-db/option_price').set('Cookie', admin).send({ rows: [] });
    expect(blocked.status).toBe(403);
    // 고객 목록은 영업관리의 일이라 열린다
    expect((await request(app).get('/api/v1/customers').set('Cookie', admin)).status).toBe(200);
  }, 30_000);

  it('🔴 생산관리는 특장사 단가만 — 옵션DB·고객은 막힌다', async () => {
    expect((await setPreset('prod_mgr')).status).toBe(200);
    expect((await request(app).get('/api/v1/quotes/maker-prices/ORG_BRAIN').set('Cookie', admin)).status).toBe(200);
    expect((await request(app).get('/api/v1/customers').set('Cookie', admin)).status).toBe(403);
    expect((await request(app).put('/api/v1/option-db/option_price').set('Cookie', admin).send({ rows: [] })).status).toBe(403);
  }, 30_000);

  it('🔴 경영관리는 보기만 — 배정도 공휴일도 막힌다', async () => {
    expect((await setPreset('exec')).status).toBe(200);
    expect((await request(app).get('/api/v1/orders').set('Cookie', admin)).status).toBe(200);
    expect((await request(app).get('/api/v1/holidays/admin?year=2026').set('Cookie', admin)).status).toBe(403);
  }, 30_000);

  it('🔴 계정별 예외가 프리셋을 이긴다', async () => {
    expect((await setPreset('exec')).status).toBe(200);
    await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'user', subject_ref: ADMIN, module_code: 'customer.view', enabled: true });
    expect((await request(app).get('/api/v1/customers').set('Cookie', admin)).status).toBe(200);
  }, 30_000);

  it('🔴 미지정으로 되돌리면 예전 권한 그대로 — 역할 기본값이 말한다', async () => {
    await prisma!.accessControl.deleteMany({ where: { subject_ref: ADMIN, module_code: 'customer.view' } });
    expect((await setPreset(null)).status).toBe(200);
    // 고객은 관리자 역할 기본값(프리셋 도입 전과 같다)
    expect((await request(app).get('/api/v1/customers').set('Cookie', admin)).status).toBe(200);
    // 공휴일은 예전에도 계정 토글로 켜야 했다 — 미지정 계정에서 바뀐 것이 없다
    expect((await request(app).get('/api/v1/holidays/admin?year=2026').set('Cookie', admin)).status).toBe(403);
  }, 30_000);

  it('🔴 옛 우산(basedata.manage)만 켜 둔 계정은 쪼갠 화면을 그대로 쓴다', async () => {
    expect((await setPreset(null)).status).toBe(200);
    await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'user', subject_ref: ADMIN, module_code: 'basedata.manage', enabled: true });
    expect((await request(app).get('/api/v1/holidays/admin?year=2026').set('Cookie', admin)).status).toBe(200);
    expect((await request(app).get('/api/v1/quotes/maker-prices/ORG_BRAIN').set('Cookie', admin)).status).toBe(200);
    await prisma!.accessControl.deleteMany({ where: { subject_ref: ADMIN, module_code: 'basedata.manage' } });
  }, 30_000);

  it('🔴 보기 전용 자리(영업관리)는 부가작업을 보되 바꾸지 못한다', async () => {
    expect((await setPreset('sales_mgr')).status).toBe(200);
    const order = await prisma!.order.findFirst({ where: { canceled_at: null }, select: { id: true }, orderBy: { id: 'desc' } });
    if (!order) return;
    expect((await request(app).get(`/api/v1/orders/${order.id}/addon`).set('Cookie', admin)).status, '보지 못한다').toBe(200);
    const write = await request(app).patch(`/api/v1/orders/${order.id}/addon/target`).set('Cookie', admin).send({ date: null });
    expect(write.status, '보기 전용인데 고쳐졌다').toBe(403);
  }, 30_000);

  it('🔴 DB 에 자리 구성이 있으면 그것이 정답 — 없으면 코드 기본값', () => {
    const acs = [
      { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.view', enabled: true },
      { subject_type: 'preset', subject_ref: 'exec', module_code: 'basedata.optiondb', enabled: true },
    ];
    const got = mergePermissions('ADMIN', 'a@x.com', acs, { preset: 'exec' });
    expect(got, '화면에서 켠 값이 무시됐다').toContain('basedata.optiondb');
    expect(got, 'DB 행이 있으면 그 목록이 전부다').not.toContain('order.view');
  });

  it('🔴 관리 권한은 보기를 겸한다 — 따로 켜 주지 않아도 된다', () => {
    const acs = [{ subject_type: 'role', subject_ref: 'ADMIN', module_code: 'addon.manage', enabled: true }];
    expect(mergePermissions('ADMIN', 'a@x.com', acs, {})).toContain('addon.view');
  });

  it('🔴 프리셋 구성은 기능모듈 화면에서 고친다 — DB 행이 코드 기본값을 이긴다', async () => {
    expect((await setPreset('exec')).status).toBe(200);
    // 경영관리에 옵션DB 를 켠다(자리 구성 자체를 고치는 것 — 계정별 예외가 아니다)
    const on = await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'preset', subject_ref: 'exec', module_code: 'basedata.optiondb', enabled: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect((await request(app).put('/api/v1/option-db/option_price').set('Cookie', admin).send({ rows: [] })).status).not.toBe(403);
    // 되돌린다
    await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'preset', subject_ref: 'exec', module_code: 'basedata.optiondb', enabled: false });
    expect((await request(app).put('/api/v1/option-db/option_price').set('Cookie', admin).send({ rows: [] })).status).toBe(403);
  }, 30_000);

  it('🔴 마스터 자리 구성과 알 수 없는 자리는 고칠 수 없다', async () => {
    const m = await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'preset', subject_ref: 'master', module_code: 'account.manage', enabled: false });
    expect(m.status, '마스터 자리가 고쳐졌다').toBe(403);
    const bad = await request(app).post('/api/v1/access-control').set('Cookie', master)
      .send({ subject_type: 'preset', subject_ref: '없는자리', module_code: 'order.view', enabled: true });
    expect(bad.status).toBe(400);
  }, 30_000);

  it('🔴 알 수 없는 자리는 받지 않는다', async () => {
    expect((await setPreset('무엇')).status).toBe(400);
  }, 30_000);
});
