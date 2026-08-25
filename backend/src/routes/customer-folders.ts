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
import { noStore } from '../lib/doc-headers.js';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { rbac, ownQuotesOnly, scopedToMine } from '../middleware/rbac.js';
import { VISIBLE } from '../lib/visibility.js';
import {
  groupCustomers, collectDocs, resolveDocId, optionChips, groupDocsByQuote,
  type CustomerGroup, type FolderCustomer, type PinnedInput, type FolderQuote,
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
 * **내가 볼 수 있는 견적**의 조건 — 견적 목록(`GET /quotes`)과 **글자 그대로 같아야 한다.**
 *
 * ⚠️ 처음엔 고객 쪽에서 「내 견적이 하나라도 붙은 고객」으로 골랐다. 그런데 그 조건에는
 *    견적의 숨김 여부가 빠져 있어, **숨긴 견적의 고객이 서류함에만 남았다** —
 *    「견적·주문에는 아무것도 없는데 서류함에는 고객이 둘」이 됐다(실제 제보).
 *    범위는 한 곳에서만 정해야 두 화면이 갈리지 않는다.
 */
function quoteScope(req: Request) {
  const auth = req.auth!;
  /*
   * 영업 화면은 `scope=mine` 을 붙여 부른다 — 겸직 계정이라도 남의 고객은 안 본다.
   * 견적 목록과 같은 규칙이어야 두 화면이 갈리지 않는다(마스터는 제외).
   */
  const mine = ownQuotesOnly(auth) || scopedToMine(auth, (req.query as { scope?: unknown }).scope);
  return {
    ...VISIBLE,
    ...(mine ? { sales_user_id: auth.email } : {}),
  };
}

/**
 * 이 사용자가 볼 수 있는 고객 그룹 전부.
 *
 * **고객이 아니라 견적에서 출발한다.** 서류함은 「내가 견적을 낸 고객」의 서류를 모으는
 * 자리라, 볼 수 있는 견적이 하나도 없는 고객은 애초에 여기 있을 일이 없다.
 * (고객 쪽에서 출발하면 조건을 하나 빠뜨렸을 때 남의 고객이 조용히 섞인다)
 */
async function visibleGroups(req: Request): Promise<{ groups: CustomerGroup[]; quoteCount: Map<number, number> }> {
  const quotes = await prisma!.quote.findMany({
    where: quoteScope(req),
    select: { customer_id: true },
  });
  const ids = [...new Set(quotes.map(q => q.customer_id).filter((v): v is number => v !== null))];
  if (ids.length === 0) return { groups: [], quoteCount: new Map() };

  const rows = await prisma!.customer.findMany({
    where: { id: { in: ids }, ...VISIBLE },
    select: { id: true, name: true, reg_no: true, phone: true, updated_at: true },
  });
  const groups = groupCustomers(rows as FolderCustomer[]);

  // 고객 행별 견적 수 — 그룹으로 합쳐 화면에 「견적 N건」으로 적는다
  const per = new Map<number, number>();
  for (const q of quotes) {
    if (q.customer_id === null) continue;
    per.set(q.customer_id, (per.get(q.customer_id) ?? 0) + 1);
  }
  return { groups, quoteCount: per };
}

/**
 * 그룹의 **최근 활동 시각** — 고객 행 수정과 서류 발행 중 더 나중 것.
 * ⚠️ 세는 견적은 **범위 안의 것만**이다. 남의 견적 시각이 섞이면 내 목록에 없는 건 때문에
 *    고객이 맨 위로 올라온다.
 */
async function lastActivity(req: Request, g: CustomerGroup): Promise<Date> {
  const agg = await prisma!.quote.aggregate({
    where: { customer_id: { in: g.ids }, ...quoteScope(req) },
    _max: { created_at: true, docs_frozen_at: true, docs_emailed_at: true },
  });
  const times = [g.updatedAt, agg._max.created_at, agg._max.docs_frozen_at, agg._max.docs_emailed_at]
    .filter((d): d is Date => !!d);
  return new Date(Math.max(...times.map(d => d.getTime())));
}

// ── GET /customer-folders — 폴더 목록(최근 변경 순) ─────────────────────────
customerFoldersRouter.get('/', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }

  const { groups, quoteCount } = await visibleGroups(req);
  const rows = await Promise.all(groups.map(async g => ({
    key: g.key,
    name: g.name,
    reg_no: g.reg_no,
    phone: g.phone,
    /** 한 사람인데 고객 행이 여럿인 경우 — 화면에서 「행 2개」로 알려 준다 */
    merged: g.ids.length,
    quotes: g.ids.reduce((n, id) => n + (quoteCount.get(id) ?? 0), 0),
    at: await lastActivity(req, g),
  })));

  // 최근에 손댄 고객이 위로 — 「방금 뭘 했더라」가 가장 잦은 질문이다
  rows.sort((a, b) => b.at.getTime() - a.at.getTime());
  res.json({ data: rows.map(({ at, ...r }) => ({ ...r, last_activity: at.toISOString() })) });
}));

// ── GET /customer-folders/:key — 폴더 안 ───────────────────────────────────
customerFoldersRouter.get('/:key', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const key = Number(req.params['key']);
  if (!Number.isInteger(key)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 고객 번호입니다' } }); return; }

  // ⚠️ 목록과 **같은 범위**로 다시 찾는다 — 주소창에서 열쇠만 바꿔 남의 서류를 열 수 없게
  const g = (await visibleGroups(req)).groups.find(x => x.key === key);
  if (!g) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '고객을 찾을 수 없습니다' } }); return; }

  const quotes = await prisma.quote.findMany({
    where: { customer_id: { in: g.ids }, ...quoteScope(req) },
    select: {
      id: true, quote_no: true, status: true, created_at: true, final_price: true,
      selections: true, docs_frozen_at: true,
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

  /*
   * 옵션 이름은 **DB 에서** 읽는다. 화면에 표기를 또 적어 두면 옵션 이름을 고쳤을 때
   * 두 곳이 갈린다(가격·이름의 정본은 언제나 기준데이터다).
   */
  const picked = [...new Set(quotes.flatMap(q => Object.values((q.selections ?? {}) as Record<string, string>)))]
    .filter(Boolean);
  const values = picked.length
    ? await prisma.optionValue.findMany({ where: { code: { in: picked } }, select: { code: true, name: true } })
    : [];
  const nameOf = new Map(values.map(v => [v.code, v.name]));

  const docs = await collectDocs(g.ids, pinned);
  const byQuote = groupDocsByQuote(docs);

  /*
   * 견적 카드는 **최신이 위**다. 그중 서류가 굳은(서명 요청까지 간) 건이 있으면
   * 화면이 그것을 맨 위에 고정한다 — 어느 것이 실제로 나간 판인지가 먼저 읽혀야 한다.
   */
  const cards: FolderQuote[] = quotes.map(q => ({
    id: q.id,
    quoteNo: q.quote_no,
    status: q.status,
    createdAt: q.created_at.toISOString(),
    finalPrice: q.final_price,
    options: optionChips((q.selections ?? {}) as Record<string, string>, c => nameOf.get(c)),
    frozenAt: q.docs_frozen_at?.toISOString() ?? null,
    docs: byQuote.get(q.quote_no ?? null) ?? [],
  }));

  /*
   * 견적번호로 이을 수 없는 서류(공개 접수 직후 등)는 버리지 않는다 —
   * 어느 건인지 모를 뿐 고객의 서류인 것은 맞다. 맨 아래 따로 모아 둔다.
   */
  const known = new Set(quotes.map(q => q.quote_no ?? null));
  const orphan = [...byQuote.entries()]
    .filter(([k]) => !known.has(k))
    .flatMap(([, v]) => v);

  res.json({
    data: docs,   // 옛 화면 호환 — 평평한 목록도 함께 내려준다
    quotes: cards,
    orphanDocs: orphan,
    customer: { key: g.key, name: g.name, reg_no: g.reg_no, phone: g.phone, merged: g.ids.length },
  });
}));

// ── GET /customer-folders/:key/file/:docId — 열기·내려받기 ─────────────────
customerFoldersRouter.get('/:key/file/:docId', rbac('ADMIN', 'SALES'), guard(async (req, res) => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const key = Number(req.params['key']);
  if (!Number.isInteger(key)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 고객 번호입니다' } }); return; }

  const g = (await visibleGroups(req)).groups.find(x => x.key === key);
  if (!g) { res.status(404).json({ error: { code: 'NOT_FOUND' } }); return; }

  /*
   * 열쇠를 풀어 실제 경로를 얻는다(저장소 밖이면 null). 그다음 **이 고객의 서류가 맞는지**
   * 폴더 목록으로 다시 확인한다 — 경로만 검사하면 남의 폴더 파일을 열 수 있다.
   */
  const abs = resolveDocId(String(req.params['docId'] ?? ''));
  if (!abs) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '잘못된 파일입니다' } }); return; }

  const quotes = await prisma.quote.findMany({
    where: { customer_id: { in: g.ids }, ...quoteScope(req) },
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

  noStore(res);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const dl = req.query['dl'] === '1';
  const name = `${g.name}_${abs.split('/').pop() ?? 'doc.pdf'}`;
  res.setHeader('Content-Disposition', `${dl ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
  createReadStream(abs).pipe(res);
}));
