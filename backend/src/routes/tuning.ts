/**
 * 튜닝신청서 전자서명 라우트 — /api/v1/orders/:id/tuning*
 *
 * 계약서(contracts.ts)와 같은 모양이다. 다른 점은 주문에 붙는다는 것뿐 —
 * 자동차등록증이 나온 뒤에야 만들 수 있어 견적 시점에는 존재할 수 없다.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import { rbac, requirePermission } from '../middleware/rbac.js';
import {
  sendTuningApplication, getLatestTuning, ensureTuningSignedPdf, markTuningDownloaded,
  tuningRecipient, TuningEsignError,
} from '../services/tuning-esign.js';
import { ModusignConfigError, ModusignApiError } from '../services/modusign.js';

export const tuningRouter = Router();

function orderId(req: Request): number | null {
  const id = Number(req.params['id']);
  return Number.isInteger(id) ? id : null;
}

const STATUS_MAP = {
  NOT_FOUND: 404, NO_CONTACT: 400, DB_UNAVAILABLE: 503,
  ALREADY_SENT: 409, NEEDS_REVIEW: 409, FORM_MISSING: 503, NOT_READY: 409,
} as const;

function fail(res: Response, e: unknown, where: string): void {
  if (e instanceof TuningEsignError) {
    res.status(STATUS_MAP[e.code]).json({ error: { code: e.code, message: e.message } });
    return;
  }
  if (e instanceof ModusignConfigError) {
    res.status(503).json({ error: { code: 'MODUSIGN_UNCONFIGURED', message: '전자서명 API 키 미설정' } }); return;
  }
  if (e instanceof ModusignApiError) {
    res.status(502).json({ error: { code: 'MODUSIGN_ERROR', message: e.message } }); return;
  }
  console.error(`[${where}]`, e);
  res.status(500).json({ error: { code: 'INTERNAL', message: '처리 중 오류가 발생했습니다' } });
}

// ── POST /:id/tuning/send — 고객에게 서명 요청 ───────────────────────────────
// 계약서 발송과 같은 권한(doc.send.sign) — 건당 과금되는 되돌릴 수 없는 동작이다.
tuningRouter.post('/:id/tuning/send', rbac('ADMIN', 'SALES'), requirePermission('doc.send.sign'),
  async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 주문 id' } }); return; }

    const method = (req.body as { signing_method?: string }).signing_method;
    if (method !== 'EMAIL' && method !== 'KAKAO') {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: 'signing_method 는 EMAIL 또는 KAKAO' } });
      return;
    }
    try {
      const a = await sendTuningApplication(id, method);
      res.json({ data: { id: a.id, status: a.status, signing_method: a.signing_method, sent_at: a.sent_at } });
    } catch (e) { fail(res, e, 'POST tuning/send'); }
  });

// ── GET /:id/tuning — 현재 상태 ──────────────────────────────────────────────
// 특장사도 본다 — 서명이 끝나야 「서명 완료」 단계를 넘길 수 있어 진행을 알아야 한다.
tuningRouter.get('/:id/tuning', rbac('ADMIN', 'SALES', 'MAKER'),
  async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
    try {
      const [a, recipient] = await Promise.all([getLatestTuning(id), tuningRecipient(id)]);
      res.json({ recipient, data: a ? {
        id: a.id, status: a.status, signing_method: a.signing_method,
        sent_at: a.sent_at, completed_at: a.completed_at,
        has_signed: !!a.signed_pdf_path,
        // 화면이 「서명본을 내려받아야 완료할 수 있다」를 안내하려면 이 값이 필요하다
        downloaded_at: a.downloaded_at, downloaded_by: a.downloaded_by,
      } : null });
    } catch (e) { fail(res, e, 'GET tuning'); }
  });

// ── GET /:id/tuning/signed — 서명본 내려받기 ─────────────────────────────────
/*
 * **내려받는 순간이 곧 「확인했다」는 기록이다.**
 * 따로 확인 버튼을 두면 열어 보지 않고도 누를 수 있다 — 파일이 실제로 나간 사실만 남긴다.
 */
tuningRouter.get('/:id/tuning/signed', rbac('ADMIN', 'SALES', 'MAKER'),
  async (req: Request, res: Response): Promise<void> => {
    const id = orderId(req);
    if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
    try {
      const filePath = await ensureTuningSignedPdf(id);
      if (!filePath || !existsSync(filePath)) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: '완료된 서명본이 없습니다' } });
        return;
      }
      await markTuningDownloaded(id, req.auth?.email ?? 'unknown');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `inline; filename*=UTF-8''${encodeURIComponent(`튜닝신청서_서명본_주문${id}.pdf`)}`);
      createReadStream(filePath).pipe(res);
    } catch (e) { fail(res, e, 'GET tuning/signed'); }
  });
