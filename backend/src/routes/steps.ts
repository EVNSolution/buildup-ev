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
import { rbac, isAdmin } from '../middleware/rbac.js';
import {
  STEPS, STEP_BY_CODE, canComplete, isStalled, newlyOpened,
  type EvidenceKind, type StepState,
} from '@buildup-ev/shared/process';
import { fromDateInput, toDbDate, fromDbDate } from '@buildup-ev/shared/schedule';
import { keepsOriginal, EVIDENCE_LABEL } from '@buildup-ev/shared/process';
import multer from 'multer';
import { writeFile, unlink, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import {
  ALLOWED_MIME, maxBytesFor, MAX_DOC_BYTES, reserveFilePath, resolveStoredPath, safeDisplayName,
} from '../lib/uploads.js';

export const stepsRouter = Router();

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
  | { order: { id: number; quote_id: number; maker_org_id: string | null; assigned_at: Date | null; created_at: Date } };

async function loadOrder(id: number, req: Request): Promise<LoadResult> {
  if (!prisma) return { err: 503 };
  const order = await prisma.order.findUnique({
    where: { id },
    select: {
      id: true, quote_id: true, maker_org_id: true, assigned_at: true, created_at: true,
      quote: { select: { sales_user_id: true } },
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
  return { order };
}

/**
 * 단계 행이 없으면 만들어 준다 — 이관 스크립트를 못 돌린 주문(새로 생긴 주문 등)도
 * 화면이 비지 않게. 이미 있으면 건드리지 않는다.
 */
async function ensureSteps(id: number, base: Date) {
  const n = await prisma!.orderStep.count({ where: { order_id: id } });
  if (n > 0) return;
  await prisma!.orderStep.createMany({
    data: STEPS.map(s => ({
      order_id: id, code: s.code, track: s.track, status: 'pending', entered_at: base,
    })),
    skipDuplicates: true,
  });
}

// ── GET /orders/:id/steps — 진행 상황 + 증빙 목록 ──────────────────────────
stepsRouter.get('/:id/steps', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { res.status(r.err).json({ error: { code: 'FORBIDDEN' } }); return; }

  await ensureSteps(id, r.order.assigned_at ?? r.order.created_at);

  const [rows, files] = await Promise.all([
    prisma!.orderStep.findMany({ where: { order_id: id } }),
    prisma!.orderFile.findMany({
      where: { order_id: id },
      select: { id: true, step_code: true, kind: true, original_name: true, size_bytes: true, kept_original: true, uploaded_by: true, uploaded_at: true },
      orderBy: { uploaded_at: 'asc' },
    }),
  ]);

  const byCode = new Map(rows.map(x => [x.code, x]));
  const now = new Date();

  // 카탈로그 순서로 내려준다 — 화면이 정렬을 다시 하지 않게
  const data = STEPS.map(def => {
    const row = byCode.get(def.code);
    const mine = files.filter(f => f.step_code === def.code);
    return {
      code: def.code,
      track: def.track,
      status: row?.status ?? 'pending',
      planned_at: row?.planned_at ? fromDbDate(row.planned_at) : null,
      entered_at: row?.entered_at?.toISOString() ?? null,
      done_at: row?.done_at?.toISOString() ?? null,
      done_by: row?.done_by ?? null,
      note: row?.note ?? null,
      stalled: isStalled(def.code, row ? { code: def.code, status: row.status as StepState['status'] } : undefined, row?.entered_at ?? null, now),
      files: mine.map(f => ({
        id: f.id, kind: f.kind, name: f.original_name, size: f.size_bytes,
        kept_original: f.kept_original, uploaded_by: f.uploaded_by, uploaded_at: f.uploaded_at.toISOString(),
      })),
    };
  });

  res.json({ data });
});

// ── PATCH /orders/:id/steps/:code — 단계 완료 ─────────────────────────────
stepsRouter.patch('/:id/steps/:code', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const code = String(req.params['code'] ?? '');
  if (id === null || !STEP_BY_CODE[code]) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { res.status(r.err).json({ error: { code: 'FORBIDDEN' } }); return; }

  await ensureSteps(id, r.order.assigned_at ?? r.order.created_at);

  const def = STEP_BY_CODE[code]!;
  const [rows, files] = await Promise.all([
    prisma!.orderStep.findMany({ where: { order_id: id }, select: { code: true, status: true } }),
    prisma!.orderFile.findMany({ where: { order_id: id, step_code: code }, select: { kind: true } }),
  ]);

  const already = rows.find(x => x.code === code);
  if (already?.status === 'done') {
    res.status(409).json({ error: { code: 'CONFLICT', message: '이미 완료된 단계입니다' } }); return;
  }

  // 선행 단계·증빙 판정 — 화면과 같은 함수
  const gate = canComplete(
    code,
    rows.map(x => ({ code: x.code, status: x.status as StepState['status'] })),
    files.map(f => f.kind as EvidenceKind),
  );
  if (!gate.ok) { res.status(409).json({ error: { code: 'STEP_BLOCKED', message: gate.reason } }); return; }

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
  const opened = newlyOpened(code, before);
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
    if (q && q.status === 'ordered') {
      await setQuoteStatus(r.order.quote_id, 'completed', req.auth?.email ?? 'unknown');
    }
  }

  res.json({ data: { ok: true, opened } });
});


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
stepsRouter.post('/:id/steps/:code/files', rbac('ADMIN', 'SALES', 'MAKER'), upload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    const code = String(req.params['code'] ?? '');
    const def = STEP_BY_CODE[code];
    if (id === null || !def) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '알 수 없는 단계입니다' } }); return; }

    const r = await loadOrder(id, req);
    if ('err' in r) { res.status(r.err).json({ error: { code: 'FORBIDDEN' } }); return; }

    const file = req.file;
    if (!file) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '파일이 없습니다' } }); return; }

    // 이 단계가 요구하는 증빙 종류만 받는다 — 아무 데나 아무 파일이 쌓이지 않게
    const kind = String((req.body as { kind?: unknown })?.kind ?? '') as EvidenceKind;
    if (!def.evidence.includes(kind)) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: `이 단계에 올릴 수 있는 증빙이 아닙니다 — ${def.evidence.map(e => EVIDENCE_LABEL[e]).join(' · ') || '없음'}` } });
      return;
    }

    if (!ALLOWED_MIME[file.mimetype]) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '사진(JPG·PNG·WEBP·HEIC) 또는 PDF 만 올릴 수 있습니다' } });
      return;
    }
    const max = maxBytesFor(kind);
    if (file.size > max) {
      res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `${Math.round(max / 1024 / 1024)}MB 를 넘습니다 (${Math.round(file.size / 1024 / 1024 * 10) / 10}MB)` } });
      return;
    }

    const { abs, rel } = await reserveFilePath(id, file.mimetype);
    await writeFile(abs, file.buffer);

    const row = await prisma!.orderFile.create({
      data: {
        order_id: id, step_code: code, kind,
        path: rel,
        original_name: safeDisplayName(file.originalname ?? ''),
        mime: file.mimetype,
        size_bytes: file.size,
        kept_original: keepsOriginal(kind),
        uploaded_by: req.auth?.email ?? 'unknown',
      },
      select: { id: true, kind: true, original_name: true, size_bytes: true, kept_original: true, uploaded_at: true },
    });

    res.status(201).json({ data: row });
  });

// GET /orders/:id/files/:fileId — 열람
stepsRouter.get('/:id/files/:fileId', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const fileId = Number(req.params['fileId']);
  if (id === null || !Number.isInteger(fileId)) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { res.status(r.err).json({ error: { code: 'FORBIDDEN' } }); return; }

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
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(f.original_name ?? 'file')}`);
  createReadStream(abs).pipe(res);
});

// DELETE /orders/:id/files/:fileId — 잘못 올린 것 지우기
stepsRouter.delete('/:id/files/:fileId', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  const fileId = Number(req.params['fileId']);
  if (id === null || !Number.isInteger(fileId)) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  const r = await loadOrder(id, req);
  if ('err' in r) { res.status(r.err).json({ error: { code: 'FORBIDDEN' } }); return; }

  const f = await prisma!.orderFile.findFirst({ where: { id: fileId, order_id: id } });
  if (!f) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }

  // 완료된 단계의 증빙은 지우지 않는다 — 완료의 근거였던 것이 사라지면 기록이 거짓이 된다
  const step = await prisma!.orderStep.findUnique({ where: { order_id_code: { order_id: id, code: f.step_code } }, select: { status: true } });
  if (step?.status === 'done') {
    res.status(409).json({ error: { code: 'CONFLICT', message: '완료된 단계의 증빙은 지울 수 없습니다' } }); return;
  }

  await prisma!.orderFile.delete({ where: { id: fileId } });
  const abs = resolveStoredPath(f.path);
  if (abs) await unlink(abs).catch(() => { /* 파일이 이미 없어도 기록은 지운다 */ });
  res.json({ data: { ok: true } });
});
