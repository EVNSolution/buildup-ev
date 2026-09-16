/**
 * 차량 판매건별 손익 — /api/v1/pnl/*
 *
 * 경영관리가 월 단위로 적고 보는 표(2026-09-16 지시). 달을 가르는 기준은 **세금계산서 발행일**이다.
 *
 * 권한: `pnl.view` 로 보고, `pnl.manage` 로 적는다. 돈에 관한 표라 **보는 것부터** 권한을 건다 —
 * 매출·원가·수익은 주문 진행 현황과 성격이 다르다.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { isYearMonth } from '@buildup-ev/shared/finance/pnl';
import { pnlOfMonth, pnlPending, pnlMonths, pnlSummary, savePnl, voidPnl, unvoidPnl, type PnlPatch } from '../services/pnl.js';

export const pnlRouter = Router();

const view = [rbac('ADMIN'), requirePermission('pnl.view')] as const;
const manage = [rbac('ADMIN'), requirePermission('pnl.manage')] as const;

function fail(res: Response, where: string, e: unknown) {
  console.error(`[pnl] ${where}`, e);
  res.status(500).json({ error: { code: 'INTERNAL', message: '손익 조회 중 오류가 발생했습니다.' } });
}

/** 이번 달(한국 기준) — 화면이 달을 안 주면 여기서 정한다 */
function thisMonth(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 7);
}

// ── GET /pnl?month=YYYY-MM — 그 달의 줄 + 「입력 필요」 + 달 목록 ─────────────
pnlRouter.get('/', ...view, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query['month'];
    const month = isYearMonth(q) ? q : thisMonth();
    const [rows, pending, months] = await Promise.all([pnlOfMonth(month), pnlPending(), pnlMonths()]);
    res.json({ data: { month, rows, pending, months } });
  } catch (e) { fail(res, 'GET /', e); }
});

// ── GET /pnl/summary — 대시보드 카드용 요약(이번 달 + 전체) ────────────────
// ⚠️ `/:quoteId` 보다 **먼저** 둔다. 뒤에 두면 'summary' 가 견적 id 로 읽힌다
pnlRouter.get('/summary', ...view, async (req: Request, res: Response): Promise<void> => {
  try {
    const q = req.query['month'];
    res.json({ data: await pnlSummary(isYearMonth(q) ? q : thisMonth()) });
  } catch (e) { fail(res, 'GET /summary', e); }
});

// ── PUT /pnl/:quoteId — 줄 하나를 적는다(없으면 만든다) ──────────────────────
pnlRouter.put('/:quoteId', ...manage, async (req: Request, res: Response): Promise<void> => {
  const quoteId = Number(req.params['quoteId']);
  if (!Number.isInteger(quoteId)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return;
  }
  try {
    const row = await savePnl(quoteId, (req.body ?? {}) as PnlPatch, req.auth?.email ?? 'unknown');
    if (!row) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
    res.json({ data: row });
  } catch (e) {
    // 없는 견적에 줄을 만들려 하면 외래키에 걸린다 — 500 이 아니라 404 로 답한다
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2003') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '견적을 찾을 수 없습니다' } }); return;
    }
    fail(res, 'PUT /:quoteId', e);
  }
});

/** 줄 번호를 읽는다 — 주소창 값을 믿지 않는다 */
function quoteIdOf(req: Request, res: Response): number | null {
  const id = Number(req.params['quoteId']);
  if (Number.isInteger(id)) return id;
  res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } });
  return null;
}

// ── POST /pnl/:quoteId/void — 삭제(줄은 남는다, 사유 필수) ────────────────
pnlRouter.post('/:quoteId/void', ...manage, async (req: Request, res: Response): Promise<void> => {
  const quoteId = quoteIdOf(req, res);
  if (quoteId === null) return;
  const reason = String((req.body as { reason?: unknown })?.reason ?? '').trim();
  // 사유 없이는 못 지운다 — 몇 달 뒤에 왜 뺐는지 물으면 답할 수 있어야 한다
  if (!reason) {
    res.status(400).json({ error: { code: 'REASON_REQUIRED', message: '삭제 사유를 적어 주세요.' } });
    return;
  }
  try {
    const row = await voidPnl(quoteId, reason, req.auth?.email ?? 'unknown');
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '손익 줄을 찾을 수 없습니다' } }); return; }
    res.json({ data: row });
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '손익 줄을 찾을 수 없습니다' } }); return;
    }
    fail(res, 'POST /:quoteId/void', e);
  }
});

// ── POST /pnl/:quoteId/unvoid — 되돌리기 ──────────────────────────────────
pnlRouter.post('/:quoteId/unvoid', ...manage, async (req: Request, res: Response): Promise<void> => {
  const quoteId = quoteIdOf(req, res);
  if (quoteId === null) return;
  try {
    const row = await unvoidPnl(quoteId, req.auth?.email ?? 'unknown');
    if (!row) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '손익 줄을 찾을 수 없습니다' } }); return; }
    res.json({ data: row });
  } catch (e) {
    if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2025') {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '손익 줄을 찾을 수 없습니다' } }); return;
    }
    fail(res, 'POST /:quoteId/unvoid', e);
  }
});
