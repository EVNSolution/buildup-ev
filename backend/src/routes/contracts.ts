/**
 * 구매계약 전자서명 라우트 — /api/v1/quotes/:id/contract*
 * 계약은 견적(확정 시점)에 연결. 발송·조회 = ADMIN/SALES. API KEY 는 서버 env 에만.
 */
import { Router } from 'express';
import { noStore } from '../lib/doc-headers.js';
import type { Request, Response } from 'express';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { rbac, requirePermission } from '../middleware/rbac.js';
import {
  sendContract, getLatestContract, ContractError, refreshContractStatus, ensureSignedPdf,
  registerPaperContract, PAPER_METHOD, PAPER_SCAN_MIME, cancelContract,
} from '../services/contract.js';
import { MAX_DOC_BYTES, safeDisplayName } from '../lib/uploads.js';
import { ModusignConfigError, ModusignApiError } from '../services/modusign.js';
import { SofficeUnavailableError } from '../lib/soffice.js';

export const contractsRouter = Router();

function quoteId(req: Request): number | null {
  const id = Number(req.params['id']);
  return Number.isInteger(id) ? id : null;
}

// ── POST /:id/contract/send — 계약서 발송 ────────────────────────────────────
contractsRouter.post('/:id/contract/send', rbac('ADMIN', 'SALES'), requirePermission('doc.send.sign'), async (req: Request, res: Response): Promise<void> => {
  const id = quoteId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

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
      const map = { NOT_FOUND: 404, NO_CUSTOMER: 400, NO_CONTACT: 400, DB_UNAVAILABLE: 503,
        NOT_SENDABLE: 409, ALREADY_SENT: 409, NEEDS_REVIEW: 409 } as const;
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

// ── POST /:id/contract/cancel — 발송 취소(재발송을 열어 준다) ────────────────
/**
 * 재발송은 `DRAFT·REJECTED·CANCELED` 일 때만 열린다. 고객이 끝내 서명하지 않은 건은
 * `SENT` 에 남아 다시 보낼 방법이 없었다 — 그 자물쇠를 푸는 문이다.
 *
 * 발송과 같은 권한을 요구한다. 취소는 고객에게 보이는 행동이고, 곧바로 재발송이
 * 뒤따르므로 발송을 할 수 있는 사람만 할 수 있어야 한다.
 */
contractsRouter.post('/:id/contract/cancel', rbac('ADMIN', 'SALES'), requirePermission('doc.send.sign'), async (req: Request, res: Response): Promise<void> => {
  const id = quoteId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  const reason = (req.body as { reason?: string } | undefined)?.reason;
  try {
    const { contract, remote_canceled } = await cancelContract(id, reason);
    res.json({ data: { id: contract.id, status: contract.status, remote_canceled } });
  } catch (e) {
    if (e instanceof ContractError) {
      const map = { NOT_FOUND: 404, NO_CUSTOMER: 400, NO_CONTACT: 400, DB_UNAVAILABLE: 503,
        NOT_SENDABLE: 409, ALREADY_SENT: 409, NEEDS_REVIEW: 409 } as const;
      res.status(map[e.code]).json({ error: { code: e.code, message: e.message } });
      return;
    }
    console.error('[POST contract/cancel]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '발송 취소 중 오류가 발생했습니다.' } });
  }
});

// ── GET /:id/contract — 현재 계약 상태 ───────────────────────────────────────
// ── POST /:id/contract/refresh — 모두싸인 실제 상태로 동기화(웹훅 유실 복구) ──
contractsRouter.post('/:id/contract/refresh', rbac('ADMIN', 'SALES'), async (req: Request, res: Response): Promise<void> => {
  const id = quoteId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }
  try {
    const c = await refreshContractStatus(id);
    res.json({ data: c ? { id: c.id, status: c.status, completed_at: c.completed_at } : null });
  } catch (e) {
    console.error('[POST contract/refresh]', e);
    res.status(502).json({ error: { code: 'MODUSIGN_ERROR', message: '상태 조회 실패' } });
  }
});

/*
 * ⚠️ 특장사(MAKER)는 계약서에 접근하지 못한다.
 *
 * 특장사가 받는 것은 **발주서**다. 계약서에는 고객 개인정보와 판매가·보조금이 들어 있고,
 * 서명본에는 고객의 서명·날인까지 있다 — 제작을 맡기는 데 필요한 정보가 아니다.
 * 견적서·계약서 PDF(quotes 라우터)는 이미 막혀 있었는데 여기 두 개만 열려 있었다.
 * 특장사에게 무엇을 보여줄지는 발주서 하나로 정한다(docs/process-redesign.md §5).
 */
contractsRouter.get('/:id/contract', rbac('ADMIN', 'SALES'), async (req: Request, res: Response): Promise<void> => {
  const id = quoteId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  try {
    const c = await getLatestContract(id);
    if (!c) { res.json({ data: null }); return; }
    res.json({ data: {
      id: c.id, status: c.status, signing_method: c.signing_method,
      // 화면이 「전자서명 완료」와 「서면계약」을 다르게 적어야 한다 — 같은 COMPLETED 라도 뜻이 다르다
      is_paper: c.signing_method === PAPER_METHOD,
      sent_at: c.sent_at, completed_at: c.completed_at, has_signed: !!c.signed_pdf_path,
    } });
  } catch (e) {
    if (e instanceof ContractError && e.code === 'DB_UNAVAILABLE') { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
    console.error('[GET contract]', e);
    res.status(500).json({ error: { code: 'INTERNAL' } });
  }
});

// ── GET /:id/contract/signed — 완료 서명본 다운로드 ──────────────────────────
contractsRouter.get('/:id/contract/signed', rbac('ADMIN', 'SALES'), async (req: Request, res: Response): Promise<void> => {
  const id = quoteId(req);
  if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT' } }); return; }
  try {
    // 저장돼 있지 않으면 지금 받아서 저장한다 — 열람이 곧 복구 기회다
    const filePath = await ensureSignedPdf(id);
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: '완료된 서명본이 없습니다' } });
      return;
    }
    /*
     * 서면계약 스캔본은 PDF 가 아닐 수 있다(폰으로 찍어 오면 JPG·HEIC).
     * 내용과 다른 Content-Type 을 박으면 브라우저가 깨진 파일로 취급한다 — 확장자에서 읽는다.
     */
    const ext = path.extname(filePath).toLowerCase();
    const TYPE: Record<string, string> = {
      '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.png': 'image/png',
      '.webp': 'image/webp', '.heic': 'image/heic',
    };
    const c = await getLatestContract(id);
    const isPaper = c?.signing_method === PAPER_METHOD;
    const name = `${isPaper ? '특장매매계약서_서면' : '특장매매계약서_서명본'}_견적${id}${ext}`;
    noStore(res);
    res.setHeader('Content-Type', TYPE[ext] ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error('[GET contract/signed]', e);
    res.status(500).json({ error: { code: 'INTERNAL' } });
  }
});

// ── POST /:id/contract/paper — 서면계약(서명본) 등록 ────────────────────────
/*
 * **스캔본 필수.** 전자서명을 건너뛰고 계약완료로 올리는 문이다.
 *
 * ⚠️ 예전에는 **관리자 전용**이었다. 견적서·계약서 흐름(생성·전송·서명요청·서명본 등록)을
 *    **전부 영업 화면에서** 하기로 정하면서 영업에게 열었다 — 계약을 맺은 사람이 그 자리에서
 *    올리는 것이 맞고, 관리자 화면은 조회만 한다.
 *
 * 권한은 계약서 발송(`doc.send.sign`)과 같은 것을 쓴다. 종이로 받았든 전자로 받았든
 * **계약을 성립시키는 같은 종류의 행위**라, 둘을 다른 권한으로 가르면 한쪽만 켜진
 * 어중간한 계정이 생긴다.
 */
const scanUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_DOC_BYTES, files: 1 } });

contractsRouter.post('/:id/contract/paper',
  rbac('ADMIN', 'SALES'), requirePermission('doc.send.sign'), scanUpload.single('file'),
  async (req: Request, res: Response): Promise<void> => {
    const id = quoteId(req);
    if (id === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 견적 id' } }); return; }

    const file = req.file;
    if (!file) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: '계약서 스캔본을 첨부해야 합니다' } });
      return;
    }
    if (!PAPER_SCAN_MIME[file.mimetype]) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: 'PDF 또는 사진(JPG·PNG·WEBP·HEIC) 만 등록할 수 있습니다' } });
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: `${Math.round(MAX_DOC_BYTES / 1024 / 1024)}MB 를 넘습니다` } });
      return;
    }

    try {
      const c = await registerPaperContract(
        id,
        { buffer: file.buffer, mime: file.mimetype, originalName: safeDisplayName(file.originalname ?? '') },
        req.auth?.email ?? 'unknown',
      );
      res.status(201).json({ data: { id: c.id, status: c.status, signing_method: c.signing_method, completed_at: c.completed_at } });
    } catch (e) {
      if (e instanceof ContractError) {
        const map = { NOT_FOUND: 404, NO_CUSTOMER: 400, NO_CONTACT: 400, DB_UNAVAILABLE: 503,
          NOT_SENDABLE: 409, ALREADY_SENT: 409, NEEDS_REVIEW: 409 } as const;
        res.status(map[e.code]).json({ error: { code: e.code, message: e.message } });
        return;
      }
      console.error('[POST contract/paper]', e);
      res.status(500).json({ error: { code: 'INTERNAL', message: '서면계약 등록 실패' } });
    }
  });
