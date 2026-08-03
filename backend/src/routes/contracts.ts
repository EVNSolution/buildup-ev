/**
 * 구매계약 전자서명 라우트 — /api/v1/orders/:id/contract*
 * 발송·조회 = ADMIN/SALES. (서명은 고객이 모두싸인 링크로.) API KEY 는 서버 env 에만.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import { rbac } from '../middleware/rbac.js';
import {
  sendContract, getLatestContract, ContractError,
} from '../services/contract.js';
import { ModusignConfigError, ModusignApiError } from '../services/modusign.js';
import { SofficeUnavailableError } from '../lib/soffice.js';

export const contractsRouter = Router();

function orderId(req: Request): number | null {
  const id = Number(req.params['id']);
  return Number.isInteger(id) ? id : null;
}

// ── POST /:id/contract/send — 계약서 발송 ────────────────────────────────────
contractsRouter.post('/:id/contract/send', rbac('ADMIN', 'SALES'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 주문 id' } }); return; }

  const method = (req.body as { signing_method?: string }).signing_method;
  if (method !== 'EMAIL' && method !== 'KAKAO') {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'signing_method 는 EMAIL 또는 KAKAO' } });
    return;
  }

  try {
    const contract = await sendContract(id, method);
    res.json({ data: { id: contract.id, status: contract.status, signing_method: contract.signing_method, sent_at: contract.sent_at } });
  } catch (e) {
    if (e instanceof ContractError) {
      const map = { NOT_FOUND: 404, NO_CUSTOMER: 400, NO_CONTACT: 400, DB_UNAVAILABLE: 503 } as const;
      res.status(map[e.code]).json({ error: { code: e.code, message: e.message } });
      return;
    }
    if (e instanceof ModusignConfigError) { res.status(503).json({ error: { code: 'MODUSIGN_UNCONFIGURED', message: '전자서명 API 키 미설정 (배포담당 서버 .env 주입 필요)' } }); return; }
    if (e instanceof SofficeUnavailableError) { res.status(503).json({ error: { code: 'PDF_UNAVAILABLE', message: '계약서 PDF 생성 환경 미구성' } }); return; }
    if (e instanceof ModusignApiError) { res.status(502).json({ error: { code: 'MODUSIGN_ERROR', message: e.message } }); return; }
    console.error('[POST contract/send]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '계약 발송 실패' } });
  }
});

// ── GET /:id/contract — 현재 계약 상태 ───────────────────────────────────────
contractsRouter.get('/:id/contract', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  try {
    const c = await getLatestContract(id);
    if (!c) { res.json({ data: null }); return; }
    res.json({ data: {
      id: c.id, status: c.status, signing_method: c.signing_method,
      sent_at: c.sent_at, completed_at: c.completed_at, has_signed: !!c.signed_pdf_path,
    } });
  } catch (e) {
    if (e instanceof ContractError && e.code === 'DB_UNAVAILABLE') { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
    console.error('[GET contract]', e);
    res.status(500).json({ error: { code: 'INTERNAL' } });
  }
});

// ── GET /:id/contract/signed — 완료 서명본 다운로드 ──────────────────────────
contractsRouter.get('/:id/contract/signed', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const id = orderId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  try {
    const c = await getLatestContract(id);
    if (!c || c.status !== 'COMPLETED' || !c.signed_pdf_path || !existsSync(c.signed_pdf_path)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '완료된 서명본이 없습니다' } });
      return;
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`구매계약서_서명본_주문${id}.pdf`)}`);
    createReadStream(c.signed_pdf_path).pipe(res);
  } catch (e) {
    console.error('[GET contract/signed]', e);
    res.status(500).json({ error: { code: 'INTERNAL' } });
  }
});
