import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { ApiOrder, ApiQuote } from '@buildup-ev/shared/types';

/**
 * **주문 현황판** — 관리자 「주문 진행」 탭 맨 위(2026-09-14 기획 확정).
 *
 *   ① 배정 대기(계약완료, 거부돼 돌아온 건 포함·거부 표시) → 수락 대기 → 진행 중 → 인도 완료, 따로 「납기 지남」
 *   ② 진행 중은 트랙마다 지금 서 있는 칸에 **한 번씩**. 다른 트랙이 안 끝나 못 여는 트랙에는 안 센다
 *   ③ 칸을 누르면 그 주문 목록, 배정 대기는 그 자리에서 제작 배정(견적 목록과 같은 창)
 *   ④ 「제작 배정 필요」 알림은 이 탭의 배정 대기로 연다
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));

const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
const { buildDashboard, filterByMaker } = await import('../../../frontend/src/lib/orderDashboard');

type Lane = { code: string; label: string; since: string | null; late: boolean } | null;
function order(id: number, o: Partial<ApiOrder> & { status?: string; lanes?: Partial<Record<'vehicle' | 'body' | 'tuning' | 'merged', Lane>>; done?: number; total?: number }): ApiOrder {
  const { status = 'ordered', lanes = {}, done = 1, total = 15, ...rest } = o;
  return {
    id, quote_id: 1000 + id, maker_org_id: 'ORG_A', created_at: '2026-09-01', delivery_due: null,
    quote: { status, customer: { id: 1, name: `고객${id}` } },
    steps: { done, total, done_labels: [], last_done: null, open: [], stalled: false,
      lanes: { vehicle: null, body: null, tuning: null, merged: null, ...lanes } },
    ...rest,
  } as unknown as ApiOrder;
}
const quote = (id: number, status = 'contracted') => ({ id, status, quote_no: `Q-${id}`, created_at: '2026-09-01', customer: { name: 'x' } }) as unknown as ApiQuote;
const spot = (code: string, late = false): Lane => ({ code, label: code, since: '2026-09-02', late });
const NOW = new Date('2026-09-14T09:00:00');

describe('현황판 분류', () => {
  const orders = [
    order(1, { status: 'assigned', maker_org_id: 'ORG_A' }),                                  // 수락 대기
    order(2, { lanes: { vehicle: spot('car_arrived'), body: spot('build_started') } }),       // 진행 중 — 두 트랙
    order(3, { lanes: { body: spot('build_started') }, delivery_due: '2026-09-10', maker_org_id: 'ORG_B' }), // 진행 중 + 납기 지남
    order(4, { done: 15, total: 15 }),                                                         // 인도 완료
    order(5, { status: 'contracted', maker_org_id: null, rejected_by_org: 'ORG_A', quote_id: 505 }), // 거부돼 돌아온 건
  ];
  const dash = buildDashboard(orders, [quote(505), quote(506)], NOW);

  it('🔴 칸마다 맞게 센다', () => {
    expect(dash.pending.map(o => o.id)).toEqual([1]);
    expect(dash.active.map(o => o.id).sort()).toEqual([2, 3]);
    expect(dash.done.map(o => o.id)).toEqual([4]);
    expect(dash.late.map(o => o.id)).toEqual([3]);
  });

  it('🔴 거부돼 돌아온 건은 배정 대기에 거부 표시로 — 진행 중·수락 대기에 섞이지 않는다', () => {
    expect(dash.assign.map(w => [w.quote.id, w.rejected?.id ?? null])).toEqual([[505, 5], [506, null]]);
    expect([...dash.pending, ...dash.active, ...dash.done].map(o => o.id)).not.toContain(5);
  });

  it('🔴 한 주문은 트랙마다 한 번 — 두 트랙에 걸리면 두 줄에 하나씩', () => {
    const count = (track: 'vehicle' | 'body', code: string) => dash.lanes[track]!.find(c => c.code === code)!.orders.map(o => o.id);
    expect(count('vehicle', 'car_arrived')).toEqual([2]);
    expect(count('body', 'build_started').sort()).toEqual([2, 3]);
    // 한 줄 안에서는 겹치지 않는다 — 줄 합계 ≤ 진행 중
    for (const track of ['vehicle', 'body', 'tuning', 'merged'] as const) {
      const sum = dash.lanes[track]!.reduce((a, c) => a + c.orders.length, 0);
      expect(sum, `${track} 줄에서 겹쳐 셌다`).toBeLessThanOrEqual(dash.active.length);
    }
  });

  it('🔴 납기가 지난 주문이 멈춘 칸은 지연으로 표시된다', () => {
    expect(dash.lanes.body!.find(c => c.code === 'build_started')!.late).toBe(1);
    expect(dash.lanes.vehicle!.find(c => c.code === 'car_arrived')!.late).toBe(0);
  });

  it('🔴 특장사로 거르면 주문만 걸러진다', () => {
    const only = buildDashboard(filterByMaker(orders, 'ORG_B'), [], NOW);
    expect(only.active.map(o => o.id)).toEqual([3]);
  });
});

describe('화면 규칙', () => {
  const ADMIN = read('frontend/src/pages/AdminPage.tsx');
  const kanban = ADMIN.slice(ADMIN.indexOf('function KanbanTab('), ADMIN.indexOf('export function AdminPage('));

  it('🔴 주문 진행 탭 맨 위에 현황판, 고르면 아래에 목록 — 안 고르면 기존 구획', () => {
    const dash = kanban.indexOf('<OrderDashboard');
    const list = kanban.indexOf('<DashboardList');
    const sections = kanban.indexOf('{!sel && <OrderSections');
    expect(dash).toBeGreaterThan(0);
    expect(dash < list && list < sections).toBe(true);
  });

  it('🔴 배정 대기에서 바로 제작 배정 — 견적 목록과 같은 창, 권한 없으면 버튼 없음', () => {
    expect(kanban).toMatch(/usePermission\('order\.confirm'\)/);
    expect(kanban).toMatch(/onAssign=\{canAssign \? /);
    expect(kanban).toMatch(/<ConfirmModal/);
    expect(kanban).toMatch(/assignQuote\(confirmingId/);
  });

  it('🔴 알림으로 들어오면 배정 대기를 펴고 시작한다', () => {
    expect(ADMIN).toMatch(/get\('view'\) === 'assign'/);
    expect(kanban).toMatch(/initialView === 'assign' \? \{ kind: 'tile', key: 'assign' \} : null/);
  });

  it('🔴 트랙 현황판은 「진행 중」(또는 그 안의 단계 칩)을 골랐을 때만 편다 — 배정·수락·인도는 트랙이 필요 없다', () => {
    const comp = read('frontend/src/components/OrderDashboard.tsx');
    expect(comp).toMatch(/const showLanes = stepPicked \|\| \(selected\?\.kind === 'tile' && selected\.key === 'active'\)/);
    expect(comp).toMatch(/\{showLanes && <div style=\{s\.lanes\}>/);
    // 칩을 다시 누르면 진행 중으로 — 현황판이 접히지 않는다
    expect(comp).toMatch(/onSelect\(on \? \{ kind: 'tile', key: 'active' \} :/);
  });

  it('🔴 휴대폰 모양으로 바뀌는 폭이 헤더와 같다 — 어긋나면 헤더는 휴대폰, 현황판은 PC 모양이 된다', () => {
    const comp = read('frontend/src/components/OrderDashboard.tsx');
    const header = read('frontend/src/components/Header.tsx');
    expect(header).toMatch(/const isMobile = useIsMobile\(\)/);
    expect(comp).toMatch(/const narrow = useIsMobile\(\)/);
  });

  it('🔴 칸·트랙·단계 이름이 영문 사전에 다 있다 — 표에서 꺼내 t() 를 태우므로 일반 영문화 검사가 못 잡는다', async () => {
    const { EN } = await import('../../../frontend/src/i18n/en');
    const { STEPS, TRACK_LABEL } = await import('@buildup-ev/shared/process');
    const comp = read('frontend/src/components/OrderDashboard.tsx');
    const tiles = [...comp.matchAll(/\{ key: '\w+', label: '([^']+)'/g)].map(m => m[1]!);
    expect(tiles.length).toBe(5);
    const titles = [...kanban.matchAll(/(?:assign|pending|active|done|late): '([^']+)'/g)].map(m => m[1]!);
    const need = [...tiles, ...titles, ...Object.values(TRACK_LABEL), ...STEPS.map(x => x.label)];
    expect(need.filter(k => !(k in EN)), '사전에 없어 영어 화면에 한국어로 나간다').toEqual([]);
  });

  it('🔴 칸·칩 테두리는 한 줄(border)로만 — borderColor 만 걷으면 검은 테두리가 남는다', () => {
    const comp = read('frontend/src/components/OrderDashboard.tsx');
    expect(comp).not.toMatch(/borderColor:/);
  });
});

describe.runIf(!!process.env['DATABASE_URL'] || true)('주문 목록 응답에 트랙 칸이 실린다', async () => {
  const request = (await import('supertest')).default;
  const { createApp } = await import('../app.js');
  const { prisma } = await import('../lib/prisma.js');
  const { authCookie } = await import('./helpers.js');
  const { businessDue } = await import('./due-helper.js');
  const live = !!prisma;
  const app = createApp();
  const ADM = 'dash-admin@example.invalid';
  const MK = 'dash-maker@example.invalid';
  const admin = authCookie(ADM, 'ADMIN', 'ORG_HQ');
  const maker = authCookie(MK, 'MAKER', 'ORG_BRAIN');
  let customerId = 0;
  const quotes: number[] = [];

  beforeAll(async () => {
    if (!prisma) return;
    const mods = await prisma.featureModule.findMany({ select: { code: true } });
    for (const [email, role, org] of [[ADM, 'ADMIN', 'ORG_HQ'], [MK, 'MAKER', 'ORG_BRAIN']] as const) {
      await prisma.user.upsert({ where: { email }, update: { active: true, status: 'active' }, create: { email, name: '현황판시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' } });
      for (const m of mods) {
        await prisma.accessControl.upsert({
          where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
          update: { enabled: true }, create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled: true },
        });
      }
    }
    customerId = (await prisma.customer.create({ data: { name: '현황판_테스트고객' } })).id;
  });
  afterAll(async () => {
    if (!prisma) return;
    for (const id of quotes) {
      await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
      await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
      await prisma.order.deleteMany({ where: { quote_id: id } });
      await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
      await prisma.quote.deleteMany({ where: { id } });
    }
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.notification.deleteMany({ where: { user_email: { in: [ADM, MK] } } });
    await prisma.accessControl.deleteMany({ where: { subject_ref: { in: [ADM, MK] } } });
    await prisma.user.deleteMany({ where: { email: { in: [ADM, MK] } } });
  });

  it.runIf(live)('🔴 막 수락한 주문 — 차량 「차량 도착」, 특장 「제작 착수」, 튜닝·출고는 없음', async () => {
    const q = await prisma!.quote.create({ data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', customer_id: customerId, final_price: 1 }, select: { id: true } });
    quotes.push(q.id);
    expect((await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', admin).send({ maker_org_id: 'ORG_BRAIN' })).status).toBe(200);
    const o = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
    expect((await request(app).patch(`/api/v1/orders/${o.id}/accept`).set('Cookie', maker).send({ delivery_due: await businessDue() })).status).toBe(200);
    const res = await request(app).get('/api/v1/orders').set('Cookie', admin);
    const row = (res.body.data as ApiOrder[]).find(x => x.id === o.id)!;
    expect(row.steps?.lanes?.vehicle?.code).toBe('car_arrived');
    expect(row.steps?.lanes?.body?.code).toBe('build_started');
    expect(row.steps?.lanes?.tuning).toBeNull();
    expect(row.steps?.lanes?.merged).toBeNull();
    expect(row.steps?.finished).toBe(false);
  }, 30_000);
});
