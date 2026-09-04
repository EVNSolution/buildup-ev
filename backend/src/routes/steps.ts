/**
 * 주문 단계 — 읽기와 완료 처리.
 *
 * **규칙은 shared 에 있다**(`shared/process/steps.ts`). 선행 단계와 필수 증빙을 여기서
 * 다시 적지 않는다 — 화면과 서버가 같은 함수로 판정해야 화면에서 눌리는데 서버가
 * 거절하는 일이 안 생긴다(납기 검증에서 같은 원칙을 썼다).
 *
 * 권한: 자기 조직 주문만(특장사) · 관리자는 전부. 단계마다 정해진 담당(actor)이 있지만
 * **담당이 아니어도 대신 눌러 줄 수 있게 둔다** — 현장에서 대신 처리하는 일이 흔하고,
 * 누가 눌렀는지는 done_by 에 남는다. 막아야 할 것은 남의 조직 주문이다.
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { setQuoteStatus } from '../services/quote-status.js';
import { rbac, isAdmin, requirePermission } from '../middleware/rbac.js';
import {
  STEPS, STEP_BY_CODE, canComplete, canUndo, isOverdue, overdueDays, newlyOpened,
  stepsFor, stepMapFor, acceptsEvidence, EXTRA_EVIDENCE,
  type EvidenceKind, type StepDef, type StepState,
  isExtraEvidence, evidenceFileName,
} from '@buildup-ev/shared/process';
import { fromDateInput, toDbDate, fromDbDate } from '@buildup-ev/shared/schedule';
import { keepsOriginal, EVIDENCE_LABEL } from '@buildup-ev/shared/process';
import multer from 'multer';
import {
  listComments, listAllComments, addComment, unreadByStep, markRead, markAllRead, COMMENT_MAX,
} from '../services/step-comments.js';
import { writeFile, unlink, stat, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import {
  ALLOWED_MIME, maxBytesFor, MAX_DOC_BYTES, reserveFilePath, resolveStoredPath, safeDisplayName,
} from '../lib/uploads.js';

export const stepsRouter = Router();

/**
 * 단계를 **바꾸는** 동작에 필요한 권한 — 기능모듈 「주문 상태 변경」(order.control).
 *
 * 조회에는 걸지 않는다. 관리자가 진행을 들여다보는 것과 단계를 대신 완료 처리하는 것은
 * 다른 일이라, 계정마다 켜고 끌 수 있어야 한다(특장사 역할에는 기본으로 켜져 있다).
 * ⚠️ 화면에서 버튼을 감추는 것만으로는 막은 것이 아니다 — 서버가 최종 판정한다.
 */
const canChangeSteps = requirePermission('order.control');

/**
 * 핸들러 예외를 붙잡아 **이유를 실어** 돌려준다.
 *
 * ⚠️ 예전에는 try/catch 가 없어, DB 오류든 무엇이든 Express 기본 처리로 **본문 없는 500**
 *    이 나갔다. 화면에는 「단계 완료 실패: 500」만 뜨고 사용자도 우리도 원인을 알 수 없었다
 *    (실제 제보). 서버 로그에 남기고, 화면에는 적어도 무슨 일이었는지 알려 준다.
 */
function guard(
  fn: (req: Request, res: Response) => Promise<void>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      console.error(`[steps] ${req.method} ${req.originalUrl}`, e);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'INTERNAL', message: '단계 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하십시오.' } });
      }
    }
  };
}

function orderId(req: Request): number | null {
  const n = Number(req.params['id']);
  return Number.isInteger(n) ? n : null;
}

/**
 * 주문에 접근할 수 있나 — **주문 목록과 같은 범위 규칙**을 쓴다.
 *
 * 관리자는 전부, 특장사는 자기 조직에 배정된 것, 영업은 자기 견적에서 나온 것.
 * 겸직이면 둘 다(영업+특장 = 자기 견적의 주문 ∪ 자기 조직 주문).
 * ⚠️ 여기서 역할만 보고 통과시키면 **영업 아무나 남의 주문 단계를 본다** — 실제로 그랬다.
 */
type LoadResult =
  | { err: 503 | 404 | 403 }
  | { order: {
      id: number; quote_id: number; maker_org_id: string | null; assigned_at: Date | null;
      created_at: Date; accepted_at: Date | null; delivery_due: Date | null;
      /** 특장만 주문 — 단계 카탈로그가 달라진다(차량 트랙이 「차량 도착」 하나로 줄어든다) */
      body_only: boolean;
      /** 고객 이름 — **올린 파일 이름**에 들어간다(19.여준성_특장장착.jpg). 없을 수 있다 */
      customer_name: string | null;
    } };

/** 접근 실패를 상태에 맞는 코드·문구로. 404 에 FORBIDDEN 을 실어 보내지 않는다. */
function denyOrder(res: Response, err: 503 | 404 | 403): void {
  const map = {
    503: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' },
    404: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' },
    403: { code: 'FORBIDDEN', message: '이 주문에 접근할 권한이 없습니다' },
  } as const;
  res.status(err).json({ error: map[err] });
}

async function loadOrder(id: number, req: Request): Promise<LoadResult> {
  if (!prisma) return { err: 503 };
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true, quote_id: true, maker_org_id: true, assigned_at: true, created_at: true,
      accepted_at: true, delivery_due: true,
      // 특장만 여부는 견적 입력에 남아 있다(견적서를 다시 뽑아도 같은 금액이 나와야 해서)
      // 고객 이름은 **올린 파일 이름**에 들어간다(19.여준성_특장장착.jpg)
      quote: { select: { sales_user_id: true, inputs: true, customer: { select: { name: true } } } },
    },
  });
  if (!order) return { err: 404 };

  const auth = req.auth!;
  if (!isAdmin(auth)) {
    const mine =
      (auth.roles.includes('MAKER') && order.maker_org_id === auth.org_code) ||
      (auth.roles.includes('SALES') && order.quote?.sales_user_id === auth.email);
    if (!mine) return { err: 403 };
  }
  const inputs = order.quote?.inputs as { body_only?: unknown } | null;
  return {
    order: {
      ...order,
      body_only: inputs?.body_only === true,
      customer_name: order.quote?.customer?.name ?? null,
    },
  };
}

/**
 * 단계 행이 없으면 만들어 준다 — 이관 스크립트를 못 돌린 주문(새로 생긴 주문 등)도
 * 화면이 비지 않게. 이미 있으면 건드리지 않는다.
 */
async function ensureSteps(id: number, base: Date, defs: StepDef[] = STEPS) {
  /*
   * 특장만 주문이 **나중에** 그렇게 정해질 수도 있다(견적을 고쳐 저장하면).
   * 이미 만들어 둔 행 중 해당 없는 단계는 **지우지 않고** 「해당 없음(skipped)」으로 표시한다 —
   * 지우면 그때까지의 기록도 함께 사라진다. 이미 끝난 것은 건드리지 않는다.
   */
  const applicable = new Set(defs.map(d => d.code));
  const n = await prisma!.orderStep.count({ where: { order_id: id } });
  if (n > 0) {
    if (applicable.size < STEPS.length) {
      await prisma!.orderStep.updateMany({
        where: { order_id: id, code: { notIn: [...applicable] }, status: 'pending' },
        data: { status: 'skipped' },
      });
    } else {
      /*
       * 반대 방향도 되돌아와야 한다 — 특장만으로 잘못 저장했다가 고치면
       * 차량 단계가 「해당 없음」인 채로 남아, **아무도 누를 수 없는 주문**이 된다.
       * 「해당 없음」을 붙이는 곳이 여기뿐이라(다른 이유로 skipped 가 되는 일이 없다)
       * 되돌려도 남의 기록을 덮어쓰지 않는다.
       */
      await prisma!.orderStep.updateMany({
        where: { order_id: id, status: 'skipped' },
        data: { status: 'pending' },
      });
    }
    return;
  }
  await prisma!.orderStep.createMany({
    data: defs.map(s => ({
      order_id: id, code: s.code, track: s.track, status: 'pending', entered_at: base,
    })),
    skipDuplicates: true,
  });
}

// ── GET /orders/:id/steps — 진행 상황 + 증빙 목록 ──────────────────────────
stepsRouter.get('/:id/steps', rbac('ADMIN', 'SALES', 'MAKER'), guard(async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 주문 번호입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { denyOrder(res, r.err); return; }

  const defs = stepsFor(r.order.body_only);
  await ensureSteps(id, r.order.assigned_at ?? r.order.created_at, defs);

  const [rows, files] = await Promise.all([
    prisma!.orderStep.findMany({ where: { order_id: id } }),
    prisma!.orderFile.findMany({
      where: { order_id: id },
      select: { id: true, step_code: true, kind: true, original_name: true, display_name: true, size_bytes: true, kept_original: true, uploaded_by: true, uploaded_at: true },
      orderBy: { uploaded_at: 'asc' },
    }),
  ]);

  const byCode = new Map(rows.map(x => [x.code, x]));
  const doneCodes = new Set(rows.filter(x => x.status === 'done').map(x => x.code));
  const now = new Date();

  /**
   * 이 단계의 마감이 언제인가 — **약속한 날**에서만 온다.
   * 납기일은 주문에서(수락하며 약속), 검사 마감은 안전검사 신청 단계에서(신청하며 적음).
   */
  const dueOf = (def: StepDef): string | null => {
    if (!def.dueFrom) return null;
    if (def.dueFrom.from === 'order') {
      return r.order.delivery_due ? fromDbDate(r.order.delivery_due) : null;
    }
    const src = byCode.get(def.dueFrom.code);
    return src?.planned_at ? fromDbDate(src.planned_at) : null;
  };

  // 카탈로그 순서로 내려준다 — 화면이 정렬을 다시 하지 않게.
  // 특장만 주문에서는 해당 없는 차량 단계가 여기서 이미 빠져 있다.
  const data = defs.map(def => {
    const row = byCode.get(def.code);
    const mine = files.filter(f => f.step_code === def.code);
    const due = dueOf(def);
    return {
      code: def.code,
      track: def.track,
      status: row?.status ?? 'pending',
      planned_at: row?.planned_at ? fromDbDate(row.planned_at) : null,
      entered_at: row?.entered_at?.toISOString() ?? null,
      done_at: row?.done_at?.toISOString() ?? null,
      done_by: row?.done_by ?? null,
      note: row?.note ?? null,
      /** 약속한 마감 (YYYY-MM-DD). 마감이 없는 단계는 null */
      due_at: due,
      /** 마감을 며칠 넘겼나. 안 넘겼거나 마감이 없으면 null */
      overdue_days: row && row.status !== 'done' ? overdueDays(due, now) : null,
      stalled: isOverdue(def.code, row ? { code: def.code, status: row.status as StepState['status'] } : undefined, due, now, doneCodes, defs),
      files: mine.map(f => ({
        // 서버가 지은 이름을 쓰고, 없으면(옛 파일) 올릴 때 이름으로 돌아간다
        id: f.id, kind: f.kind, name: f.display_name ?? f.original_name, size: f.size_bytes,
        kept_original: f.kept_original, uploaded_by: f.uploaded_by, uploaded_at: f.uploaded_at.toISOString(),
      })),
    };
  });

  /*
   * 단계 목록과 함께 **주문 자체의 기록**을 내려준다.
   * 발주 발행·수락·납기는 단계가 아니라 이미 끝난 사실이다 — 화면은 이것을 머리말에
   * 적어 두고, 「완료/되돌리기」 대상으로 두지 않는다.
   */
  res.json({
    data,
    order: {
      assigned_at: r.order.assigned_at?.toISOString() ?? null,
      accepted_at: r.order.accepted_at?.toISOString() ?? null,
      delivery_due: r.order.delivery_due ? fromDbDate(r.order.delivery_due) : null,
      /** 특장만 주문 — 화면이 차량 트랙 안내를 다르게 적는다 */
      body_only: r.order.body_only,
    },
  });
}));

// ── PATCH /orders/:id/steps/:code — 단계 완료 ─────────────────────────────
stepsRouter.patch('/:id/steps/:code', rbac('ADMIN', 'SALES', 'MAKER'), canChangeSteps, guard(async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !STEP_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { denyOrder(res, r.err); return; }

  const defs = stepsFor(r.order.body_only);
  await ensureSteps(id, r.order.assigned_at ?? r.order.created_at, defs);

  // 이 주문에 해당하지 않는 단계는 완료할 수 없다 — 특장만 주문의 번호판 단계 같은 것
  const def = stepMapFor(r.order.body_only)[code];
  if (!def) {
    res.status(409).json({ error: { code: 'STEP_BLOCKED', message: '이 주문에는 해당하지 않는 단계입니다' } }); return;
  }
  const [rows, files] = await Promise.all([
    prisma!.orderStep.findMany({ where: { order_id: id }, select: { code: true, status: true } }),
    prisma!.orderFile.findMany({ where: { order_id: id, step_code: code }, select: { kind: true } }),
  ]);

  const already = rows.find(x => x.code === code);
  if (already?.status === 'done') {
    res.status(409).json({ error: { code: 'CONFLICT', message: '이미 완료 처리된 단계입니다' } }); return;
  }

  // 선행 단계·증빙 판정 — 화면과 같은 함수
  const gate = canComplete(
    code,
    rows.map(x => ({ code: x.code, status: x.status as StepState['status'] })),
    files.map(f => f.kind as EvidenceKind),
    defs,
  );
  if (!gate.ok) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: gate.reason } }); return; }

  /*
   * ⚠️ 예전엔 여기서 「전자서명이 완료되고 서명본을 내려받았는가」를 확인했다.
   *    **튜닝은 전자서명을 쓰지 않기로 했다** — 종이로 받아 스캔해 올린다.
   *    그 검사를 남겨 두면 서명본을 올려도 완료가 영영 막힌다(올린 파일과 무관한 검사다).
   *    이제는 파일이 올라왔는지(`evidence`)를 canComplete 가 본다.
   *    전자서명을 다시 켤 때는 이 자리에 검사를 되살릴 것.
   */


  // 날짜를 받는 단계는 날짜가 있어야 한다(납기·검사예정일·인도일)
  let planned: Date | null = null;
  if (def.dateLabel) {
    const raw = typeof (req.body as { planned_at?: unknown })?.planned_at === 'string'
      ? (req.body as { planned_at: string }).planned_at : '';
    const d = fromDateInput(raw);
    if (!d) { res.status(400).json({ error: { code: 'BAD_INPUT', message: `${def.dateLabel}을(를) YYYY-MM-DD 로 보내야 합니다` } }); return; }
    planned = toDbDate(d);
  }

  const now = new Date();
  await prisma!.orderStep.update({
    where: { order_id_code: { order_id: id, code } },
    data: {
      status: 'done', done_at: now, done_by: req.auth?.email ?? 'unknown',
      ...(planned ? { planned_at: planned } : {}),
    },
  });

  /*
   * 다음 단계의 시계를 켠다 — 이 단계가 끝나 **비로소 열린** 단계만.
   *
   * ⚠️ 「지금 열려 있는 단계 전부」로 잡으면 안 된다. 무관한 단계를 하나 완료할 때마다
   *    이미 열려서 며칠째 멈춰 있던 단계의 entered_at 까지 지금으로 덮어써, **정체 시계가
   *    리셋**된다. 그러면 오래 방치된 건이 영원히 재촉되지 않는다.
   *    그래서 이번 완료 **전에는 안 열렸는데 후에 열린** 것만 고른다.
   */
  const before = new Set(rows.filter(x => x.status === 'done').map(x => x.code));
  const opened = newlyOpened(code, before, defs);
  if (opened.length > 0) {
    await prisma!.orderStep.updateMany({
      where: { order_id: id, code: { in: opened }, status: 'pending' },
      data: { entered_at: now },
    });
  }

  /*
   * 인도가 끝나면 **견적 단계도 완료로 올린다.**
   * 옛 `PATCH /orders/:id/status` 가 「인도완료」를 찍을 때 하던 일이다 — 그 라우트를
   * 걷어내면서 이 연결이 끊기면, 인도가 끝나도 견적은 영원히 「주문진행」에 남는다
   * (마이페이지 집계와 영업 목록이 그 값을 읽는다).
   */
  if (code === 'delivered') {
    const q = await prisma!.quote.findUnique({ where: { id: r.order.quote_id }, select: { status: true } });
    /*
     * ⚠️ **어느 상태에서 왔든 올린다.** 예전에는 `ordered` 일 때만 올렸는데, 그러면
     *    다른 상태로 인도에 도달한 건은 **영원히 갇힌다** — 단계는 전부 끝났는데
     *    목록에서는 계속 「진행 중」이다(실제로 15/15 인데 견적은 `confirmed` 인 건이 있었다).
     *    인도 단계가 끝났다는 사실이 곧 인도가 끝났다는 뜻이고, 그게 판단의 근거다.
     */
    if (q && q.status !== 'completed') {
      await setQuoteStatus(r.order.quote_id, 'completed', req.auth?.email ?? 'unknown');
    }
  }

  res.json({ data: { ok: true, opened } });
}));



// ── PATCH /orders/:id/steps/:code/undo — 완료를 되돌린다 ────────────────────
//
// 잘못 누르는 일은 반드시 생긴다. 되돌릴 길이 없으면 사람들은 **틀린 기록을 그냥 두거나**
// DB 를 직접 고쳐 달라고 한다 — 둘 다 기록을 못 믿게 만든다.
// 대신 **뒤 단계가 이미 끝났으면 막는다**(뒤에서부터 풀어야 앞뒤가 맞는다).
stepsRouter.patch('/:id/steps/:code/undo', rbac('ADMIN', 'SALES', 'MAKER'), canChangeSteps, guard(async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !STEP_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { denyOrder(res, r.err); return; }

  const rows = await prisma!.orderStep.findMany({ where: { order_id: id }, select: { code: true, status: true } });
  const gate = canUndo(code, rows.map(x => ({ code: x.code, status: x.status as StepState['status'] })), stepsFor(r.order.body_only));
  if (!gate.ok) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: gate.reason } }); return; }

  const now = new Date();
  await prisma!.orderStep.update({
    where: { order_id_code: { order_id: id, code } },
    data: {
      status: 'pending',
      done_at: null,
      done_by: null,
      // 시계를 다시 켠다 — 되돌린 순간부터 다시 세지 않으면 곧바로 「지연」으로 뜬다
      entered_at: now,
      // 날짜(납기·검사예정일)는 지운다. 되돌렸다는 것은 그 약속도 무효라는 뜻이다
      planned_at: null,
      note: `${now.toISOString().slice(0, 10)} ${req.auth?.email ?? 'unknown'} 되돌림`,
    },
  });

  /*
   * 인도를 되돌리면 견적도 「주문진행」으로 돌린다 — 완료로 올릴 때와 짝을 맞춘다.
   * 한쪽만 되돌리면 인도가 취소됐는데 마이페이지에는 인도완료 금액이 남는다.
   */
  if (code === 'delivered') {
    const q = await prisma!.quote.findUnique({ where: { id: r.order.quote_id }, select: { status: true } });
    if (q && q.status === 'completed') {
      await setQuoteStatus(r.order.quote_id, 'ordered', req.auth?.email ?? 'unknown');
    }
  }

  res.json({ data: { ok: true } });
}));

// ── 증빙 파일 ──────────────────────────────────────────────────────────────
//
// 메모리로 받는다(디스크 임시파일 없음) — 한도가 20MB 라 메모리에 담아도 부담이 적고,
// **검증을 통과한 뒤에만** 디스크에 쓴다. 임시파일을 먼저 만들면 거부된 업로드의
// 찌꺼기를 따로 치워야 한다.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOC_BYTES, files: 1 },
});

// POST /orders/:id/steps/:code/files
stepsRouter.post('/:id/steps/:code/files', rbac('ADMIN', 'SALES', 'MAKER'), canChangeSteps, upload.single('file'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    const code = String(req.params['code'] ?? '');
    if (id === null || !STEP_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }

    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }

    // 특장만 주문은 「차량 도착」이 받는 증빙이 다르다(인수증 → 자동차등록증)
    const def = stepMapFor(r.order.body_only)[code];
    if (!def) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: '이 주문에는 해당하지 않는 단계입니다' } }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '파일이 첨부되지 않았습니다' } }); return; }

    // 이 단계가 요구하는 증빙 종류만 받는다 — 아무 데나 아무 파일이 쌓이지 않게
    const kind = String((req.body as { kind?: unknown })?.kind ?? '') as EvidenceKind;
    if (!acceptsEvidence(def, kind)) {
      const ok = [...def.evidence, ...EXTRA_EVIDENCE].map(e => EVIDENCE_LABEL[e]).join(' · ');
      res.status(400).json({ error: { code: 'BAD_INPUT', message: `이 단계에 등록할 수 있는 증빙이 아닙니다 — ${ok}` } });
      return;
    }

    if (!ALLOWED_MIME[file.mimetype]) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '사진(JPG·PNG·WEBP·HEIC) 또는 PDF 만 등록할 수 있습니다' } });
      return;
    }
    const max = maxBytesFor(kind);
    if (file.size > max) {
      res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `${Math.round(max / 1024 / 1024)}MB 를 넘습니다 (${Math.round(file.size / 1024 / 1024 * 10) / 10}MB)` } });
      return;
    }

    const { abs, rel } = await reserveFilePath(id, file.mimetype);
    await writeFile(abs, file.buffer);

    /*
     * **이름을 다시 짓는다** — 「IMG_4821.jpg」로는 나중에 아무것도 찾을 수 없다.
     * 단계와 자리로 짓는다: 특장장착.jpg · 특장장착_증빙_1.jpg
     *
     * 몇 번째인지는 **같은 자리에 이미 있는 것을 세어** 정한다. 규칙이 파일 목록에서
     * 나오므로, 지웠다 다시 올려도 번호가 이어진다.
     * ⚠️ 확장자는 올라온 이름이 아니라 **MIME 으로** 정한다(.jpg 라고 적힌 PDF 가 온다).
     */
    const extra = isExtraEvidence(def, kind);
    const sameSpot = await prisma!.orderFile.findMany({
      where: { order_id: id, step_code: code, kind: { not: 'chat' } },
      select: { kind: true },
    });
    const seq = sameSpot.filter(f => isExtraEvidence(def, f.kind as EvidenceKind) === extra).length + 1;
    const displayName = evidenceFileName({
      orderId: id, customerName: r.order.customer_name,
      stepLabel: def.label, extra, seq, ext: ALLOWED_MIME[file.mimetype] ?? '',
    });

    const row = await prisma!.orderFile.create({
      data: {
        order_id: id, step_code: code, kind,
        path: rel,
        // 올린 사람 기기의 이름은 **그대로 남긴다** — 화면에 쓰는 이름만 새로 짓는다
        original_name: safeDisplayName(file.originalname ?? ''),
        display_name: displayName,
        mime: file.mimetype,
        size_bytes: file.size,
        kept_original: keepsOriginal(kind),
        uploaded_by: req.auth?.email ?? 'unknown',
      },
      select: { id: true, kind: true, original_name: true, display_name: true, size_bytes: true, kept_original: true, uploaded_at: true },
    });

    res.status(201).json({ data: row });
  }));

/**
 * **대화에 올린 사진을 그 단계의 증빙으로 등록한다.**
 *
 * 왜 필요한가: 특장사가 단계를 끝까지 안 밟는 큰 이유가 **업로드의 번거로움**이다.
 * 대화에는 사진을 곧잘 올린다 — 카톡처럼 찍어 보내면 되니까.
 * 그 사진을 그대로 증빙으로 쓸 수 있게 하면, 한 번 더 올릴 일이 없어진다.
 * (대화 사진은 이미 증빙과 **같은 곳**(order_file)에 저장돼 있다 — kind 만 다르다)
 *
 * ⚠️ **사진 증빙만** 된다. 서류 증빙(인수증·튜닝신청서·승인서…)은 글자를 읽어야 해서
 *    원본을 지켜 보관하는데(`KEEP_ORIGINAL`), 대화 사진은 올릴 때 이미 줄여 놓는다.
 *    줄인 사진을 서류 자리에 넣으면 나중에 읽을 수 없는 서류가 남는다.
 *
 * ⚠️ 파일을 **복사한다**(옮기지 않는다). 대화에서 사진이 사라지면 오간 이야기가
 *    무슨 사진에 대한 것이었는지 알 수 없게 된다. 지울 때도 서로 영향이 없다.
 */
stepsRouter.post('/:id/steps/:code/files/from-chat', rbac('ADMIN', 'MAKER'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    const code = String(req.params['code'] ?? '');
    if (id === null || !STEP_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }

    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }
    const def = stepMapFor(r.order.body_only)[code];
    if (!def) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: '이 주문에는 해당하지 않는 단계입니다' } }); return; }

    const { file_id: rawId } = (req.body ?? {}) as { file_id?: unknown };
    const fileId = Number(rawId);
    if (!Number.isInteger(fileId)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '어느 사진인지 알 수 없습니다' } }); return; }

    /*
     * **언제나 「검수 사진」으로 넣는다.**
     *
     * 종류를 고르게 하면 「이게 무슨 증빙이지?」에서 멈춘다 — 그 멈춤이 바로 지금
     * 단계를 안 밟는 이유다. 검수 사진은 모든 단계가 받는 선택 증빙이라(EXTRA_EVIDENCE)
     * 어느 단계에서 눌러도 들어간다. 정식 서류는 원래 자리에 따로 올린다.
     */
    const kind: EvidenceKind = 'inspection_photo';

    // 이 주문의 **대화 사진**만 — 남의 주문 파일이나 이미 증빙인 것을 다시 복사하지 않는다
    const src = await prisma!.orderFile.findFirst({ where: { id: fileId, order_id: id, kind: 'chat' } });
    if (!src) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '대화에서 그 사진을 찾을 수 없습니다' } }); return; }

    const from = resolveStoredPath(src.path);
    if (!from) { console.error('[from-chat] 저장 경로가 루트를 벗어남', src.id); res.status(500).json({ error: { code: 'INTERNAL' } }); return; }

    const { abs, rel } = await reserveFilePath(id, src.mime ?? 'image/jpeg');
    try {
      await copyFile(from, abs);
    } catch (e) {
      console.error('[from-chat] 복사 실패', e);
      res.status(500).json({ error: { code: 'INTERNAL', message: '사진을 옮기지 못했습니다' } });
      return;
    }

    /*
     * 대화에서 올라온 사진도 **증빙이 되는 순간 증빙 이름**을 갖는다 — 규칙은 업로드와 같다.
     * 이게 빠져 있으면 대화로 올린 것만 「IMG_4821.jpg」로 남아, 같은 자리의 파일들이
     * 두 가지 이름 규칙으로 섞인다.
     */
    const extra = isExtraEvidence(def, kind);
    const sameSpot = await prisma!.orderFile.findMany({
      where: { order_id: id, step_code: code, kind: { not: 'chat' } },
      select: { kind: true },
    });
    const seq = sameSpot.filter(f => isExtraEvidence(def, f.kind as EvidenceKind) === extra).length + 1;
    const displayName = evidenceFileName({
      orderId: id, customerName: r.order.customer_name,
      stepLabel: def.label, extra, seq, ext: ALLOWED_MIME[src.mime ?? 'image/jpeg'] ?? '.jpg',
    });

    const row = await prisma!.orderFile.create({
      data: {
        order_id: id, step_code: code, kind,
        path: rel,
        original_name: src.original_name,
        display_name: displayName,
        mime: src.mime,
        size_bytes: src.size_bytes,
        // 대화 사진은 이미 줄여 저장한 것이라 「원본을 지킨 파일」이 아니다
        kept_original: false,
        uploaded_by: req.auth?.email ?? 'unknown',
      },
      select: { id: true, kind: true, original_name: true, display_name: true, size_bytes: true, kept_original: true, uploaded_at: true },
    });

    res.status(201).json({ data: row });
  }));

// GET /orders/:id/files/:fileId — 열람
stepsRouter.get('/:id/files/:fileId', rbac('ADMIN', 'SALES', 'MAKER'), guard(async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const fileId = Number(req.params['fileId']);
  if (id === null || !Number.isInteger(fileId)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 주문 번호입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { denyOrder(res, r.err); return; }

  const f = await prisma!.orderFile.findFirst({ where: { id: fileId, order_id: id } });
  if (!f) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }

  const abs = resolveStoredPath(f.path);
  if (!abs) { console.error('[order-file] 저장 경로가 루트를 벗어남', f.id); res.status(500).json({ error: { code: 'INTERNAL' } }); return; }
  try { await stat(abs); } catch { res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } }); return; }

  /*
   * ⚠️ Content-Type 은 **우리 허용목록에서** 꺼낸다. 업로드 때 받은 값을 그대로 돌려주면
   *    올린 사람이 브라우저에게 무엇으로 해석할지 정하게 된다.
   *    nosniff 까지 붙여 브라우저가 내용을 보고 추측하지 못하게 한다.
   */
  const mime = f.mime && ALLOWED_MIME[f.mime] ? f.mime : 'application/octet-stream';
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  /*
   * `?dl=1` 이면 **받아 두는 것**이다 — 관리자 「파일」 화면에서 챙겨 갈 때 쓴다.
   * 기본은 그대로 열어 본다(사진을 확인하러 누르는 일이 훨씬 잦다).
   */
  const asAttachment = req.query['dl'] === '1';
  res.setHeader(
    'Content-Disposition',
    // 내려받는 이름도 화면에 보이는 이름과 같아야 한다 — 다르면 「받은 파일이 그게 맞나」가 된다
    `${asAttachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.display_name ?? f.original_name ?? 'file')}`,
  );
  createReadStream(abs).pipe(res);
}));

// DELETE /orders/:id/files/:fileId — 잘못 올린 것 지우기
stepsRouter.delete('/:id/files/:fileId', rbac('ADMIN', 'SALES', 'MAKER'), canChangeSteps, guard(async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const fileId = Number(req.params['fileId']);
  if (id === null || !Number.isInteger(fileId)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 주문 번호입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { denyOrder(res, r.err); return; }

  const f = await prisma!.orderFile.findFirst({ where: { id: fileId, order_id: id } });
  if (!f) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }

  // 완료된 단계의 증빙은 지우지 않는다 — 완료의 근거였던 것이 사라지면 기록이 거짓이 된다
  const step = await prisma!.orderStep.findUnique({ where: { order_id_code: { order_id: id, code: f.step_code } }, select: { status: true } });
  if (step?.status === 'done') {
    res.status(409).json({ error: { code: 'CONFLICT', message: '완료된 단계의 증빙은 삭제할 수 없습니다' } }); return;
  }

  await prisma!.orderFile.delete({ where: { id: fileId } });
  const abs = resolveStoredPath(f.path);
  if (abs) await unlink(abs).catch(() => { /* 파일이 이미 없어도 기록은 지운다 */ });
  res.json({ data: { ok: true } });
}));

// ── 단계별 대화 ──────────────────────────────────────────────────────────
/*
 * 특장사와 관리자가 그 단계 자리에서 주고받는다. **이력이 목적이라 고치거나 지우지 않는다.**
 *
 * 읽기는 단계 조회와 **같은 범위**로 연다(loadOrder). 나중에 영업에게 조회 탭을 열어 줄 때
 * 서버를 다시 손대지 않아도 되도록 — 지금은 화면이 없을 뿐이다.
 * 쓰기는 **관리자·특장사만**. 영업이 끼는 문제는 별도 화면 설계가 먼저다.
 */

/** 단계 코드가 이 주문에 실제로 있는가 — 없는 코드로 스레드를 만들지 않는다 */
async function stepExists(orderId: number, code: string): Promise<boolean> {
  if (!prisma) return false;
  const row = await prisma.orderStep.findFirst({
    where: { order_id: orderId, code }, select: { id: true },
  });
  return row != null;
}

/** 주문 전체의 안 읽은 개수 — 화면이 단계 버튼마다 빨간 점을 찍는 데 쓴다 */
stepsRouter.get('/:id/step-comments/unread', rbac('ADMIN', 'SALES', 'MAKER'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params['id']);
    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }
    res.json({ data: await unreadByStep(id, req.auth!.email) });
  }));

/**
 * 주문의 대화 **전체**(시간순) — 「대화」 탭. 어느 단계 이야기인지 라벨을 함께 준다.
 *
 * **처음 열 때 전 단계를 읽음으로 표시한다.** 이 탭은 모든 단계의 이야기를 한 줄로
 * 보여 주므로 거기까지 열었으면 본 것이 맞다. 표시하지 않으면 탭을 나오는 순간
 * 「안 읽음」이 되살아나 읽었는데도 강조가 다시 켜진다(실측).
 * 증분 조회(`after`)일 때는 하지 않는다 — 몇 초마다 같은 쓰기를 반복할 이유가 없다.
 */
stepsRouter.get('/:id/step-comments', rbac('ADMIN', 'SALES', 'MAKER'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params['id']);
    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }
    /*
     * `?after=<마지막으로 받은 id>` — **그 뒤에 생긴 것만** 준다.
     * 단계 목록(`steps`)은 처음 한 번만 보낸다. 14줄짜리 고정 목록이라 몇 초마다
     * 다시 실어 보내면 증분으로 아낀 것을 그대로 도로 쓴다.
     */
    const after = Number(req.query['after']);
    const incremental = Number.isInteger(after) && after > 0;
    if (!incremental) {
      await markAllRead(id, req.auth!.email).catch(() => { /* 표시 실패로 조회를 막지 않는다 */ });
    }
    const defs = stepsFor(r.order.body_only);
    res.json({ data: {
      comments: await listAllComments(id, incremental ? after : undefined),
      me: req.auth!.email,
      // 화면이 코드 대신 이름을 보여 주고, 쓸 때 고를 수 있게 목록도 함께 준다
      ...(incremental ? {} : { steps: defs.map(d => ({ code: d.code, label: d.label })) }),
    } });
  }));

/** 한 단계의 대화 전체. 여는 순간 읽은 것으로 표시한다 */
stepsRouter.get('/:id/steps/:code/comments', rbac('ADMIN', 'SALES', 'MAKER'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params['id']);
    const code = String(req.params['code']);
    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }
    // `?after=<마지막으로 받은 id>` — 그 뒤에 생긴 것만
    const after = Number(req.query['after']);
    const rows = await listComments(id, code, Number.isInteger(after) && after > 0 ? after : undefined);
    await markRead(id, code, req.auth!.email).catch(() => { /* 표시 실패로 조회를 막지 않는다 */ });
    res.json({ data: { comments: rows, me: req.auth!.email } });
  }));

/**
 * 글 남기기 — 관리자·특장사만. **사진을 함께 붙일 수 있다.**
 *
 * 사진은 증빙과 **같은 곳**(order_file, kind='chat')에 저장한다 — 저장 경로·크기 제한·
 * 내려받기 길을 새로 만들면 한쪽만 고쳐지는 자리가 또 생긴다.
 * 다만 evidence 종류가 아니므로 단계의 증빙 목록에는 뜨지 않는다.
 *
 * multipart 로 받는다(글만 보낼 때도 같은 경로). 파일이 없으면 그냥 글만 남는다.
 */
stepsRouter.post('/:id/steps/:code/comments', rbac('ADMIN', 'MAKER'), upload.single('image'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params['id']);
    const code = String(req.params['code']);
    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }

    const body = String((req.body as { body?: unknown })?.body ?? '').trim();
    // 사진만 보내는 것도 허용한다 — 「이 상태입니다」 한 장으로 끝나는 이야기가 있다
    if (body === '' && !req.file) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '내용을 입력하거나 사진을 붙이세요' } });
      return;
    }
    if (body.length > COMMENT_MAX) {
      res.status(400).json({
        error: { code: 'TOO_LONG', message: `${COMMENT_MAX}자까지 쓸 수 있습니다` },
      });
      return;
    }
    if (!(await stepExists(id, code))) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '없는 단계입니다' } });
      return;
    }

    /*
     * 사진 — 있으면 먼저 저장하고 그 id 를 글에 붙인다.
     * 글이 비어 있어도 사진만 남길 수 있다(현장에서 「이 상태입니다」 한 장이면 될 때가 있다).
     */
    let imageFileId: number | null = null;
    const img = req.file;
    if (img) {
      if (!ALLOWED_MIME[img.mimetype]) {
        res.status(400).json({ error: { code: 'BAD_INPUT', message: '사진(JPG·PNG·WEBP·HEIC) 또는 PDF 만 붙일 수 있습니다' } });
        return;
      }
      if (img.size > MAX_DOC_BYTES) {
        res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB 를 넘습니다` } });
        return;
      }
      const { abs, rel } = await reserveFilePath(id, img.mimetype);
      await writeFile(abs, img.buffer);
      const f = await prisma!.orderFile.create({
        data: {
          order_id: id, step_code: code, kind: 'chat', path: rel,
          original_name: safeDisplayName(img.originalname ?? ''),
          /*
           * **원본 그대로 보관한다.** 대화 사진은 증빙으로도 쓰이고, 미세한 흠집을
           * 봐야 할 때가 있다(제보). 줄여 놓으면 그때 확인할 방법이 없다.
           */
          mime: img.mimetype, size_bytes: img.size, kept_original: true,
          uploaded_by: req.auth!.email,
        },
        select: { id: true },
      });
      imageFileId = f.id;
    }

    const auth = req.auth!;
    const me = prisma ? await prisma.user.findUnique({
      where: { email: auth.email }, select: { name: true },
    }) : null;
    const row = await addComment({
      orderId: id, stepCode: code,
      stepLabel: STEP_BY_CODE[code]?.label ?? code,
      author: auth.email,
      authorRole: auth.roles.includes('MAKER') && !isAdmin(auth) ? 'MAKER' : (isAdmin(auth) ? 'ADMIN' : 'SALES'),
      authorName: me?.name ?? null,
      body,
      imageFileId,
    });
    res.status(201).json({ data: row });
  }));

/** 읽음 표시만 — 패널을 닫지 않고도 점을 끄고 싶을 때 */
stepsRouter.post('/:id/steps/:code/comments/read', rbac('ADMIN', 'SALES', 'MAKER'),
  guard(async (req: Request, res: Response): Promise<void> => {
    const id = Number(req.params['id']);
    const r = await loadOrder(id, req);
    if ('err' in r) { denyOrder(res, r.err); return; }
    await markRead(id, String(req.params['code']), req.auth!.email);
    res.json({ data: { ok: true } });
  }));
