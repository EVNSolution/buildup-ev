/**
 * 이메일 발송 라우트 — POST /api/v1/quotes/:id/email
 * 견적서(+계약서) PDF 를 고객에게 발송. ADMIN/SALES. SMTP 자격증명은 서버 env 에만.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac } from '../middleware/rbac.js';
import { sendQuoteDocsEmail, EmailConfigError, EmailError } from '../services/email.js';
import { ContractError } from '../services/contract.js';
import { QuotePdfError } from '../services/quote-pdf.js';
import { SofficeUnavailableError } from '../lib/soffice.js';

export const emailRouter = Router();

emailRouter.post('/:id/email', rbac('ADMIN', 'SALES'), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

  const { to, cc, subject, message, include_contract } = req.body as {
    to?: string; cc?: string; subject?: string; message?: string; include_contract?: boolean;
  };

  try {
    const r = await sendQuoteDocsEmail(id, { to, cc, subject, message, includeContract: include_contract !== false });
    res.json({ data: { to: r.to, attachments: r.attachments } });
  } catch (e) {
    if (e instanceof EmailConfigError) { res.status(503).json({ error: { code: 'EMAIL_UNCONFIGURED', message: e.message } }); return; }
    if (e instanceof SofficeUnavailableError) { res.status(503).json({ error: { code: 'PDF_UNAVAILABLE', message: '계약서 PDF 생성 환경 미구성' } }); return; }
    if (e instanceof EmailError || e instanceof ContractError || e instanceof QuotePdfError) {
      res.status(400).json({ error: { code: 'EMAIL_FAILED', message: e.message } }); return;
    }
    console.error('[POST quotes/:id/email]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '이메일 발송 실패' } });
  }
});
