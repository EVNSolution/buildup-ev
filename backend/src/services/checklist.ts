import { prisma } from '../lib/prisma.js';
import { STEP_BY_CODE, checklistPasses, checklistActorOf } from '@buildup-ev/shared/process';
import { ADDON_BY_CODE } from '@buildup-ev/shared/process/addon';
import { notify, appRecipients } from './push.js';

/**
 * PDI 체크리스트 — **서식은 데이터, 규칙은 코드.**
 *
 * 무엇을 확인하는지는 관리자가 화면에서 고친다(`checklist_item`). 어느 단계에
 * 붙고 누가 적는지, 그리고 「채워야 넘어간다」는 규칙은 shared 카탈로그에 있다.
 *
 * ⚠️ **제출하면 얼린다.** 발주서 단가와 같은 원칙 — 제출한 뒤 서식이 바뀌어도 합격 처리한 항목의 뜻이 바뀌면 안 된다.
 * ⚠️ **제출 전에는 서식을 따라간다**(2026-09-15 제보 — 작성을 시작했다는 이유로 고친 항목이 반영되지 않았다).
 *    열 때마다 지금 서식과 맞춘다: 새 항목은 줄을 더하고, 빠진 항목은 줄을 감추고(지우지 않는다),
 *    문구가 바뀐 항목은 **판정을 비운다**(다른 것을 확인하라는 뜻이 됐으니 옛 합격이 남으면 안 된다).
 *    구분·순서만 바뀐 항목은 판정을 그대로 둔다.
 */

/** 보이는 줄 — 서식에서 빠져 감춘 줄은 뺀다 */
const LIVE_LINES = { where: { retired_at: null }, orderBy: { seq: 'asc' as const } };

/**
 * 이 단계의 체크리스트를 **누가 적는가** — 모든 단계에 붙을 수 있다(2026-09-15).
 * 특장사 단계는 단계 정의로, 부가작업 단계(관리자 전용)는 관리자. 모르는 코드면 null.
 * 서식이 비어 있으면 붙어도 아무 일이 없다(openChecklist 가 null, checklistGate 가 통과).
 */
export function checklistActor(code: string): string | null {
  const def = STEP_BY_CODE[code];
  if (def) return checklistActorOf(def);
  return ADDON_BY_CODE[code] ? 'ADMIN' : null;
}

/**
 * 화면에 주는 체크리스트 — 특장사 단계 라우트와 부가작업 라우트가 같이 쓴다. 서식이 없으면 null.
 */
export async function checklistPayload(orderId: number, code: string) {
  if (!prisma) return null;
  const actor = checklistActor(code);
  if (!actor) return null;
  const cl = await openChecklist(orderId, code);
  if (!cl) return null;
  const logs = await prisma.orderChecklistLineLog.findMany({
    where: { line: { checklist_id: cl.id } },
    orderBy: { id: 'asc' },
  });
  return {
    step_code: code,
    /** 적는 사람 — 이 역할이 아니면 화면에서 보기만 한다 */
    actor,
    submitted_at: cl.submitted_at?.toISOString() ?? null,
    submitted_by: cl.submitted_by,
    lines: cl.lines.map(l => ({
      id: l.id, seq: l.seq, category: l.category, content: l.content,
      result: l.result, memo: l.memo,
      checked_at: l.checked_at?.toISOString() ?? null, checked_by: l.checked_by,
      /* 조치 후 재검이 남는다 — 「한 번에 통과」와 「고쳐서 통과」는 다른 이야기다 */
      logs: logs.filter(g => g.line_id === l.id)
        .map(g => ({ result: g.result, memo: g.memo, at: g.at.toISOString(), by: g.by })),
    })),
  };
}

/**
 * 항목을 판정하고(쌓는다) `submit` 이면 제출한다 — 역할 확인은 부르는 쪽이 한다.
 * 결과는 HTTP 로 그대로 돌려줄 모양이다.
 */
export async function judgeChecklist(
  orderId: number, code: string, body: { lines?: unknown; submit?: unknown }, who: string,
): Promise<{ status: number; body: unknown }> {
  const cl = await openChecklist(orderId, code);
  if (!cl) return { status: 409, body: { error: { code: 'STEP_BLOCKED', message: '이 단계의 체크리스트 서식이 아직 없습니다' } } };

  const inLines = Array.isArray(body.lines) ? body.lines as { id?: number; result?: string; memo?: string }[] : [];
  const mine = new Map(cl.lines.map(l => [l.id, l]));
  const now = new Date();

  for (const raw of inLines) {
    const line = typeof raw.id === 'number' ? mine.get(raw.id) : undefined;
    if (!line) continue;                                  // 남의 줄·감춘 줄은 무시한다
    const result = raw.result === 'pass' || raw.result === 'fail' ? raw.result : null;
    if (!result) continue;
    const memo = typeof raw.memo === 'string' ? raw.memo.trim().slice(0, 300) : null;
    // 같은 판정을 같은 메모로 다시 보내면 이력을 늘리지 않는다
    if (line.result === result && (line.memo ?? null) === (memo || null)) continue;
    await prisma!.$transaction([
      prisma!.orderChecklistLine.update({
        where: { id: line.id },
        data: { result, memo: memo || null, checked_at: now, checked_by: who },
      }),
      prisma!.orderChecklistLineLog.create({
        data: { line_id: line.id, result, memo: memo || null, by: who },
      }),
    ]);
  }

  const after = await prisma!.orderChecklist.findUniqueOrThrow({
    where: { id: cl.id }, include: { lines: { where: { retired_at: null }, select: { result: true } } },
  });
  const allPass = checklistPasses(after.lines);

  if (body.submit === true) {
    if (!allPass) {
      return { status: 409, body: { error: { code: 'CHECKLIST_INCOMPLETE', message: '합격이 아닌 항목이 남아 있어 제출할 수 없습니다' } } };
    }
    if (!after.submitted_at) {
      await prisma!.orderChecklist.update({ where: { id: cl.id }, data: { submitted_at: now, submitted_by: who } });
      await notifyChecklistSubmitted(orderId, code, who);
    }
  } else if (!allPass && after.submitted_at) {
    /*
     * 제출한 뒤에 불합격이 생기면 **제출을 거둔다.** 그대로 두면 「제출됨」인데
     * 안에는 불합격이 있는 상태가 남아, 관문이 무엇을 보는지 흐려진다.
     */
    await prisma!.orderChecklist.update({ where: { id: cl.id }, data: { submitted_at: null, submitted_by: null } });
  }
  return { status: 200, body: { data: { ok: true, all_pass: allPass } } };
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
    select: { id: true, submitted_at: true },
  });
  if (found) {
    if (!found.submitted_at) await syncWithTemplate(found.id, stepCode);
    return prisma.orderChecklist.findUniqueOrThrow({ where: { id: found.id }, include: { lines: LIVE_LINES } });
  }

  const items = await prisma.checklistItem.findMany({
    where: { step_code: stepCode, active: true },
    orderBy: [{ seq: 'asc' }, { id: 'asc' }],
  });
  if (items.length === 0) return null;

  try {
    return await prisma.orderChecklist.create({
      data: {
        order_id: orderId, step_code: stepCode,
        lines: {
          create: items.map((it, i) => ({
            seq: it.seq || i + 1, category: it.category, content: it.content, item_id: it.id,
          })),
        },
      },
      include: { lines: LIVE_LINES },
    });
  } catch {
    // 두 화면이 동시에 처음 열었다 — 먼저 만든 쪽을 쓴다(order_id·step_code 유일)
    return prisma.orderChecklist.findUnique({
      where: { order_id_step_code: { order_id: orderId, step_code: stepCode } },
      include: { lines: LIVE_LINES },
    });
  }
}

/**
 * **제출 전 체크리스트를 지금 서식과 맞춘다.**
 *
 * 짝은 `item_id` 로 짓는다. 이 칸이 생기기 전에 만든 줄(item_id 없음)은 구분·문구가 같은 서식 항목과 짝지어
 * 그때 item_id 를 채운다 — 짝이 없으면 서식에서 빠진 것으로 보고 감춘다.
 */
export async function syncWithTemplate(checklistId: number, stepCode: string): Promise<void> {
  if (!prisma) return;
  const now = new Date();
  const [items, lines] = await Promise.all([
    prisma.checklistItem.findMany({ where: { step_code: stepCode, active: true }, orderBy: [{ seq: 'asc' }, { id: 'asc' }] }),
    prisma.orderChecklistLine.findMany({ where: { checklist_id: checklistId }, orderBy: { id: 'asc' } }),
  ]);

  const byItem = new Map<number, typeof lines[number]>();
  for (const l of lines) if (l.item_id != null) byItem.set(l.item_id, l);
  // 옛 줄 — 구분·문구가 같은 항목과 짝짓는다
  for (const l of lines) {
    if (l.item_id != null) continue;
    const it = items.find(x => !byItem.has(x.id) && x.category === l.category && x.content === l.content);
    if (it) { byItem.set(it.id, l); await prisma.orderChecklistLine.update({ where: { id: l.id }, data: { item_id: it.id } }); l.item_id = it.id; }
  }

  const liveIds = new Set(items.map(i => i.id));
  for (const [i, it] of items.entries()) {
    const seq = it.seq || i + 1;
    const l = byItem.get(it.id);
    if (!l) {
      await prisma.orderChecklistLine.createMany({
        data: [{ checklist_id: checklistId, seq, category: it.category, content: it.content, item_id: it.id }],
        skipDuplicates: true,
      });
      continue;
    }
    const textChanged = l.content !== it.content;
    if (textChanged || l.category !== it.category || l.seq !== seq || l.retired_at) {
      await prisma.orderChecklistLine.update({
        where: { id: l.id },
        data: {
          seq, category: it.category, content: it.content, retired_at: null,
          // 확인할 내용이 바뀌었다 — 옛 판정은 이 문구에 대한 것이 아니다(이력은 남는다)
          ...(textChanged ? { result: null, memo: null, checked_at: null, checked_by: null } : {}),
        },
      });
    }
  }
  // 서식에서 빠진 항목의 줄 · 짝을 못 찾은 옛 줄 — 감춘다
  const gone = lines.filter(l => !l.retired_at && (l.item_id == null || !liveIds.has(l.item_id))).map(l => l.id);
  if (gone.length) await prisma.orderChecklistLine.updateMany({ where: { id: { in: gone } }, data: { retired_at: now } });
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
  let cl = await prisma.orderChecklist.findUnique({
    where: { order_id_step_code: { order_id: orderId, step_code: stepCode } },
    include: { lines: { where: { retired_at: null }, select: { result: true } } },
  });
  // 제출 전이면 지금 서식 기준으로 판정한다
  if (cl && !cl.submitted_at) {
    await syncWithTemplate(cl.id, stepCode);
    cl = await prisma.orderChecklist.findUnique({
      where: { id: cl.id },
      include: { lines: { where: { retired_at: null }, select: { result: true } } },
    });
  }
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
 * 받는 사람은 활성 관리자 — 기능모듈로 거르지 않는다(기능모듈은 메일 여부만, 지시 2026-09-14).
 * 푸시가 뜨는지는 그 기기가 알림을 허용했는지로 정해진다.
 */
export async function notifyChecklistSubmitted(orderId: number, stepCode: string, by: string): Promise<void> {
  if (!prisma) return;
  const label = STEP_BY_CODE[stepCode]?.label ?? ADDON_BY_CODE[stepCode]?.label ?? stepCode;
  const admins = await prisma.user.findMany({
    where: { active: true, status: 'active', OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }] },
    select: { email: true },
  });
  const to = (await appRecipients(admins.map(a => a.email))).filter(e => e !== by);
  if (to.length === 0) return;
  notify(to, {
    title: `주문 #${orderId} 체크리스트 제출`,
    body: `${label} 체크리스트가 모두 합격으로 제출됐습니다`,
    url: `/?order=${orderId}`,
    tag: `checklist-${orderId}-${stepCode}`,
  });
}
