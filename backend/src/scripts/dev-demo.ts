/**
 * 로컬 시연용 상태 배치 — **더미를 새로 쌓지 않고, 이미 있는 견적의 단계만 옮긴다.**
 *
 * 새 기능(공개 문의 배정·수락, 제작 배정, 납기 입력)을 눈으로 보려면 각 단계에 걸쳐 있는
 * 건이 하나씩 필요하다. 그걸 손으로 만들려면 견적을 여러 개 만들고 서명까지 태워야 해서
 * 부담이 크다 — 이 스크립트가 기존 견적 몇 건의 상태만 옮겨 그 자리를 만들어 준다.
 *
 * ⚠️ **로컬 DB 에서만 돈다.** DATABASE_URL 이 localhost/127.0.0.1 이 아니면 즉시 멈춘다.
 *    운영 DB 에 상태를 갈아끼우는 스크립트가 실수로 도는 것은 되돌릴 수 없는 사고다.
 *
 * ⚠️ 견적을 **지우거나 만들지 않는다.** status 와 배정 필드만 바꾼다.
 *    `npm run dev:demo -- --reset` 으로 이 스크립트가 옮긴 것을 되돌린다.
 *
 * 사용:
 *   npm run dev:demo            시연 상태로 배치
 *   npm run dev:demo -- --reset 되돌리기(전부 draft/confirmed 로)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const url = process.env['DATABASE_URL'] ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error('✋ 로컬 DB 가 아닙니다. 이 스크립트는 localhost 에서만 돕니다.');
  console.error(`   DATABASE_URL 호스트: ${url.replace(/\/\/[^@]*@/, '//***@') || '(비어 있음)'}`);
  process.exit(1);
}

const prisma = new PrismaClient();
const reset = process.argv.includes('--reset');

/**
 * 시연용 로그인 — 세 화면을 다 열어 보려면 역할별 계정이 하나씩 필요하다.
 *
 * 비밀번호를 모르면 시연 자체가 시작되지 않아서, **로컬에서만** 알려진 값으로 맞춰 준다.
 * (위에서 localhost 가드를 통과한 경우에만 여기까지 온다)
 */
const DEMO_PASSWORD = 'demo1234!';
const DEMO_ACCOUNTS: { email: string; role: 'SALES' | 'ADMIN' | 'MAKER'; name: string; org: string }[] = [
  { email: 'demo-sales@local', role: 'SALES', name: '데모영업', org: 'ORG_SALES1' },
  { email: 'demo-admin@local', role: 'ADMIN', name: '데모관리자', org: 'ORG_HQ' },
  { email: 'demo-maker@local', role: 'MAKER', name: '데모특장사', org: 'ORG_BRAIN' },
];

async function ensureDemoAccounts(makerOrg: string) {
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const a of DEMO_ACCOUNTS) {
    const org_code = a.role === 'MAKER' ? makerOrg : a.org;
    const exists = await prisma.org.findUnique({ where: { code: org_code } });
    if (!exists) continue;
    await prisma.user.upsert({
      where: { email: a.email },
      create: {
        email: a.email, org_code, role: a.role, name: a.name,
        password_hash: hash, must_change_pw: false, active: true, status: 'active',
        // 컬럼에 기본값이 없다 — 빼면 INSERT 가 실패한다(bootstrap.ts 주석 참조)
        extra_roles: [],
      },
      // 이미 있으면 비밀번호와 잠금만 푼다 — 역할·조직은 손대지 않는다
      update: { password_hash: hash, must_change_pw: false, active: true, status: 'active', login_attempts: 0, locked_until: null },
    });
  }
}

/** 시연용으로 고를 견적 — 최근 것부터, 서류가 고정되지 않은 것만 건드린다. */
async function pickQuotes(n: number, where: object) {
  return prisma.quote.findMany({
    where: { docs_frozen_at: null, ...where },
    orderBy: { id: 'desc' },
    take: n,
    select: { id: true, quote_no: true, status: true, customer: { select: { name: true } } },
  });
}

const label = (q: { id: number; quote_no: string | null; customer: { name: string } | null }) =>
  `${q.quote_no ?? `#${q.id}`}${q.customer?.name ? ` (${q.customer.name})` : ''}`;

async function main() {
  const maker = await prisma.org.findFirst({ where: { type: 'MAKER', active: true }, select: { code: true, name: true } });
  if (!maker) {
    console.error('✋ 특장사 조직이 없습니다. 먼저 npm run db:seed 를 돌려 주세요.');
    process.exit(1);
  }
  await ensureDemoAccounts(maker.code);

  /*
   * 배정은 **데모 영업 계정**에게 한다. 아무 영업에게나 배정하면 시연자가 로그인한 계정과
   * 어긋나 「배정된 문의」가 비어 보인다(실제로 그렇게 어긋났다).
   */
  const sales = await prisma.user.findUnique({
    where: { email: 'demo-sales@local' },
    select: { email: true, org_code: true },
  });
  if (!sales) {
    console.error('✋ 데모 영업 계정을 만들지 못했습니다. ORG_SALES1 조직이 있는지 확인해 주세요.');
    process.exit(1);
  }

  if (reset) {
    // 이 스크립트가 만든 상태만 되돌린다 — 주문은 지우지 않고 배정만 푼다
    const back = await prisma.quote.updateMany({
      where: { status: { in: ['contracted', 'assigned', 'ordered'] } },
      data: { status: 'confirmed' },
    });
    const pub = await prisma.quote.updateMany({
      where: { source: 'public' },
      data: { sales_accepted_at: null },
    });
    const ord = await prisma.order.updateMany({
      where: { delivery_due: { not: null } },
      data: { delivery_due: null, accepted_at: null },
    });
    console.log(`↩︎  되돌림 — 견적 ${back.count}건 → 견적확정 · 공개문의 수락 ${pub.count}건 해제 · 납기 ${ord.count}건 비움`);
    return;
  }

  const done: string[] = [];

  // ── ① 공개 문의 · 영업 미배정 → 관리자 「영업 배정」이 뜬다
  const unassigned = await pickQuotes(1, { source: 'public' });
  if (unassigned[0]) {
    await prisma.quote.update({
      where: { id: unassigned[0].id },
      data: { sales_user_id: null, org_id: null, sales_accepted_at: null },
    });
    done.push(`① 공개 문의 · 영업 미배정   ${label(unassigned[0])}  → 관리자 > 견적 목록에서 「영업 배정」`);
  }

  // ── ② 공개 문의 · 배정됨 · 수락 대기 → 영업 「배정된 문의」가 뜬다
  const pendingAccept = await pickQuotes(2, { source: 'public' });
  const second = pendingAccept[1];
  if (second) {
    await prisma.quote.update({
      where: { id: second.id },
      data: { sales_user_id: sales.email, org_id: sales.org_code, sales_accepted_at: null },
    });
    done.push(`② 공개 문의 · 수락 대기      ${label(second)}  → 영업 > 견적·주문 「배정된 문의」`);
  }

  // ── ③ 계약완료 → 관리자 「제작 배정」이 열린다(라임 강조)
  const contracted = await pickQuotes(2, { status: 'confirmed', source: 'sales' });
  for (const q of contracted) {
    await prisma.quote.update({ where: { id: q.id }, data: { status: 'contracted' } });
    done.push(`③ 계약완료 · 제작 배정 대기  ${label(q)}  → 관리자 > 견적 목록에서 「제작 배정」`);
  }

  // ── ④ 배정완료 + 주문 → 특장사 「수락 대기」 + 납기 입력
  const withOrder = await prisma.order.findFirst({
    where: { maker_org_id: maker.code },
    orderBy: { id: 'desc' },
    select: { id: true, quote_id: true, assigned_at: true },
  });
  if (withOrder) {
    await prisma.quote.update({ where: { id: withOrder.quote_id }, data: { status: 'assigned' } });
    await prisma.order.update({ where: { id: withOrder.id }, data: { delivery_due: null, accepted_at: null } });
    const day = (withOrder.assigned_at ?? new Date()).toISOString().slice(0, 10);
    done.push(`④ 배정완료 · 수락 대기       주문 #${withOrder.id} (${maker.name}, 발주일 ${day})  → 특장사 「수락 대기」에서 납기 입력`);
  }

  console.log('\n로컬 시연 상태를 배치했습니다. 견적을 새로 만들지 않고 단계만 옮겼습니다.\n');
  console.log('  ── 로그인 (비밀번호 공통: ' + DEMO_PASSWORD + ') ─────────────────────');
  console.log('  영업    demo-sales@local');
  console.log('  관리자  demo-admin@local');
  console.log('  특장사  demo-maker@local');
  console.log('\n  ── 볼 것 ──────────────────────────────────────────────');
  done.forEach(d => console.log('  ' + d));
  console.log(`\n  되돌리기:  npm run dev:demo -- --reset\n`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
