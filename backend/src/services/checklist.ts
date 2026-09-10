import { prisma } from '../lib/prisma.js';
import { STEP_BY_CODE, checklistPasses } from '@buildup-ev/shared/process';
import { notify, pushAllowed } from './push.js';

/**
 * PDI 체크리스트 — **서식은 데이터, 규칙은 코드.**
 *
 * 무엇을 확인하는지는 관리자가 화면에서 고친다(`checklist_item`). 어느 단계에
 * 붙고 누가 적는지, 그리고 「채워야 넘어간다」는 규칙은 shared 카탈로그에 있다.
 *
 * ⚠️ 작성을 시작하는 순간 그 시점의 서식을 **주문에 사본으로 얼린다.** 발주서 단가와
 *    같은 원칙 — 서식이 나중에 바뀌어도 이미 합격 처리한 항목의 뜻이 바뀌면 안 된다.
 */

/** 이 단계에 체크리스트가 붙는가 — 붙는다면 적는 사람은 누구인가 */
export function checklistActor(code: string): string | null {
  return STEP_BY_CODE[code]?.checklist ?? null;
}

/**
 * 주문 × 단계의 체크리스트를 **꺼내 온다.** 없으면 지금 서식을 베껴 만든다.
 *
 * 서식이 비어 있으면 **만들지 않는다**(null). 항목을 아직 안 정한 단계에서
 * 빈 체크리스트가 생기면, 낼 것이 없는데 제출도 안 된 상태로 완료가 막힌다.
 */
export async function openChecklist(orderId: number, stepCode: string) {
  if (!prisma) return null;
  const found = await prisma.orderChecklist.findUnique({
    where: { order_id_step_code: { order_id: orderId, step_code: stepCode } },
    include: { lines: { orderBy: { seq: 'asc' } } },
  });
  if (found) return found;

  const items = await prisma.checklistItem.findMany({
    where: { step_code: stepCode, active: true },
    orderBy: [{ seq: 'asc' }, { id: 'asc' }],
  });
  if (items.length === 0) return null;

  return prisma.orderChecklist.create({
    data: {
      order_id: orderId, step_code: stepCode,
      lines: {
        create: items.map((it, i) => ({
          seq: it.seq || i + 1, category: it.category, content: it.content,
        })),
      },
    },
    include: { lines: { orderBy: { seq: 'asc' } } },
  });
}

/**
 * 이 단계를 완료해도 되는가 — 체크리스트 쪽 판정.
 *
 * ⚠️ **서식이 비어 있으면 막지 않는다.** 항목을 아직 안 정한 단계에서 완료가 막히면
 *    진행 중인 주문이 통째로 선다. 체크리스트는 있을 때만 관문이다.
 */
export async function checklistGate(orderId: number, stepCode: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!prisma || !checklistActor(stepCode)) return { ok: true };
  const active = await prisma.checklistItem.count({ where: { step_code: stepCode, active: true } });
  const cl = await prisma.orderChecklist.findUnique({
    where: { order_id_step_code: { order_id: orderId, step_code: stepCode } },
    include: { lines: { select: { result: true } } },
  });
  if (active === 0 && !cl) return { ok: true };          // 아직 서식이 없는 단계
  if (!cl) return { ok: false, reason: '체크리스트를 먼저 작성해야 합니다' };
  if (cl.lines.length === 0) return { ok: true };
  if (!checklistPasses(cl.lines)) {
    const left = cl.lines.filter(l => l.result !== 'pass').length;
    return { ok: false, reason: `체크리스트에 아직 합격이 아닌 항목이 ${left}개 있습니다` };
  }
  if (!cl.submitted_at) return { ok: false, reason: '체크리스트를 제출해야 합니다' };
  return { ok: true };
}

/**
 * 체크리스트가 제출되면 **관리자에게** 알린다.
 *
 * 알림은 켜고 끄는 것 하나만 본다(`notify.push`) — 무슨 알림인지로 갈라 두면
 * 켠 사람이 왜 안 오는지를 설명할 수 없게 된다(지시: 2026-09-10).
 */
export async function notifyChecklistSubmitted(orderId: number, stepCode: string, by: string): Promise<void> {
  if (!prisma) return;
  const label = STEP_BY_CODE[stepCode]?.label ?? stepCode;
  const admins = await prisma.user.findMany({
    where: { active: true, status: 'active', OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }] },
    select: { email: true },
  });
  const to = (await pushAllowed(admins.map(a => a.email))).filter(e => e !== by);
  if (to.length === 0) return;
  notify(to, {
    title: `주문 #${orderId} 체크리스트 제출`,
    body: `${label} 체크리스트가 모두 합격으로 제출됐습니다`,
    url: `/?order=${orderId}`,
    tag: `checklist-${orderId}-${stepCode}`,
  });
}
