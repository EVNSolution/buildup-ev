/**
 * 옵션DB(기준데이터) 관리자 CRUD — ADMIN 전용. 영업(SALES) 노출 금지.
 * 대상: option_price · subsidy_local(지역 161행) · subsidy_national ·
 *       tax_config(공채·계약금·커머셜 포함) · installment_rate.
 * 모든 변경은 option_db_change_log 에 필드별 이전값→새값·수정자·수정일시로 기록된다.
 * (총견적서 정답지 = STEGO-K1_총견적서.xlsx '옵션DB' 시트 — 값은 여기서만 수정)
 */
import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import type { Prisma } from '@prisma/client';
import { invalidateWeightConstantsCache } from '../services/weight-constants.js';

export const optionDbRouter = Router();

type Row = Record<string, unknown>;
interface TableDef {
  pk: string[];               // PK 필드
  fields: string[];           // 수정 가능 필드
  numeric: string[];          // 숫자 강제 변환 필드
  list(q: string | undefined): Promise<Row[]>;
  find(key: Row): Promise<Row | null>;
  upsert(key: Row, data: Row): Promise<Row>;
}

/** Decimal·BigInt 를 number 로 눕혀 JSON 안전하게. */
const num = (v: unknown) => (v == null ? null : Number(v));

function db() {
  if (!prisma) throw new Error('DB_UNAVAILABLE');
  return prisma;
}

const TABLES: Record<string, TableDef> = {
  option_price: {
    pk: ['model_code', 'value_code'], fields: ['supply_price', 'memo'], numeric: ['supply_price'],
    list: async (q) => db().optionPrice.findMany({
      where: q ? { value_code: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: [{ model_code: 'asc' }, { value_code: 'asc' }],
    }),
    find: async (k) => db().optionPrice.findUnique({
      where: { model_code_value_code: { model_code: String(k['model_code']), value_code: String(k['value_code']) } },
    }),
    upsert: async (k, d) => db().optionPrice.upsert({
      where: { model_code_value_code: { model_code: String(k['model_code']), value_code: String(k['value_code']) } },
      update: { supply_price: Number(d['supply_price']), memo: (d['memo'] as string) ?? null },
      create: { model_code: String(k['model_code']), value_code: String(k['value_code']), supply_price: Number(d['supply_price']), memo: (d['memo'] as string) ?? null },
    }),
  },
  subsidy_local: {
    pk: ['region', 'year'], fields: ['amount', 'active', 'extra', 'remaining_quota', 'as_of'], numeric: ['amount', 'extra', 'remaining_quota'],
    list: async (q) => db().subsidyLocal.findMany({
      where: q ? { region: { contains: q, mode: 'insensitive' } } : undefined,
      orderBy: [{ year: 'desc' }, { region: 'asc' }],
    }),
    find: async (k) => db().subsidyLocal.findUnique({ where: { region_year: { region: String(k['region']), year: Number(k['year']) } } }),
    upsert: async (k, d) => db().subsidyLocal.upsert({
      where: { region_year: { region: String(k['region']), year: Number(k['year']) } },
      update: { amount: Number(d['amount']), active: d['active'] !== false && d['active'] !== 'false', extra: num(d['extra']), remaining_quota: num(d['remaining_quota']), as_of: (d['as_of'] as string) ?? null },
      create: { region: String(k['region']), year: Number(k['year']), amount: Number(d['amount']), active: d['active'] !== false && d['active'] !== 'false', extra: num(d['extra']), remaining_quota: num(d['remaining_quota']), as_of: (d['as_of'] as string) ?? null },
    }),
  },
  subsidy_national: {
    pk: ['model_code', 'year'], fields: ['amount', 'sosang_rate'], numeric: ['amount', 'sosang_rate'],
    list: async () => (await db().subsidyNational.findMany({ orderBy: [{ year: 'desc' }, { model_code: 'asc' }] }))
      .map((r) => ({ ...r, sosang_rate: num(r.sosang_rate) })),
    find: async (k) => db().subsidyNational.findUnique({ where: { model_code_year: { model_code: String(k['model_code']), year: Number(k['year']) } } }),
    upsert: async (k, d) => db().subsidyNational.upsert({
      where: { model_code_year: { model_code: String(k['model_code']), year: Number(k['year']) } },
      update: { amount: Number(d['amount']), sosang_rate: d['sosang_rate'] == null ? null : String(d['sosang_rate']) },
      create: { model_code: String(k['model_code']), year: Number(k['year']), amount: Number(d['amount']), sosang_rate: d['sosang_rate'] == null ? null : String(d['sosang_rate']) },
    }),
  },
  tax_config: {
    pk: ['param_key'], fields: ['value', 'unit', 'memo'], numeric: ['value'],
    list: async () => (await db().taxConfig.findMany({ orderBy: { param_key: 'asc' } })).map((r) => ({ ...r, value: num(r.value) })),
    find: async (k) => db().taxConfig.findUnique({ where: { param_key: String(k['param_key']) } }),
    upsert: async (k, d) => db().taxConfig.upsert({
      where: { param_key: String(k['param_key']) },
      update: { value: String(d['value']), unit: (d['unit'] as string) ?? null, memo: (d['memo'] as string) ?? null },
      create: { param_key: String(k['param_key']), value: String(d['value']), unit: (d['unit'] as string) ?? null, memo: (d['memo'] as string) ?? null },
    }),
  },
  // 무게상수 — 예전엔 별도 화면·별도 라우트였다. 관리자가 "DB 고치는 곳"이 두 군데로
  // 갈라져 있으면 한쪽만 낡는다. 여기로 합쳐 편집·이력·되돌리기를 전부 같은 방식으로 쓴다.
  // 값이 바뀌면 캐시를 비워야 다음 서류생성부터 재계산에 반영된다.
  weight_constant: {
    pk: ['key'], fields: ['value', 'unit', 'description'], numeric: ['value'],
    list: async (q) => (await db().weightConstant.findMany({
      where: q ? { OR: [{ key: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : undefined,
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    })).map((r) => ({ ...r, value: num(r.value) })),
    find: async (k) => db().weightConstant.findUnique({ where: { key: String(k['key']) } }),
    upsert: async (k, d) => {
      const row = await db().weightConstant.update({
        where: { key: String(k['key']) },
        // category 는 화면 분류 기준이라 편집 대상이 아니다 — 값·단위·설명만 고친다.
        data: { value: Number(d['value']), unit: (d['unit'] as string) ?? null, description: (d['description'] as string) ?? null },
      });
      invalidateWeightConstantsCache();
      return { ...row, value: num(row.value) };
    },
  },
  installment_rate: {
    pk: ['months'], fields: ['rate', 'label', 'active'], numeric: ['rate'],
    list: async () => (await db().installmentRate.findMany({ orderBy: { months: 'asc' } })).map((r) => ({ ...r, rate: num(r.rate) })),
    find: async (k) => db().installmentRate.findUnique({ where: { months: Number(k['months']) } }),
    upsert: async (k, d) => db().installmentRate.upsert({
      where: { months: Number(k['months']) },
      update: { rate: String(d['rate']), label: (d['label'] as string) ?? null, active: d['active'] !== false },
      create: { months: Number(k['months']), rate: String(d['rate']), label: (d['label'] as string) ?? null, active: d['active'] !== false },
    }),
  },
};

const rowKey = (def: TableDef, k: Row) => def.pk.map((f) => String(k[f] ?? '')).join('|');
const asText = (v: unknown) => (v == null || v === '' ? null : String(v));

/** 변경 필드만 감사이력으로 기록. */
async function writeLog(
  table: string, key: string, before: Row | null, after: Row,
  fields: string[], user: string, action: 'create' | 'update' | 'rollback',
): Promise<number> {
  const entries: Prisma.OptionDbChangeLogCreateManyInput[] = [];
  for (const f of fields) {
    const o = asText(before?.[f]);
    const n = asText(after[f]);
    if (o !== n) entries.push({ table_name: table, row_key: key, field: f, old_value: o, new_value: n, action, changed_by: user });
  }
  if (entries.length) await db().optionDbChangeLog.createMany({ data: entries });
  return entries.length;
}

// ── GET /option-db/tables — 지원 테이블 목록 ─────────────────────────────────
optionDbRouter.get('/tables', rbac('ADMIN'), (_req: Request, res) => {
  res.json({ data: Object.entries(TABLES).map(([name, d]) => ({ name, pk: d.pk, fields: d.fields, numeric: d.numeric })) });
});

// ── GET /option-db/logs — 변경 이력(테이블·행 필터) ──────────────────────────
optionDbRouter.get('/logs', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const { table, row_key, limit } = req.query as Record<string, string | undefined>;
  const rows = await prisma.optionDbChangeLog.findMany({
    where: { ...(table ? { table_name: table } : {}), ...(row_key ? { row_key } : {}) },
    orderBy: { changed_at: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
  });
  res.json({ data: rows });
});

// ── 되돌리기(롤백) ──────────────────────────────────────────────────────────
//
// 이력이 남아 있으니 "그때로 되돌려 달라"가 자연스럽다. 별도 스냅샷 테이블 없이
// 변경이력만으로 복원한다: 어떤 (행·필드)든 **기준시각 이후 첫 변경의 old_value**가
// 곧 그 시각의 값이다. 그것만 되돌려 쓰면 기준시각 상태가 그대로 재현된다.
//
// 복원 자체도 하나의 변경이라 이력에 action='rollback' 으로 남는다 → 되돌리기를
// 되돌릴 수도 있다.

/** 한 번의 저장(같은 초에 기록된 이력)을 하나의 복원 지점으로 묶는다. */
interface RestorePoint { at: string; by: string; fields: number; rows: number; actions: string[] }

// ── GET /option-db/:table/restore-points — 되돌릴 수 있는 시점 목록 ──────────
optionDbRouter.get('/:table/restore-points', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const table = String(req.params['table']);
  if (!TABLES[table]) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '지원하지 않는 테이블' } }); return; }

  const logs = await prisma.optionDbChangeLog.findMany({
    where: { table_name: table }, orderBy: { changed_at: 'desc' }, take: 2000,
  });
  const groups = new Map<string, RestorePoint & { rowKeys: Set<string> }>();
  for (const l of logs) {
    // 한 번의 저장이 행마다 별도 INSERT 라 밀리초가 조금씩 다르다 → 초 단위로 묶는다
    const bucket = l.changed_at.toISOString().slice(0, 19);
    const g = groups.get(bucket) ?? { at: l.changed_at.toISOString(), by: l.changed_by, fields: 0, rows: 0, actions: [], rowKeys: new Set<string>() };
    g.fields += 1;
    g.rowKeys.add(l.row_key);
    if (!g.actions.includes(l.action)) g.actions.push(l.action);
    // 그룹의 기준시각 = 그 묶음에서 가장 이른 변경(= 이 저장 직전으로 되돌리는 지점)
    if (l.changed_at.toISOString() < g.at) g.at = l.changed_at.toISOString();
    groups.set(bucket, g);
  }
  const data = [...groups.values()]
    .map(({ rowKeys, ...g }) => ({ ...g, rows: rowKeys.size }))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, 50);
  res.json({ data });
});

// ── POST /option-db/:table/rollback — 지정 시각 직전 상태로 복원 ─────────────
optionDbRouter.post('/:table/rollback', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const table = String(req.params['table']);
  const def = TABLES[table];
  if (!def) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '지원하지 않는 테이블' } }); return; }

  const { before } = req.body as { before?: string };
  const at = before ? new Date(before) : null;
  if (!at || Number.isNaN(at.getTime())) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '되돌릴 시각(before) 필요' } }); return; }

  const logs = await prisma.optionDbChangeLog.findMany({
    where: { table_name: table, changed_at: { gte: at } },
    orderBy: { changed_at: 'asc' },
  });
  if (logs.length === 0) { res.json({ data: { ok: true, rows: 0, changed_fields: 0, skipped: [] } }); return; }

  // (행, 필드) 별 **가장 이른** old_value = 기준시각의 값
  const target = new Map<string, Map<string, string | null>>();
  const createdAfter = new Set<string>();   // 기준시각엔 없던 행 — 지우지 않고 그대로 둔다
  for (const l of logs) {
    if (l.action === 'create') createdAfter.add(l.row_key);
    const m = target.get(l.row_key) ?? new Map<string, string | null>();
    if (!m.has(l.field)) m.set(l.field, l.old_value);
    target.set(l.row_key, m);
  }

  const user = `${req.auth?.email ?? 'unknown'} (되돌리기)`;
  let changed = 0, touched = 0;
  const skipped: string[] = [];
  try {
    for (const [rk, fields] of target) {
      if (createdAfter.has(rk)) { skipped.push(rk); continue; }
      const parts = rk.split('|');
      const key: Row = {};
      def.pk.forEach((f, i) => { key[f] = parts[i] ?? ''; });
      const before0 = await def.find(key);
      if (!before0) { skipped.push(rk); continue; }   // 이미 사라진 행

      const data: Row = { ...before0 };
      for (const [f, v] of fields) {
        if (!def.fields.includes(f)) continue;
        // 숫자 칸의 값이 비어 있던 기록은 되돌릴 수 없다(현재 값 유지)
        if (def.numeric.includes(f)) { if (v != null && v !== '') data[f] = Number(v); }
        // 이력은 전부 문자열로 저장된다. 체크박스 칸에 'false' 라는 **문자열**을 그대로
        // 돌려주면 upsert 쪽에서 참으로 읽혀 반대로 켜진다 → 원래 타입으로 되돌린다.
        else if (typeof before0[f] === 'boolean') data[f] = v === 'true';
        else data[f] = v;
      }
      const after = await def.upsert(key, data);
      changed += await writeLog(table, rk, before0, after as Row, def.fields, user, 'rollback');
      touched += 1;
    }
    res.json({ data: { ok: true, rows: touched, changed_fields: changed, skipped } });
  } catch (e) {
    console.error('[POST /option-db/:table/rollback]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '되돌리는 중 오류가 발생했습니다.' } });
  }
});

// ── GET /option-db/:table — 행 목록 (q = 검색, subsidy_local 지역 등) ─────────
optionDbRouter.get('/:table', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const def = TABLES[String(req.params['table'])];
  if (!def) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '지원하지 않는 테이블' } }); return; }
  const q = (req.query['q'] as string | undefined)?.trim() || undefined;
  const rows = await def.list(q);
  res.json({ data: { pk: def.pk, fields: def.fields, numeric: def.numeric, rows } });
});

// ── PUT /option-db/:table — 행 upsert(단건·다건 일괄) + 감사이력 ─────────────
optionDbRouter.put('/:table', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const table = String(req.params['table']);
  const def = TABLES[table];
  if (!def) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '지원하지 않는 테이블' } }); return; }

  const body = req.body as { rows?: Row[] };
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  if (rows.length === 0) { res.status(400).json({ error: { code: 'BAD_INPUT', message: 'rows 배열 필요' } }); return; }

  const user = req.auth?.email ?? 'unknown';
  let changed = 0;
  try {
    for (const raw of rows) {
      const key: Row = {};
      for (const f of def.pk) {
        if (raw[f] == null || raw[f] === '') { res.status(400).json({ error: { code: 'BAD_INPUT', message: `PK(${f}) 누락` } }); return; }
        key[f] = raw[f];
      }
      const data: Row = {};
      for (const f of def.fields) {
        if (!(f in raw)) continue;
        data[f] = def.numeric.includes(f)
          ? (raw[f] === '' || raw[f] == null ? null : Number(raw[f]))
          : raw[f];
      }
      const before = await def.find(key);
      const after = await def.upsert(key, { ...(before ?? {}), ...data });
      changed += await writeLog(table, rowKey(def, key), before, after as Row, def.fields, user, before ? 'update' : 'create');
    }
    res.json({ data: { ok: true, rows: rows.length, changed_fields: changed } });
  } catch (e) {
    console.error('[PUT /option-db/:table]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '옵션DB 저장 중 오류가 발생했습니다.' } });
  }
});
