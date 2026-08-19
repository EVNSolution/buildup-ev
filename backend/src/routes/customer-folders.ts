/**
 * 고객 서류함 — 목록 · 폴더 · 내려받기.
 *
 * 화면(견적 목록 · 견적·주문)이 읽는 곳이다. 규칙은 전부 `services/customer-folders.ts`
 * 에 있고 여기서는 **누가 무엇을 볼 수 있는가**만 정한다.
 *
 * 범위: 관리자는 전부, 영업은 **자기 견적의 고객만**.
 * ⚠️ 화면에서 목록을 좁히는 것만으로는 막은 것이 아니다 — 폴더 열기와 내려받기에서도
 *    같은 범위를 다시 확인한다. 열쇠(고객번호)는 주소창에서 바꿀 수 있다.
 */
import { Router, type Request, type Response } from 'express';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { rbac, isAdmin } from '../middleware/rbac.js';
import { VISIBLE } from '../lib/visibility.js';
import {
  groupCustomers, collectDocs, resolveDocId,
  type CustomerGroup, type FolderCustomer, type PinnedInput,
} from '../services/customer-folders.js';

export const customerFoldersRouter = Router();

function guard(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (e) {
      console.error(`[customer-folders] ${req.method} ${req.originalUrl}`, e);
      if (!res.headersSent) {
        res.status(500).json({ error: { code: 'INTERNAL', message: '서류함을 불러오지 못했습니다.' } });
      }
    }
  };
}

/**
 * 이 사용자가 볼 수 있는 고객 그룹 전부.
 *
 * 영업은 자기 견적에 붙은 고객만 본다 — 견적을 못 보는 고객의 서류를 볼 이유가 없다.
 * 숨긴 고객은 빼되, **숨긴 고객의 서류가 다른 행에 섞여 있으면** 그 행은 그대로 보인다
 * (같은 사람인데 한 행만 숨긴 경우 — 숨김은 목록 정리용이지 서류를 없애는 뜻이 아니다).
 */
async function visibleGroups(req: Request): Promise<CustomerGroup[]> {
  const auth = req.auth!;
  const where = isAdmin(auth)
    ? { ...VISIBLE }
    : { ...VISIBLE, quotes: { some: { sales_user_id: auth.email } } };

  const rows = await prisma!.customer.findMany({
    where,
    select: { id: true, name: true, reg_no: true, phone: true, updated_at: true },
  });
  return groupCustomers(rows as FolderCustomer[]);
}

/** 그룹의 **최근 활동 시각** — 고객 행 수정과 서류 발행 중 더 나중 것. */
async function lastActivity(g: CustomerGroup): Promise<{ at: Date; quotes: number }> {
  const agg = await prisma!.quote.aggregate({
    where: { customer_id: { in: g.ids }, ...VISIBLE },
    _max: { created_at: true, docs_frozen_at: true, docs_emailed_at: true },
    _count: { _all: true },
  });
  const times = [g.updatedAt, agg._max.created_at, agg._max.docs_frozen_at, agg._max.docs_emailed_at]
    .filter((d): d is Date => !!d);
  return { at: new Date(Math.max(...times.map(d => d.getTime()))), quotes: agg._count._all };
}

// ── GET /customer-folders — 폴더 목록(최근 변경 순) ─────────────────────────
customerFoldersRouter.get('/', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }

  const groups = await visibleGroups(req);
  const rows = await Promise.all(groups.map(async g => ({
    key: g.key,
    name: g.name,
    reg_no: g.reg_no,
    phone: g.phone,
    /** 한 사람인데 고객 행이 여럿인 경우 — 화면에서 「행 2개」로 알려 준다 */
    merged: g.ids.length,
    ...await lastActivity(g),
  })));

  // 최근에 손댄 고객이 위로 — 「방금 뭘 했더라」가 가장 잦은 질문이다
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  res.json({ data: rows.map(r => ({ ...r, last_activity: r.at.toISOString(), at: undefined })) });
}));

// ── GET /customer-folders/:key — 폴더 안 ───────────────────────────────────
customerFoldersRouter.get('/:key', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const key = Number(req.params['key']);
  if (!Number.isInteger(key)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 고객 번호입니다' } }); return; }

  // ⚠️ 목록과 **같은 범위**로 다시 찾는다 — 주소창에서 열쇠만 바꿔 남의 서류를 열 수 없게
  const g = (await visibleGroups(req)).find(x => x.key === key);
  if (!g) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '고객을 찾을 수 없습니다' } }); return; }

  const quotes = await prisma.quote.findMany({
    where: { customer_id: { in: g.ids }, ...VISIBLE },
    select: {
      quote_no: true, docs_frozen_at: true,
      docs_frozen_quote_path: true, docs_frozen_contract_path: true,
    },
    orderBy: { id: 'desc' },
  });
  const pinned: PinnedInput[] = quotes
    .filter(q => q.docs_frozen_at)
    .map(q => ({
      quoteNo: q.quote_no,
      frozenAt: q.docs_frozen_at!,
      quotePath: q.docs_frozen_quote_path,
      contractPath: q.docs_frozen_contract_path,
    }));

  res.json({
    data: await collectDocs(g.ids, pinned),
    customer: { key: g.key, name: g.name, reg_no: g.reg_no, phone: g.phone, merged: g.ids.length },
  });
}));

// ── GET /customer-folders/:key/file/:docId — 열기·내려받기 ─────────────────
customerFoldersRouter.get('/:key/file/:docId', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const key = Number(req.params['key']);
  if (!Number.isInteger(key)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 고객 번호입니다' } }); return; }

  const g = (await visibleGroups(req)).find(x => x.key === key);
  if (!g) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }

  /*
   * 열쇠를 풀어 실제 경로를 얻는다(저장소 밖이면 null). 그다음 **이 고객의 서류가 맞는지**
   * 폴더 목록으로 다시 확인한다 — 경로만 검사하면 남의 폴더 파일을 열 수 있다.
   */
  const abs = resolveDocId(String(req.params['docId'] ?? ''));
  if (!abs) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 파일입니다' } }); return; }

  const quotes = await prisma.quote.findMany({
    where: { customer_id: { in: g.ids }, ...VISIBLE },
    select: { quote_no: true, docs_frozen_at: true, docs_frozen_quote_path: true, docs_frozen_contract_path: true },
  });
  const pinned: PinnedInput[] = quotes.filter(q => q.docs_frozen_at).map(q => ({
    quoteNo: q.quote_no, frozenAt: q.docs_frozen_at!,
    quotePath: q.docs_frozen_quote_path, contractPath: q.docs_frozen_contract_path,
  }));
  const allowed = new Set((await collectDocs(g.ids, pinned)).map(d => d.id));
  if (!allowed.has(String(req.params['docId']))) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } }); return;
  }

  try { await stat(abs); } catch {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '파일을 찾을 수 없습니다' } }); return;
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const dl = req.query['dl'] === '1';
  const name = `${g.name}_${abs.split('/').pop() ?? 'doc.pdf'}`;
  res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  createReadStream(abs).pipe(res);
}));
