/**
 * 이메일 발송 라우트 — POST /api/v1/quotes/:id/email
 * 견적서(+계약서) PDF 를 고객에게 발송. ADMIN/SALES. SMTP 자격증명은 서버 env 에만.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { sendQuoteDocsEmail, EmailConfigError, EmailError } from '../services/email.js';
import { ContractError } from '../services/contract.js';
import { QuotePdfError } from '../services/quote-pdf.js';
import { SofficeUnavailableError } from '../lib/soffice.js';

export const emailRouter = Router();

/**
 * 지금까지 무엇을 보냈나 — **메일 전달 팝업이 띄운다.**
 *
 * 목록 화면은 건드리지 않는다. 「보냈나 안 보냈나」는 보낼 때 궁금한 것이지
 * 목록을 훑을 때 궁금한 것이 아니다 — 열마다 배지를 더하면 표만 복잡해진다.
 */
emailRouter.get('/:id/email-log', rbac('ADMIN', 'SALES'), requirePermission('doc.send.email'), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  try {
    const rows = await prisma?.quoteEmailLog.findMany({
      where: { quote_id: id },
      orderBy: { sent_at: 'desc' },
      take: 20,
    }) ?? [];
    res.json({ data: rows.map(r => ({
      id: r.id,
      quoteNo: r.quote_no,
      to: r.to_email,
      withContract: r.with_contract,
      attachments: r.attachments,
      sentBy: r.sent_by,
      sentAt: r.sent_at.toISOString(),
    })) });
  } catch (e) {
    console.error('[GET quotes/:id/email-log]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '발송 기록 조회 실패' } });
  }
});

emailRouter.post('/:id/email', rbac('ADMIN', 'SALES'), requirePermission('doc.send.email'), async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

  const { to, cc, subject, message, include_contract } = req.body as {
    to?: string; cc?: string; subject?: string; message?: string; include_contract?: boolean;
  };

  try {
    const r = await sendQuoteDocsEmail(id, { to, cc, subject, message, includeContract: include_contract !== false });

    /*
     * 무엇을 보냈는지 남긴다 — **견적서만인지, 계약서까지인지.**
     * 사람 기억에 맡기면 두 번 보내거나 안 보낸다.
     *
     * ⚠️ 기록이 실패해도 **발송은 이미 끝난 일**이다. 여기서 던지면 「보냈는데 실패했다」로
     *    보여 다시 보내게 된다 — 고객이 같은 메일을 두 번 받는다. 로그만 남기고 넘어간다.
     */
    try {
      const q = await prisma?.quote.findUnique({ where: { id }, select: { quote_no: true } });
      await prisma?.quoteEmailLog.create({
        data: {
          quote_id: id,
          quote_no: q?.quote_no ?? null,
          to_email: r.to,
          with_contract: include_contract !== false,
          attachments: r.attachments.join(', ').slice(0, 500),
          sent_by: req.auth?.email ?? 'unknown',
        },
      });
    } catch (e) {
      console.error('[POST quotes/:id/email] 발송 기록 실패(발송은 완료)', { quoteId: id, err: e });
    }

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
