/**
 * **부가작업** — 특장사가 공장에서 출고한 뒤 고객 인도까지 우리 쪽 작업(2026-09-14).
 *
 *   GET   /orders/:id/addon                    — 단계·고객 인도 목표일·실제 인도일
 *   PATCH /orders/:id/addon/target             — 고객 인도 목표일(배정 이후 언제든, 비우면 지운다)
 *   PATCH /orders/:id/addon/steps/:code        — 단계 완료(인도 완료는 실제 인도일 필수)
 *   PATCH /orders/:id/addon/steps/:code/undo   — 되돌리기(지우지 않고 pending 으로)
 *   GET   /orders/:id/addon/steps/:code/checklist — 그 단계 체크리스트(서식이 없으면 null)
 *   PATCH /orders/:id/addon/steps/:code/checklist — 판정·제출(관리자가 적는다)
 *
 * ⚠️ **관리자 + 기능모듈 `addon.manage`** 만. 특장사에게는 이 경로도, 이 데이터도 없다 —
 *    특장사 화면·API 는 order_step 만 읽고, 부가작업은 order_addon_step·order_addon 에 따로 있다.
 * ⚠️ 규칙(선행·되돌리기)은 shared/process/addon.ts 한 곳 — 화면과 서버가 같은 함수를 쓴다.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { setQuoteStatus } from '../services/quote-status.js';
import {
  ADDON_STEPS, ADDON_BY_CODE, ADDON_LAST, ADDON_OPENS_AFTER, addonCanComplete, addonCanUndo, addonSpots,
} from '@buildup-ev/shared/process/addon';
import { fromDateInput, toDateInput, toDbDate, fromDbDate } from '@buildup-ev/shared/schedule';
import { checklistGate, checklistPayload, judgeChecklist } from '../services/checklist.js';
import { topicRecipients } from '../services/notify-targets.js';
import { notify } from '../services/push.js';

export const addonRouter = Router();

const guard = [rbac('ADMIN'), requirePermission('addon.manage')];

function orderIdOf(req: Request): number | null {
  const n = Number(req.params['id']);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function loadAddon(id: number) {
  return prisma!.order.findUnique({
    where: { id },
    select: {
      id: true, quote_id: true, canceled_at: true, assigned_at: true,
      steps: { where: { code: ADDON_OPENS_AFTER }, select: { status: true, done_at: true } },
      addon_steps: { select: { code: true, status: true, done_at: true, done_by: true, done_on: true } },
      addon: true,
    },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof loadAddon>>>;

/** 화면에 주는 모양 — 카탈로그 순서대로, 안 끝낸 단계도 줄로 준다 */
export function addonView(o: Loaded) {
  const factory = o.steps.find(s => s.status === 'done');
  const rows = o.addon_steps;
  const done = new Set(rows.filter(r => r.status === 'done').map(r => r.code));
  return {
    factory_done: !!factory,
    factory_done_at: factory?.done_at ?? null,
    steps: ADDON_STEPS.map(def => {
      const r = rows.find(x => x.code === def.code && x.status === 'done');
      return {
        code: def.code, track: def.track, label: def.label, requires: def.requires, date_label: def.dateLabel ?? null,
        done: !!r, done_at: r?.done_at ?? null, done_by: r?.done_by ?? null,
        done_on: r?.done_on ? fromDbDate(r.done_on) : null,
        can_complete: addonCanComplete(def.code, done, !!factory),
        can_undo: addonCanUndo(def.code, done),
      };
    }),
    lanes: addonSpots(rows, factory?.done_at ?? null),
    finished: done.has(ADDON_LAST),
    target_on: o.addon?.customer_target_on ? fromDbDate(o.addon.customer_target_on) : null,
    target_set_by: o.addon?.target_set_by ?? null,
    target_set_at: o.addon?.target_set_at ?? null,
    delivered_on: o.addon?.customer_delivered_on ? fromDbDate(o.addon.customer_delivered_on) : null,
  };
}

async function respond(res: Response, id: number): Promise<void> {
  const o = await loadAddon(id);
  if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
  res.json({ data: addonView(o) });
}

// ── GET /orders/:id/addon ─────────────────────────────────────────────────
addonRouter.get('/:id/addon', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } }); return; }
  try { await respond(res, id); } catch (e) {
    console.error('[GET /orders/:id/addon]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '부가작업을 불러오지 못했습니다.' } });
  }
});

// ── PATCH /orders/:id/addon/target — 고객 인도 목표일 ──────────────────────
addonRouter.patch('/:id/addon/target', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } }); return; }
  const raw = (req.body as { date?: unknown })?.date;
  // 비우면 지운다 — 잘못 찍었을 때 되돌릴 길
  const clearing = raw === null || raw === '';
  const day = clearing ? null : (typeof raw === 'string' ? fromDateInput(raw) : null);
  if (!clearing && !day) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '고객 인도 목표일을 YYYY-MM-DD 로 보내야 합니다' } }); return; }
  try {
    const o = await prisma.order.findUnique({ where: { id }, select: { id: true, canceled_at: true, assigned_at: true } });
    if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    if (o.canceled_at) { res.status(409).json({ error: { code: 'CANCELED', message: '취소된 주문입니다' } }); return; }
    // 배정 이후 — 주문 행은 배정할 때 생긴다. 거부돼 배정이 풀린 건도 목표일은 유지·수정할 수 있다
    const who = req.auth?.email ?? 'unknown';
    const data = { customer_target_on: day ? toDbDate(day) : null, target_set_by: who, target_set_at: new Date() };
    await prisma.orderAddon.upsert({ where: { order_id: id }, update: data, create: { order_id: id, ...data } });
    await respond(res, id);
  } catch (e) {
    console.error('[PATCH /orders/:id/addon/target]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객 인도 목표일을 저장하지 못했습니다.' } });
  }
});

// ── PATCH /orders/:id/addon/steps/:code — 완료 ─────────────────────────────
addonRouter.patch('/:id/addon/steps/:code', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  const code = String(req.params['code'] ?? '');
  const def = ADDON_BY_CODE[code];
  if (id === null || !def) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 부가작업 단계입니다' } }); return; }
  try {
    const o = await loadAddon(id);
    if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    if (o.canceled_at) { res.status(409).json({ error: { code: 'CANCELED', message: '취소된 주문입니다' } }); return; }
    const done = new Set(o.addon_steps.filter(r => r.status === 'done').map(r => r.code));
    const gate = addonCanComplete(code, done, o.steps.some(s => s.status === 'done'));
    if (!gate.ok) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: gate.reason } }); return; }
    // 체크리스트 — 서식에 항목이 있는 단계만 관문이다(특장사 단계와 같은 규칙)
    const cl = await checklistGate(id, code);
    if (!cl.ok) { res.status(409).json({ error: { code: 'CHECKLIST_INCOMPLETE', message: cl.reason } }); return; }

    /*
     * 날짜를 받는 단계(인도 완료) — **실제 인도일을 직접 적는다.** 목표일과 다를 수 있다.
     * 앞으로의 날짜는 받지 않는다 — 아직 일어나지 않은 인도를 끝났다고 적을 수는 없다.
     */
    let day: Date | null = null;
    if (def.dateLabel) {
      const raw = (req.body as { date?: unknown })?.date;
      day = typeof raw === 'string' ? fromDateInput(raw) : null;
      if (!day) { res.status(400).json({ error: { code: 'BAD_INPUT', message: `${def.dateLabel}을 골라 주세요` } }); return; }
      if (toDateInput(day) > toDateInput(new Date())) {
        res.status(400).json({ error: { code: 'BAD_INPUT', message: `${def.dateLabel}은 오늘 이후로 적을 수 없습니다` } }); return;
      }
    }

    const who = req.auth?.email ?? 'unknown';
    const now = new Date();
    const data = { status: 'done', done_at: now, done_by: who, done_on: day ? toDbDate(day) : null };
    /*
     * ⚠️ **한 번만 끝난다.** 되돌린 적 있는 단계는 행이 pending 으로 남아 있다 — 그 행을 조건부로 올리고,
     *    처음이면 새로 만든다. 동시에 두 번 누르면 하나는 행이 이미 done(조건 불일치)이거나
     *    유일 제약(order_id, code)에 걸려 409 가 된다.
     */
    const bumped = await prisma.orderAddonStep.updateMany({ where: { order_id: id, code, status: 'pending' }, data });
    if (bumped.count === 0) {
      try {
        await prisma.orderAddonStep.create({ data: { order_id: id, code, ...data } });
      } catch {
        res.status(409).json({ error: { code: 'CONFLICT', message: '이미 완료된 단계입니다' } }); return;
      }
    }

    // 고객 인도 완료 — 실제 인도일을 남기고 **이때 견적이 「완료」가 된다**(예전엔 특장사 출고 때)
    if (code === ADDON_LAST && day) {
      await prisma.orderAddon.upsert({
        where: { order_id: id },
        update: { customer_delivered_on: toDbDate(day) },
        create: { order_id: id, customer_delivered_on: toDbDate(day) },
      });
      await setQuoteStatus(o.quote_id, 'completed', who);
      /*
       * **고객 인도 완료** 알림(2026-09-16) — 거래가 끝난 순간이다. 담당 영업과
       * 영업관리·PM·생산관리·경영관리·마스터가 본다(shared/rbac/presets).
       */
      const q = await prisma.quote.findUnique({ where: { id: o.quote_id }, select: { quote_no: true, sales_user_id: true, customer: { select: { name: true } } } });
      const to = await topicRecipients('order.handover', { salesOwner: q?.sales_user_id, actor: who });
      if (to.length > 0) {
        notify(to, {
          title: `고객 인도 완료 — ${q?.quote_no ?? `주문 #${id}`}`,
          body: [q?.customer?.name, `인도일 ${toDateInput(day)}`].filter(Boolean).join(' · '),
          url: `/?order=${id}`,
          tag: `handover-${id}`,
        });
      }
    }
    await respond(res, id);
  } catch (e) {
    console.error('[PATCH /orders/:id/addon/steps/:code]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '부가작업 단계를 저장하지 못했습니다.' } });
  }
});

// ── PATCH /orders/:id/addon/steps/:code/undo — 되돌리기 ─────────────────────
addonRouter.patch('/:id/addon/steps/:code/undo', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !ADDON_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 부가작업 단계입니다' } }); return; }
  try {
    const o = await loadAddon(id);
    if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    const done = new Set(o.addon_steps.filter(r => r.status === 'done').map(r => r.code));
    const gate = addonCanUndo(code, done);
    if (!gate.ok) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: gate.reason } }); return; }
    const who = req.auth?.email ?? 'unknown';
    const r = await prisma.orderAddonStep.updateMany({
      where: { order_id: id, code, status: 'done' },
      data: { status: 'pending', done_at: null, done_on: null, done_by: null, note: `${toDateInput(new Date())} ${who} 되돌림` },
    });
    if (r.count === 0) { res.status(409).json({ error: { code: 'CONFLICT', message: '이미 되돌린 단계입니다' } }); return; }
    // 고객 인도를 되돌리면 실제 인도일을 지우고 견적도 「주문진행」으로 — 완료로 올릴 때와 짝
    if (code === ADDON_LAST) {
      await prisma.orderAddon.updateMany({ where: { order_id: id }, data: { customer_delivered_on: null } });
      const q = await prisma.quote.findUnique({ where: { id: o.quote_id }, select: { status: true } });
      if (q?.status === 'completed') await setQuoteStatus(o.quote_id, 'ordered', who);
    }
    await respond(res, id);
  } catch (e) {
    console.error('[PATCH /orders/:id/addon/steps/:code/undo]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '부가작업 단계를 되돌리지 못했습니다.' } });
  }
});

// ── 부가작업 체크리스트 — 관리자 + addon.manage 만(특장사 경로로는 부가작업 코드가 열리지 않는다) ─────────
addonRouter.get('/:id/addon/steps/:code/checklist', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !ADDON_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 부가작업 단계입니다' } }); return; }
  try {
    const o = await loadAddon(id);
    if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    res.json({ data: await checklistPayload(id, code) });
  } catch (e) {
    console.error('[GET /orders/:id/addon/steps/:code/checklist]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '체크리스트를 불러오지 못했습니다.' } });
  }
});

addonRouter.patch('/:id/addon/steps/:code/checklist', ...guard, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = orderIdOf(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !ADDON_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 부가작업 단계입니다' } }); return; }
  try {
    const o = await loadAddon(id);
    if (!o) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }
    const r = await judgeChecklist(id, code, req.body as { lines?: unknown; submit?: unknown }, req.auth?.email ?? 'unknown');
    res.status(r.status).json(r.body);
  } catch (e) {
    console.error('[PATCH /orders/:id/addon/steps/:code/checklist]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '체크리스트를 저장하지 못했습니다.' } });
  }
});
