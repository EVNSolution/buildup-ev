import { prisma } from '../lib/prisma.js';
import { NOTIFY_TOPIC_BY_CODE, type NotifyExtra } from '@buildup-ev/shared/rbac/presets';
import { appRecipients } from './push.js';

/**
 * **이 알림을 누가 받는가** — 한 곳에서만 정한다(2026-09-16 지시).
 *
 * 받는 사람은 두 갈래다:
 *   · **프리셋** — 「제작 배정 필요는 영업관리·PM·생산관리·마스터」처럼 자리로 정한 몫(shared/rbac/presets)
 *   · **그 건에 얽힌 사람** — 담당 영업, 배정된 특장사 조직, 그 대화에 쓴 사람
 *
 * ⚠️ 알림을 새로 만들면 `NOTIFY_TOPICS` 에 한 줄을 더하고 여기를 통해서 보낸다.
 *    「관리자 전원」으로 뭉뚱그리면 상관없는 사람에게 고객 이름·금액이 간다.
 * ⚠️ 마스터는 프리셋과 무관하게 받는다 — 시스템 주인은 무슨 일이 도는지 볼 수 있어야 한다.
 * ⚠️ **프리셋이 없는 옛 관리자 계정**도 받는다. 프리셋을 지정하기 전까지는 지금처럼 받아야
 *    「아무에게도 안 갔다」가 생기지 않는다(프리셋을 지정하면 그때부터 자리대로 갈린다).
 */
export interface TopicWho {
  /** 담당 영업 이메일 */
  salesOwner?: string | null;
  /** 배정된(또는 거부한) 특장사 조직 코드 */
  makerOrg?: string | null;
  /** 그 대화에 글을 쓴 사람들 */
  thread?: string[];
  /** 알림을 일으킨 사람 — 자기 행동을 자기에게 알리지 않는다 */
  actor?: string | null;
}

export async function topicRecipients(topic: string, who: TopicWho = {}): Promise<string[]> {
  if (!prisma) return [];
  const def = NOTIFY_TOPIC_BY_CODE[topic];
  if (!def) {
    // 목록에 없는 알림은 보내지 않는다 — 받는 사람이 정해지지 않았다는 뜻이다
    console.warn(`[notify] 알림 종류 '${topic}' 가 NOTIFY_TOPICS 에 없다 — 보내지 않는다`);
    return [];
  }
  const want = (k: NotifyExtra) => def.extra.includes(k);

  const [byPreset, makers] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true, status: 'active',
        OR: [
          { is_master: true },
          { admin_preset: { in: def.presets } },
          // 아직 자리를 안 정한 관리자 — 지정 전까지는 예전처럼 받는다
          { AND: [{ admin_preset: null }, { OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }] }] },
        ],
      },
      select: { email: true },
    }),
    want('maker_org') && who.makerOrg
      ? prisma.user.findMany({ where: { org_code: who.makerOrg, active: true, status: 'active' }, select: { email: true } })
      : Promise.resolve([] as { email: string }[]),
  ]);

  const list = [
    ...byPreset.map(u => u.email),
    ...makers.map(u => u.email),
    ...(want('sales_owner') && who.salesOwner ? [who.salesOwner] : []),
    ...(want('thread') ? who.thread ?? [] : []),
  ].filter(e => e !== who.actor);

  // 활성 계정만 — 알림함에는 늘 쌓이고, 휴대폰 팝업은 그 기기가 허용했을 때만 뜬다
  return appRecipients([...new Set(list)]);
}
