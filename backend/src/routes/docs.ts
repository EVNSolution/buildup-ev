/**
 * 주문 서류 자동생성 API.
 * POST /orders/:id/docs/load-calc — 생성(python/openpyxl→xlsx→soffice→pdf) + 저장 + PDF 반환
 * GET  /orders/:id/docs           — 서류 목록(type별 최신본)
 * GET  /orders/:id/docs/:docId/download — 특정 이력 버전 다운로드
 * POST /orders/:id/docs/contract  — 특장 매매계약서(docx 토큰치환→soffice→pdf)
 *
 * 구조변경 서류(하중계산서·제원대비표)는 영업(SALES) 노출 금지 — rbac('ADMIN','MAKER').
 * **계약서만 예외** — 계약은 영업 업무이므로 rbac('ADMIN','SALES').
 */
import { Router } from 'express';
import { noStore } from '../lib/doc-headers.js';
import type { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { rbac, ownOrgOnly } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { generateContractDoc, ContractDocError } from '../services/contract-docgen.js';
import {
  generateLoadCalcDoc,
  generateSpecTableDoc,
  listGeneratedDocs,
  DocGenUnavailableError,
  DocGenInputError,
} from '../services/docgen.js';

export const docsRouter = Router();

/** 주문 조회 + MAKER org 범위 체크. 오류 시 res에 직접 응답하고 null 반환 */
async function loadOrderScoped(req: Request, res: Response): Promise<{ id: number; maker_org_id: string | null } | null> {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return null;
  }
  const id = Number((req.params as Record<string, string>)['id']);
  if (isNaN(id)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 order id' } });
    return null;
  }
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true, maker_org_id: true } });
  if (!order) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } });
    return null;
  }
  const auth = req.auth!;
  if (ownOrgOnly(auth) && order.maker_org_id !== auth.org_code) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '자기 조직의 주문만 조회할 수 있습니다' } });
    return null;
  }
  return order;
}

function handleDocGenError(e: unknown, res: Response, logTag: string): void {
  if (e instanceof DocGenUnavailableError) {
    console.error(`[${logTag}] 문서 생성 환경 미구성`, e.message);
    res.status(503).json({ error: { code: 'DOCGEN_UNAVAILABLE', message: '문서 생성 환경 미구성: ' + e.message } });
    return;
  }
  if (e instanceof DocGenInputError) {
    res.status(422).json({ error: { code: 'DOCGEN_INPUT_INVALID', message: e.message } });
    return;
  }
  console.error(`[${logTag}]`, e);
  res.status(500).json({ error: { code: 'INTERNAL', message: '서류 생성 중 오류가 발생했습니다.' } });
}

// ── PATCH /:id/vehicle-info — 차량정보 저장(서류 바인딩용) ───────────────────

docsRouter.patch('/:id/vehicle-info', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order || !prisma) return;
  try {
    const updated = await prisma.order.update({
      where: { id: order.id },
      data: { vehicle_info: req.body as object },
      select: { id: true, vehicle_info: true },
    });
    res.json({ data: updated });
  } catch (e) {
    console.error('[PATCH /orders/:id/vehicle-info]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '차량정보 저장 중 오류' } });
  }
});

// ── GET /:id/docs/load-calc ───────────────────────────────────────────────
// 견적서 PDF(GET /quotes/:id/pdf)와 동일하게 링크로 바로 열리도록 GET. 호출 시
// 생성+버전 누적(quotes 의 PDF 도 GET-생성 방식). 프론트는 <a href> 로 새 탭 열기.

docsRouter.get('/:id/docs/load-calc', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order) return;

  try {
    const result = await generateLoadCalcDoc(order.id);
    noStore(res);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(`하중계산서_주문${order.id}_v${result.version}.pdf`)}`
    );
    createReadStream(result.filePath).pipe(res);
  } catch (e) {
    handleDocGenError(e, res, 'POST docs/load-calc');
  }
});

// ── GET /:id/docs/spec-table ──────────────────────────────────────────────
// 주요제원대비표. 하중계산서와 동일하게 GET-생성(버전 누적) + inline PDF 반환.

docsRouter.get('/:id/docs/spec-table', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order) return;

  try {
    const result = await generateSpecTableDoc(order.id);
    noStore(res);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(`주요제원대비표_주문${order.id}_v${result.version}.pdf`)}`
    );
    createReadStream(result.filePath).pipe(res);
  } catch (e) {
    handleDocGenError(e, res, 'GET docs/spec-table');
  }
});

// ── GET /:id/docs — 목록(type별 최신본) ──────────────────────────────────────

// ── 특장 매매계약서 — 영업·관리자 (구조변경 서류와 달리 SALES 허용) ─────────
const contractHandler = async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order) return;

  try {
    const result = await generateContractDoc(order.id);
    if (result.warnings.length) console.warn('[POST docs/contract]', result.warnings.join(' / '));
    noStore(res);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Doc-Version', String(result.version));
    if (result.warnings.length) res.setHeader('X-Doc-Warning', encodeURIComponent(result.warnings.join(' / ')));
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(`특장매매계약서_주문${order.id}_v${result.version}.pdf`)}`
    );
    res.send(result.pdf);
  } catch (e) {
    if (e instanceof ContractDocError) {
      const status = e.code === 'UNAVAILABLE' ? 503 : e.code === 'NOT_FOUND' ? 404 : 422;
      console.error('[POST docs/contract]', e.code, e.message);
      res.status(status).json({ error: { code: `CONTRACT_${e.code}`, message: e.message } });
      return;
    }
    console.error('[POST docs/contract]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '계약서 생성 중 오류가 발생했습니다.' } });
  }
};
// POST=명시 생성, GET=미리보기(iframe) — 동일 핸들러(생성·저장·PDF 반환)
docsRouter.post('/:id/docs/contract', rbac('ADMIN', 'SALES'), contractHandler);
docsRouter.get('/:id/docs/contract', rbac('ADMIN', 'SALES'), contractHandler);

/**
 * 특장사(MAKER)가 볼 수 있는 서류는 **구조변경 관련 서류뿐**이다.
 * 계약서는 영업·관리 문서이므로 목록에도 노출하지 않고 다운로드도 막는다.
 */
const MAKER_HIDDEN_DOC_TYPES = new Set(['contract']);

docsRouter.get('/:id/docs', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order) return;

  try {
    const docs = await listGeneratedDocs(order.id);
    const visible = ownOrgOnly(req.auth!)
      ? docs.filter(d => !MAKER_HIDDEN_DOC_TYPES.has(d.type))
      : docs;
    res.json({ data: visible.map(d => ({ id: d.id, type: d.type, version: d.version, generated_at: d.generated_at })) });
  } catch (e) {
    handleDocGenError(e, res, 'GET docs');
  }
});

// ── GET /:id/docs/:docId/download ────────────────────────────────────────

docsRouter.get('/:id/docs/:docId/download', rbac('ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  const order = await loadOrderScoped(req, res);
  if (!order) return;
  if (!prisma) return;

  const docId = Number((req.params as Record<string, string>)['docId']);
  if (isNaN(docId)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 문서 id' } });
    return;
  }
  const doc = await prisma.generatedDocument.findUnique({ where: { id: docId } });
  if (!doc || doc.order_id !== order.id) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '서류를 찾을 수 없습니다' } });
    return;
  }
  // 특장사는 구조변경 서류만 — 계약서 id 를 직접 넣어도 내려주지 않는다(목록 필터만으론 못 막음)
  if (ownOrgOnly(req.auth!) && MAKER_HIDDEN_DOC_TYPES.has(doc.type)) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '서류를 찾을 수 없습니다' } });
    return;
  }
  noStore(res);
    res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(`${doc.type}_주문${order.id}_v${doc.version}.pdf`)}`
  );
  createReadStream(doc.file_path).on('error', () => {
    res.status(404).json({ error: { code: 'FILE_MISSING', message: '파일을 찾을 수 없습니다' } });
  }).pipe(res);
});
