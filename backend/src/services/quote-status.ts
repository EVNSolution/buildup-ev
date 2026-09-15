/**
 * 견적 상태 전이 — **여기를 거쳐야만** 상태가 바뀐다.
 *
 * 전이 시각이 남지 않으면 "견적 낸 뒤 며칠 만에 계약됐나", "어디서 오래 묵나"를
 * 영영 알 수 없다. 지나간 시간은 나중에 복구할 방법이 없어, 바꾸는 순간 남겨야 한다.
 *
 * 상태를 바꾸는 곳이 다섯 군데(확정·계약완료·배정·수락·공정완료)로 흩어져 있어
 * 각자 기록하게 두면 언젠가 하나가 빠진다. 그래서 갱신과 기록을 한 함수로 묶었다.
 */
import { prisma } from '../lib/prisma.js';
import { notifyAssignNeeded } from './notify.js';
import { notify, appRecipients } from './push.js';
import type { QuoteStatus } from '@prisma/client';

/** 상태 전이는 변경이력에 section='status' 로 쌓인다(옵션·고객정보와 같은 표). */
export const STATUS_SECTION = 'status';

/**
 * 상태를 바꾸고 그 사실을 이력에 남긴다.
 * 같은 상태로 바꾸려 하면 아무것도 하지 않는다(이력이 지저분해진다).
 *
 * @param by 바꾼 사람(이메일). 시스템 자동 전이는 'system'.
 * @returns 실제로 바뀌었는가
 */
export async function setQuoteStatus(
  quoteId: number, next: QuoteStatus, by: string,
): Promise<boolean> {
  if (!prisma) return false;
  const cur = await prisma.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (!cur || cur.status === next) return false;

  await prisma.$transaction([
    prisma.quote.update({ where: { id: quoteId }, data: { status: next } }),
    prisma.quoteChangeLog.create({
      data: {
        quote_id: quoteId, section: STATUS_SECTION, field: 'status',
        old_value: cur.status, new_value: next, changed_by: by,
      },
    }),
  ]);

  /*
   * **계약완료 = 제작 배정을 기다리는 건이 생겼다.** 여기서 알린다.
   *
   * 예전에는 전자서명 완료 경로에서만 알림을 냈다. 그런데 계약완료로 오는 길은 네 갈래다
   * — 전자서명, 서면계약 스캔본 등록, 특장사 배정 거부, 주문 취소. 뒤 셋은 알림이
   * 나가지 않았고, 실제로 스캔본을 올린 건(화이트축산)이 아무 신호 없이 방치됐다.
   *
   * 부르는 쪽마다 챙기게 두면 새 경로가 생길 때마다 또 빠진다. 그래서 **상태가 바뀌는
   * 이 한 곳**에 건다 — 어떤 경로로 오든 지나가야 하는 문이다.
   *
   * 기다리지 않는다(fire-and-forget). 메일 서버가 느리다고 계약 처리가 느려지면 안 된다.
   */
  /*
   * ⚠️ 2026-09-15 — 서명이 끝났다고 곧장 배정 대기가 아니다. **영업이 서명본을 확인하고 「배정 요청」을 눌러야**
   *    관리자 배정이 열린다. 그래서 관리자 알림은 요청이 이미 있는 건(거부·삭제로 돌아온 건)에만 여기서 내고,
   *    처음 계약완료가 된 건은 담당 영업에게 「배정 요청」을 재촉한다. 요청 시점의 관리자 알림은 요청 API 가 낸다.
   */
  if (next === 'contracted') {
    const q = await prisma.quote.findUnique({ where: { id: quoteId }, select: { assign_requested_at: true, sales_user_id: true, quote_no: true, customer: { select: { name: true } } } });
    if (q?.assign_requested_at) void notifyAssignNeeded('maker', quoteId);
    else if (q?.sales_user_id) {
      const salesTo = q.sales_user_id;
      void appRecipients([salesTo]).then(to => notify(to, {
        title: `배정 요청 필요 — ${q.quote_no ?? `#${quoteId}`}`,
        body: [q.customer?.name, '계약서 서명이 완료되었습니다. 서명본을 확인하고 「배정 요청」을 눌러 주세요.'].filter(Boolean).join(' · '),
        url: '/sales?tab=list',
        tag: `assign-request-${quoteId}`,
      })).catch(e => console.warn('[notify] 배정 요청 알림 실패', e));
    }
  }
  return true;
}

/**
 * 배정 거부·주문 삭제로 **계약완료로 되돌아가는** 건 — 영업이 다시 요청하지 않아도 바로 재배정되게 요청을 살려 둔다.
 * 이 기능 전에 배정된 옛 건은 요청 기록이 없어 여기서 채운다. 이미 있으면 그대로 둔다(처음 요청한 사람·시각 유지).
 * `setQuoteStatus(…, 'contracted')` **보다 먼저** 불러야 관리자 알림이 나간다.
 */
export async function keepAssignRequested(quoteId: number, why: string): Promise<void> {
  if (!prisma) return;
  await prisma.quote.updateMany({
    where: { id: quoteId, assign_requested_at: null },
    data: { assign_requested_at: new Date(), assign_requested_by: `system(${why})` },
  });
}

/**
 * 단계별 도달 시각 — 이력에서 뽑는다.
 *
 * ⚠️ 이력을 남기기 **전에** 진행된 견적은 전이 기록이 없다. 그때는 곁에 남아 있는
 *    시각으로 메운다(계약완료=서명완료 시각, 배정=주문 배정 시각). 없으면 null 이다.
 *    되짚을 수 없는 과거를 지어내지는 않는다.
 */
export interface StageTimes {
  draft: Date;                    // 견적 생성 = created_at
  confirmed: Date | null;
  contracted: Date | null;
  assigned: Date | null;
  ordered: Date | null;
  completed: Date | null;
}

export function stageTimesOf(
  quote: { created_at: Date },
  logs: { new_value: string | null; changed_at: Date }[],
  fallback: { contracted?: Date | null; assigned?: Date | null },
): StageTimes {
  // 같은 단계를 여러 번 오갔다면 **처음 도달한 때**가 기준이다(되돌린 뒤 다시 온 건 재작업).
  const first = (status: string): Date | null => {
    const hit = logs.filter((l) => l.new_value === status)
      .sort((a, b) => a.changed_at.getTime() - b.changed_at.getTime())[0];
    return hit?.changed_at ?? null;
  };
  return {
    draft: quote.created_at,
    confirmed: first('confirmed'),
    contracted: first('contracted') ?? fallback.contracted ?? null,
    assigned: first('assigned') ?? fallback.assigned ?? null,
    ordered: first('ordered'),
    completed: first('completed'),
  };
}
