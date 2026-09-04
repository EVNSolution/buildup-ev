/**
 * **납기 알림** — 특장사에게 「곧입니다 / 오늘입니다 / 지났습니다」를 알린다.
 *
 * 왜 필요한가: 특장사가 단계를 안 밟아 실제로 출고가 끝난 차가 시스템에는 「납기 경과」로
 * 남아 있었다(실제 사례). 사람이 잊는 것이지 악의가 아니다 — 목록은 우리만 보고,
 * 특장사에게는 아무도 알려 주지 않았다. 지금까지 알림은 **채팅·배정 때만** 갔다.
 *
 * ## 언제
 * - 납기 **3일 전** 한 번
 * - 납기 **당일** 한 번
 * - 납기가 **지난 동안 날마다** 한 번 — 지난 건은 재촉이 목적이라 하루치로 끝내지 않는다
 *
 * ## 두 번 가지 않게
 * 백엔드는 blue/green 두 슬롯으로 잠깐 **함께 도는 순간**이 있다. 코드로 막으려 들면
 * 그 사이의 경합을 못 막는다. `(주문, 종류, 보낸 날)` 을 DB 에서 유일하게 두고
 * **먼저 적은 쪽만 보낸다** — 두 번째는 DB 가 거절한다.
 */
import { prisma } from '../lib/prisma.js';
import { dueInfo, DUE_SOON_DAYS } from '@buildup-ev/shared/process/due';
import { notify, pushAllowed } from './push.js';

/** 알림 종류 — 발송 기록의 열쇠이기도 하다 */
export type NudgeKind = 'soon' | 'today' | 'overdue';

/** 하루 중 언제부터 보낼지 — 새벽에 폰이 울리면 안 된다 */
export const NUDGE_HOUR = 9;
/** 얼마나 자주 확인할지. 서버가 그 시각에 꺼져 있었어도 다음 확인에서 보낸다 */
export const NUDGE_CHECK_MS = 30 * 60 * 1000;

/** 이 상태의 주문만 본다 — 수락 전(assigned)·진행 중(ordered) */
const LIVE_STATUS = ['assigned', 'ordered'];

/** `dueInfo` 결과 → 보낼 종류. 보낼 것이 없으면 null */
export function nudgeKindFor(days: number, state: string): NudgeKind | null {
  if (state === 'overdue') return 'overdue';
  if (state === 'soon') {
    if (days === 0) return 'today';
    if (days === DUE_SOON_DAYS) return 'soon';   // 3일 전 하루만 — 매일 보내면 재촉이 무뎌진다
  }
  return null;
}

/** 알림 문구 — 종류마다 무게가 다르다 */
export function nudgeText(kind: NudgeKind, days: number, orderId: number): { title: string; body: string } {
  if (kind === 'overdue') {
    return {
      title: `납기 ${-days}일 경과 · 주문 #${orderId}`,
      body: '납기가 지났습니다. 진행 상황을 단계에 남겨 주세요. 이미 끝난 단계가 있으면 완료로 표시해 주세요.',
    };
  }
  if (kind === 'today') {
    return { title: `오늘이 납기입니다 · 주문 #${orderId}`, body: '진행 상황을 단계에 남겨 주세요.' };
  }
  return { title: `납기 ${days}일 전 · 주문 #${orderId}`, body: '남은 단계를 확인해 주세요.' };
}

/**
 * 한 번 돌면서 보낼 것을 보낸다. **하루에 한 번만** 실제로 나간다.
 *
 * `now` 를 받는 이유는 테스트 때문이다 — 「오늘」이 바뀌어도 결과가 흔들리면 안 된다.
 */
export async function runDueNudge(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
  if (!prisma) return { sent: 0, skipped: 0 };
  // 새벽에는 보내지 않는다. 그 시각을 지나서 처음 도는 차례에 나간다
  if (now.getHours() < NUDGE_HOUR) return { sent: 0, skipped: 0 };

  const orders = await prisma.order.findMany({
    where: {
      canceled_at: null,
      delivery_due: { not: null },
      maker_org_id: { not: null },
      quote: { status: { in: LIVE_STATUS as ('assigned' | 'ordered')[] } },
    },
    select: { id: true, delivery_due: true, maker_org_id: true },
  });

  const sentOn = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let sent = 0;
  let skipped = 0;

  for (const o of orders) {
    const info = dueInfo(o.delivery_due?.toISOString().slice(0, 10), now);
    const kind = nudgeKindFor(info.days, info.state);
    if (!kind) { skipped++; continue; }

    /*
     * **먼저 적고 나서 보낸다.** 반대로 하면 보낸 뒤 기록에 실패했을 때 다음 차례에
     * 또 간다. 이미 있으면 DB 가 거절하고(P2002) 그때는 조용히 넘어간다 —
     * 다른 슬롯이 이미 보냈다는 뜻이다.
     */
    try {
      await prisma.orderDueNotice.create({ data: { order_id: o.id, kind, sent_on: sentOn } });
    } catch {
      skipped++;
      continue;
    }

    // 배정된 특장사 조직의 계정 중 「앱 알림」을 켠 사람에게
    const makers = await prisma.user.findMany({
      where: { org_code: o.maker_org_id!, active: true, status: 'active' },
      select: { email: true },
    });
    const to = await pushAllowed(makers.map(m => m.email));
    if (to.length === 0) { skipped++; continue; }

    const { title, body } = nudgeText(kind, info.days, o.id);
    notify(to, {
      title,
      body,
      // 눌러서 바로 그 주문의 단계로 — 알림만 오고 어디로 가야 할지 모르면 소용이 없다
      url: `/?order=${o.id}`,
      // 같은 주문의 납기 알림은 덮어쓴다 — 며칠치가 쌓이지 않게
      tag: `due-${o.id}`,
    });
    sent++;
  }
  return { sent, skipped };
}

/** 서버가 뜰 때 한 번 걸어 둔다. 정기 실행 장치가 따로 없어 프로세스 안에서 돈다 */
export function startDueNudge(): void {
  const tick = () => { void runDueNudge().catch(e => console.error('[due-nudge]', e)); };
  // 뜨자마자 한 번 — 배포 직후에도 그날 몫이 나간다(이미 보냈으면 DB 가 거절한다)
  setTimeout(tick, 30_000);
  setInterval(tick, NUDGE_CHECK_MS);
}
