/**
 * **배정 알림 재발송** — 알림이 새어 나간 건을 사람 손으로 다시 보낸다.
 *
 * 왜 필요한가: 알림이 전자서명 경로에만 매달려 있던 동안, 서면계약 스캔본으로
 * 계약완료가 된 건은 아무에게도 알림이 가지 않았다. 코드를 고쳐도 **이미 지나간 건은
 * 저절로 다시 오지 않는다** — 상태가 이미 계약완료라 전이가 다시 일어나지 않기 때문이다.
 *
 * 쓰는 법:
 *   npx tsx src/scripts/resend-assign-alert.ts --quote 205
 *   npx tsx src/scripts/resend-assign-alert.ts --customer "주식회사 화이트축산"
 *   npx tsx src/scripts/resend-assign-alert.ts --pending          # 배정 대기 전건
 *   ... --dry-run                                                 # 누구에게 갈지만 보고 안 보냄
 *
 * ⚠️ 상태를 **읽기만** 한다. 견적·계약을 고치지 않는다.
 */
import { prisma } from '../lib/prisma.js';
import { adminRecipients, notifyAssignNeeded, type AssignKind } from '../services/notify.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  if (!prisma) throw new Error('DB 연결이 없습니다');

  const quoteArg = arg('quote');
  const customer = arg('customer');
  const pending = has('pending');
  const dry = has('dry-run');

  if (!quoteArg && !customer && !pending) {
    console.error('대상을 정해야 합니다: --quote <id> | --customer <이름> | --pending');
    process.exit(2);
  }

  /*
   * 배정을 기다리는 상태만 고른다 — 이미 배정된 건에 「배정하세요」를 보내면
   * 받는 사람이 무엇을 하라는 건지 알 수 없다.
   */
  const where = quoteArg
    ? { id: Number(quoteArg) }
    : customer
      ? { customer: { name: { contains: customer } }, status: 'contracted' as const }
      : { status: 'contracted' as const };

  const quotes = await prisma.quote.findMany({
    where,
    select: {
      id: true, quote_no: true, status: true, sales_user_id: true, source: true,
      customer: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  });

  if (quotes.length === 0) { console.log('대상이 없습니다.'); return; }

  const to = await adminRecipients();
  console.log(`받는 사람 ${to.length}명: ${to.join(', ') || '(없음)'}`);
  console.log(`대상 ${quotes.length}건:`);
  for (const q of quotes) {
    // 계약완료 = 제작 배정 대기 / 주인 없는 공개 문의 = 영업 배정 대기
    const kind: AssignKind = q.status === 'contracted' ? 'maker'
      : (q.source === 'public' && !q.sales_user_id) ? 'sales' : 'maker';
    const label = `  ${q.quote_no ?? `#${q.id}`} ${q.customer?.name ?? '—'} [${q.status}] → ${kind}`;
    if (dry) { console.log(`${label}  (dry-run · 보내지 않음)`); continue; }
    console.log(label);
    await notifyAssignNeeded(kind, q.id);
  }
  console.log(dry ? '\ndry-run 이라 아무것도 보내지 않았습니다.' : '\n발송 완료.');
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); });
