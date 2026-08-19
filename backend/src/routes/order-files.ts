/**
 * 주문에 딸린 **파일 전부**를 한자리에서 — 관리자 「파일」 화면이 읽는 곳.
 *
 * 파일은 지금 네 군데에 흩어져 있다:
 *   · `order_file`          단계마다 올린 증빙(사진·서류)
 *   · `generated_document`  우리가 만들어 낸 PDF(하중계산서·제원대비표·계약서)
 *   · `purchase_contract`   매매계약 서명본
 *   · `tuning_application`  튜닝신청서 서명본
 *
 * 「그 주문 사진 좀 다 보내 주세요」에 답하려면 네 화면을 오가며 긁어모아야 했다.
 * 여기서 **한 목록으로 펴서** 내려준다. 어디서 온 파일인지(`group`)는 그대로 달아
 * 「사람이 올린 것만」을 화면에서 가려낼 수 있게 한다 — 자동생성 PDF 는 언제든 다시
 * 만들 수 있지만, 올린 사진은 그때 그 현장이 아니면 다시 못 얻는다.
 *
 * ⚠️ 이 라우터는 **내려주는 길을 새로 열지 않는다**. 각 파일의 `url` 은 이미 있던
 *    엔드포인트를 가리킨다(권한 검사도 그쪽에 그대로 있다). 여기서 파일을 직접
 *    스트리밍하면 같은 권한 규칙을 두 곳에 적게 된다.
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { EVIDENCE_LABEL, type EvidenceKind } from '@buildup-ev/shared/process';

export const orderFilesRouter = Router();

/** 파일이 어디서 왔나 — 화면의 가름막이 이 값으로 갈린다. */
export type FileGroup = 'upload' | 'generated' | 'signed';

interface FileEntry {
  /** 화면에서 골라 보는 기준 */
  group: FileGroup;
  /** 무엇인지 한 줄로 — 「검수 사진」 · 「하중계산서 v2」 · 「매매계약서 서명본」 */
  label: string;
  /** 원래 파일명(있으면). 업로드본만 가진다 */
  name: string | null;
  size: number | null;
  /** 올라온·만들어진 시각 (ISO) */
  at: string;
  /** 올린 사람. 자동생성물은 사람이 없다 */
  by: string | null;
  /** 여는 주소 — 이미 있던 엔드포인트를 가리킨다 */
  url: string;
  /** 내려받는 주소(첨부로 받는다) */
  download_url: string;
}

const GEN_LABEL: Record<string, string> = {
  load_calc: '하중계산서',
  spec_table: '주요제원대비표',
  work_order: '작업지시서',
  contract: '특장 매매 및 구조변경 계약서',
};

async function collect(orderId: number, quoteId: number): Promise<FileEntry[]> {
  const [uploads, generated, contracts, tunings] = await Promise.all([
    prisma!.orderFile.findMany({
      where: { order_id: orderId },
      select: {
        id: true, kind: true, original_name: true, size_bytes: true,
        uploaded_by: true, uploaded_at: true, step_code: true,
      },
      orderBy: { uploaded_at: 'asc' },
    }),
    prisma!.generatedDocument.findMany({
      where: { order_id: orderId },
      select: { id: true, type: true, version: true, generated_at: true },
      orderBy: { generated_at: 'asc' },
    }),
    prisma!.purchaseContract.findMany({
      where: { quote_id: quoteId, signed_pdf_path: { not: null } },
      select: { id: true, completed_at: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }),
    prisma!.tuningApplication.findMany({
      where: { order_id: orderId, signed_pdf_path: { not: null } },
      select: { id: true, completed_at: true, created_at: true },
      orderBy: { created_at: 'asc' },
    }),
  ]);

  const out: FileEntry[] = [];

  for (const f of uploads) {
    const url = `/api/v1/orders/${orderId}/files/${f.id}`;
    out.push({
      group: 'upload',
      label: EVIDENCE_LABEL[f.kind as EvidenceKind] ?? f.kind,
      name: f.original_name,
      size: f.size_bytes,
      at: f.uploaded_at.toISOString(),
      by: f.uploaded_by,
      url,
      download_url: `${url}?dl=1`,
    });
  }

  for (const d of generated) {
    // 같은 서류를 다시 만들면 버전이 쌓인다 — 어느 판인지 이름에 적어 준다
    const url = `/api/v1/orders/${orderId}/docs/${d.id}/download`;
    out.push({
      group: 'generated',
      label: `${GEN_LABEL[d.type] ?? d.type} v${d.version}`,
      name: null, size: null,
      at: d.generated_at.toISOString(),
      by: null,
      url, download_url: url,
    });
  }

  for (const c of contracts) {
    const url = `/api/v1/quotes/${quoteId}/contract/signed`;
    out.push({
      group: 'signed',
      label: '매매계약서 서명본',
      name: null, size: null,
      at: (c.completed_at ?? c.created_at).toISOString(),
      by: null,
      url, download_url: url,
    });
  }

  for (const t of tunings) {
    const url = `/api/v1/orders/${orderId}/tuning/signed`;
    out.push({
      group: 'signed',
      label: '튜닝신청서 서명본',
      name: null, size: null,
      at: (t.completed_at ?? t.created_at).toISOString(),
      by: null,
      url, download_url: url,
    });
  }

  out.sort((a, b) => a.at.localeCompare(b.at));
  return out;
}

/**
 * GET /orders/file-index — **주문마다 파일이 몇 개인지** 한 목록으로.
 *
 * 목록에서 개수까지 보여야 「사진이 안 올라온 건」을 눈으로 찾을 수 있다.
 * 파일이 하나도 없는 주문도 내려준다 — 없다는 것도 알아야 할 사실이다.
 */
orderFilesRouter.get('/file-index', rbac('ADMIN'), requirePermission('order.view'),
  async (req: Request, res: Response): Promise<void> => {
    if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
    void req;

    const orders = await prisma.order.findMany({
      orderBy: { id: 'desc' },
      select: {
        id: true, quote_id: true, created_at: true,
        maker_org: { select: { name: true } },
        quote: { select: { quote_no: true, customer: { select: { name: true } } } },
        _count: { select: { files: true, generated_documents: true } },
      },
    });

    res.json({
      data: orders.map(o => ({
        order_id: o.id,
        quote_id: o.quote_id,
        quote_no: o.quote.quote_no,
        customer_name: o.quote.customer?.name ?? null,
        maker_org: o.maker_org?.name ?? null,
        created_at: o.created_at.toISOString(),
        /** 사람이 올린 파일 수 — 화면이 「없음」을 가려내는 기준 */
        uploads: o._count.files,
        /** 자동생성 서류 수 */
        generated: o._count.generated_documents,
      })),
    });
  });

/** GET /orders/:id/file-index — 주문 하나의 파일 전부(업로드·자동생성·서명본). */
orderFilesRouter.get('/:id/file-index', rbac('ADMIN'), requirePermission('order.view'),
  async (req: Request, res: Response): Promise<void> => {
    if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
    const id = Number(req.params['id']);
    if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 주문 번호입니다' } }); return; }

    const order = await prisma.order.findUnique({
      where: { id },
      select: { id: true, quote_id: true, quote: { select: { quote_no: true, customer: { select: { name: true } } } } },
    });
    if (!order) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '주문을 찾을 수 없습니다' } }); return; }

    res.json({
      data: await collect(order.id, order.quote_id),
      order: {
        id: order.id,
        quote_no: order.quote.quote_no,
        customer_name: order.quote.customer?.name ?? null,
      },
    });
  });
