import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

/**
 * **알림함** — 받은 알림이 계정마다 쌓이고, 헤더 종 아이콘에서 본다(2026-09-14 요청).
 *
 *   ① 보내는 알림은 **모두** 알림함에 남는다 — 푸시 키·기기 구독이 없어도(푸시는 한 번 뜨고 사라진다)
 *   ② 기능모듈로 거르지 않는다 — 기능모듈은 메일 여부만(지시 2026-09-14). 「앱 알림」 모듈이 꺼져 있어도 온다
 *   ③ 자기 알림만 보고, 자기 것만 읽음 처리한다
 *   ④ 안 읽은 개수 · 하나 읽음 · 모두 읽음 · 지우지 않는다
 */
const sendMail = vi.fn().mockResolvedValue({});
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail }), default: { createTransport: () => ({ sendMail }) } }));
process.env['MAIL_SMTP_USER'] ||= 'test@example.invalid';
process.env['MAIL_SMTP_PASS'] ||= 'x';

const request = (await import('supertest')).default;
const { createApp } = await import('../app.js');
const { prisma } = await import('../lib/prisma.js');
const { authCookie } = await import('./helpers.js');
const { notify } = await import('../services/push.js');
const { businessDue } = await import('./due-helper.js');
const { addBusinessDays, toDateInput } = await import('@buildup-ev/shared/schedule');

const app = createApp();
const live = !!prisma;
const ME = 'inbox-me@example.invalid';
const OTHER = 'inbox-other@example.invalid';
const ADMIN = 'inbox-admin@example.invalid';
const MAKER = 'inbox-maker@example.invalid';
const USERS = [ME, OTHER, ADMIN, MAKER];
const me = authCookie(ME, 'SALES', 'ORG_HQ');
const other = authCookie(OTHER, 'SALES', 'ORG_HQ');
const adminCookie = authCookie(ADMIN, 'ADMIN', 'ORG_HQ');
const makerCookie = authCookie(MAKER, 'MAKER', 'ORG_BRAIN');
let customerId = 0;
const madeQuotes: number[] = [];

beforeAll(async () => {
  if (!prisma) return;
  const mods = await prisma.featureModule.findMany({ select: { code: true } });
  const rows: [string, 'SALES' | 'ADMIN' | 'MAKER', string][] = [[ME, 'SALES', 'ORG_HQ'], [OTHER, 'SALES', 'ORG_HQ'], [ADMIN, 'ADMIN', 'ORG_HQ'], [MAKER, 'MAKER', 'ORG_BRAIN']];
  for (const [email, role, org] of rows) {
    await prisma.user.upsert({
      where: { email }, update: { active: true, status: 'active' },
      create: { email, name: '알림함시험', role, extra_roles: [], org_code: org, active: true, status: 'active', password_hash: 'x' },
    });
    for (const m of mods) {
      await prisma.accessControl.upsert({
        where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: email, module_code: m.code } },
        update: { enabled: true }, create: { subject_type: 'user', subject_ref: email, module_code: m.code, enabled: true },
      });
    }
  }
  // 「앱 알림」 모듈을 이 특장사 계정에 **꺼 둔다** — 그래도 알림함에는 와야 한다(②)
  await prisma.accessControl.upsert({
    where: { subject_type_subject_ref_module_code: { subject_type: 'user', subject_ref: MAKER, module_code: 'notify.push' } },
    update: { enabled: false }, create: { subject_type: 'user', subject_ref: MAKER, module_code: 'notify.push', enabled: false },
  }).catch(() => { /* 모듈 행이 없는 DB — 이 확인은 건너뛴다 */ });
  customerId = (await prisma.customer.create({ data: { name: '알림함_테스트고객' } })).id;
});

afterAll(async () => {
  if (!prisma) return;
  for (const id of madeQuotes) {
    await prisma.orderStepComment.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.orderStep.deleteMany({ where: { order: { quote_id: id } } });
    await prisma.order.deleteMany({ where: { quote_id: id } });
    await prisma.quoteChangeLog.deleteMany({ where: { quote_id: id } });
    await prisma.quote.deleteMany({ where: { id } });
  }
  await prisma.customer.deleteMany({ where: { id: customerId } });
  // 이 시험 계정의 알림만 치운다
  await prisma.notification.deleteMany({ where: { user_email: { in: USERS } } });
  await prisma.accessControl.deleteMany({ where: { subject_ref: { in: USERS } } });
  await prisma.user.deleteMany({ where: { email: { in: USERS } } });
});

/** fire-and-forget 이라 쌓일 때까지 잠깐 기다린다 */
async function waitFor<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 3000): Promise<T> {
  const until = Date.now() + ms;
  let v = await fn();
  while (!ok(v) && Date.now() < until) { await new Promise(r => setTimeout(r, 50)); v = await fn(); }
  return v;
}
const inbox = (cookie: string, q = '') => request(app).get(`/api/v1/notifications${q}`).set('Cookie', cookie);
const countOf = async (email: string) => prisma!.notification.count({ where: { user_email: email } });

describe.runIf(live)('알림함', () => {
  it('🔴 보낸 알림이 받는 사람마다 쌓인다 — 푸시 키가 없어도, 같은 사람을 두 번 넣어도 한 번', async () => {
    await prisma!.notification.deleteMany({ where: { user_email: { in: [ME, OTHER] } } });
    notify([ME, ME, OTHER], { title: '주문 #1 시험', body: '본문', url: '/?order=1', tag: 't1' });
    await waitFor(() => countOf(OTHER), n => n === 1);
    expect(await countOf(ME)).toBe(1);
    const res = await inbox(me);
    expect(res.status).toBe(200);
    expect(res.body.unread).toBe(1);
    expect(res.body.data[0]).toMatchObject({ title: '주문 #1 시험', body: '본문', url: '/?order=1', read_at: null });
  });

  it('🔴 자기 알림만 본다', async () => {
    await prisma!.notification.deleteMany({ where: { user_email: { in: [ME, OTHER] } } });
    notify([OTHER], { title: '남의 알림', body: 'x', url: '/' });
    await waitFor(() => countOf(OTHER), n => n === 1);
    const res = await inbox(me);
    expect(res.body.data.map((n: { title: string }) => n.title)).not.toContain('남의 알림');
    expect(res.body.unread).toBe(0);
  });

  it('🔴 하나 읽음 — 남의 알림 id 로는 아무것도 바뀌지 않는다', async () => {
    await prisma!.notification.deleteMany({ where: { user_email: { in: [ME, OTHER] } } });
    notify([ME], { title: '내 것', body: 'x', url: '/' });
    notify([OTHER], { title: '남의 것', body: 'x', url: '/' });
    await waitFor(async () => (await countOf(ME)) + (await countOf(OTHER)), n => n === 2);
    const mine = await prisma!.notification.findFirstOrThrow({ where: { user_email: ME } });
    const theirs = await prisma!.notification.findFirstOrThrow({ where: { user_email: OTHER } });

    expect((await request(app).post(`/api/v1/notifications/${theirs.id}/read`).set('Cookie', me)).status).toBe(404);
    expect((await prisma!.notification.findUniqueOrThrow({ where: { id: theirs.id } })).read_at, '남의 알림이 읽음 처리됐다').toBeNull();

    const r = await request(app).post(`/api/v1/notifications/${mine.id}/read`).set('Cookie', me);
    expect(r.status).toBe(200);
    expect(r.body.data.unread).toBe(0);
    const first = (await prisma!.notification.findUniqueOrThrow({ where: { id: mine.id } })).read_at;
    expect(first).not.toBeNull();
    // 다시 눌러도 처음 읽은 시각을 덮어쓰지 않는다
    await new Promise(r2 => setTimeout(r2, 20));
    await request(app).post(`/api/v1/notifications/${mine.id}/read`).set('Cookie', me);
    expect((await prisma!.notification.findUniqueOrThrow({ where: { id: mine.id } })).read_at).toEqual(first);
  });

  it('🔴 모두 읽음 — 자기 것만, 지우지 않는다', async () => {
    await prisma!.notification.deleteMany({ where: { user_email: { in: [ME, OTHER] } } });
    notify([ME], { title: 'a', body: 'x', url: '/' });
    notify([ME], { title: 'b', body: 'x', url: '/' });
    notify([OTHER], { title: 'c', body: 'x', url: '/' });
    await waitFor(async () => (await countOf(ME)) + (await countOf(OTHER)), n => n === 3);
    expect((await request(app).get('/api/v1/notifications/unread-count').set('Cookie', me)).body.data.unread).toBe(2);
    const r = await request(app).post('/api/v1/notifications/read-all').set('Cookie', me);
    expect(r.body.data.updated).toBe(2);
    expect((await request(app).get('/api/v1/notifications/unread-count').set('Cookie', me)).body.data.unread).toBe(0);
    expect(await countOf(ME), '읽었다고 지워졌다').toBe(2);
    expect((await request(app).get('/api/v1/notifications/unread-count').set('Cookie', other)).body.data.unread, '남의 알림까지 읽음').toBe(1);
  });

  it('🔴 더 보기 — 최신부터 나눠서 준다', async () => {
    await prisma!.notification.deleteMany({ where: { user_email: ME } });
    await prisma!.notification.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ user_email: ME, title: `n${i}`, body: '', url: '/' })) });
    const p1 = await inbox(me, '?limit=3');
    expect(p1.body.data.map((n: { title: string }) => n.title)).toEqual(['n4', 'n3', 'n2']);
    const p2 = await inbox(me, `?limit=3&before=${p1.body.next_before}`);
    expect(p2.body.data.map((n: { title: string }) => n.title)).toEqual(['n1', 'n0']);
    expect(p2.body.next_before).toBeNull();
  });

  it('🔴 실제 알림 — 납기일이 바뀌면 특장사 알림함에 온다(「앱 알림」 모듈을 꺼 둬도)', async () => {
    const q = await prisma!.quote.create({
      data: { model_code: 'PV5_OPENBED', selections: {}, inputs: {}, status: 'contracted', assign_requested_at: new Date(), customer_id: customerId, final_price: 50_000_000 },
      select: { id: true },
    });
    madeQuotes.push(q.id);
    const a = await request(app).patch(`/api/v1/quotes/${q.id}/assign`).set('Cookie', adminCookie).send({ maker_org_id: 'ORG_BRAIN' });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    const order = await prisma!.order.findFirstOrThrow({ where: { quote_id: q.id } });
    expect((await request(app).patch(`/api/v1/orders/${order.id}/accept`).set('Cookie', makerCookie).send({ delivery_due: await businessDue() })).status).toBe(200);
    await prisma!.notification.deleteMany({ where: { user_email: MAKER } });
    const next = toDateInput(addBusinessDays(new Date(), 30));
    expect((await request(app).patch(`/api/v1/orders/${order.id}/delivery-due`).set('Cookie', adminCookie).send({ delivery_due: next })).status).toBe(200);
    const rows = await waitFor(() => prisma!.notification.findMany({ where: { user_email: MAKER, url: `/?order=${order.id}` } }), r => r.length > 0);
    expect(rows.length, '특장사 알림함에 오지 않았다').toBe(1);
    expect(rows[0]!.body).toContain(next);
  }, 30_000);

  it('🔴 로그인 안 한 요청은 막힌다', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBeGreaterThanOrEqual(400);
    expect((await request(app).post('/api/v1/notifications/read-all')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('알림함 화면', async () => {
  const { readFileSync } = await import('node:fs');
  const path = (await import('node:path')).default;
  const ROOT = path.resolve(__dirname, '../../..');
  const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
  const BELL = read('frontend/src/components/NotificationBell.tsx');

  it('🔴 헤더 전환 버튼 옆에 종 아이콘 — 로그인한 모든 계정', () => {
    const header = read('frontend/src/components/Header.tsx');
    const seg = header.indexOf('<Segmented');
    const bell = header.indexOf('{user && <NotificationBell />}');
    const name = header.indexOf('style={styles.userInfo}');
    expect(bell, '종 아이콘이 없다').toBeGreaterThan(0);
    expect(seg < bell && bell < name, '전환 버튼과 계정 이름 사이가 아니다').toBe(true);
  });

  it('🔴 빨간 점은 가려지지 않는다 — 버튼 상자 안쪽·맨 위, 팝업은 헤더 밖(body)으로', () => {
    // 헤더가 overflow: hidden 이라 버튼 밖으로 나간 점은 잘린다 — 음수 위치 금지
    const dot = BELL.match(/bellDot: \{([^}]*)\}/)?.[1] ?? '';
    expect(dot).toMatch(/position: 'absolute'/);
    expect(dot).toMatch(/zIndex: [1-9]/);
    expect(dot).not.toMatch(/top: -|right: -/);
    expect(BELL).toMatch(/createPortal\(panel, document\.body\)/);
    // 목록의 점은 줄 맨 앞 고정 칸
    expect(BELL).toMatch(/<span style=\{s\.dotSlot\}[^>]*>\{!n\.read_at && <span style=\{s\.dot\} \/>\}<\/span>\s*<span style=\{s\.itemText\}>/);
  });

  it('🔴 이 기기에서 알림을 허용하지 않았으면 팝업 맨 위에 「알림 허용」', () => {
    const prompt = BELL.indexOf('<PushPrompt />');
    const list = BELL.indexOf('{items?.map(');
    expect(prompt, '알림 허용 칸이 없다').toBeGreaterThan(0);
    expect(prompt, '알림 허용 칸이 목록보다 아래다').toBeLessThan(list);
    expect(BELL).toMatch(/if \(!cfg\?\.enabled \|\| !st \|\| st\.kind === 'on'\) return null/);
  });

  it('🔴 기능모듈 「앱 알림」은 끈다 — 기능모듈은 메일 여부만(지우지 않고 active 만 내린다)', () => {
    const sql = read('backend/prisma/migrations/20260914040000_notification/migration.sql');
    expect(sql).toMatch(/UPDATE "feature_module" SET "active" = false WHERE "code" = 'notify\.push'/);
    expect(sql).not.toMatch(/DELETE/i);
    expect(read('backend/src/services/push.ts'), '앱 알림 받는 사람을 아직 기능모듈로 거른다').not.toMatch(/'notify\.push'|import \{ mergePermissions/);
  });
});
