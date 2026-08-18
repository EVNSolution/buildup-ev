/**
 * schema.prisma 와 **실제 DB** 를 대조한다. 어긋나면 종료코드 1.
 *
 * 왜 필요한가 — 2026-08-18 운영 장애.
 * WARP 연동에서 `customer` 에 컬럼 두 개(warp_customer_id·updated_at)가 늘었는데
 * 스키마 파일에만 들어가고 **운영 DB 에는 반영되지 않았다.** Prisma 는 모델의 모든 컬럼을
 * SELECT 하므로, 고객을 읽는 기능이 전부 `P2022`(컬럼 없음)로 죽었다 —
 * 견적서·계약서·메일 발송까지. 그런데 배포 헬스체크는 `/api/v1/auth/me` 라
 * 고객 테이블을 건드리지 않아 **배포는 매번 초록불이었고 며칠간 아무도 몰랐다.**
 *
 * 그래서 배포가 새 슬롯에 트래픽을 주기 **전에** 이걸 돌린다.
 * 어긋난 채로 나가느니 배포가 멈추는 편이 낫다 — 옛 슬롯이 계속 서비스한다.
 *
 * 실행: npm run --workspace=backend db:drift   (DATABASE_URL 필요)
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.resolve(HERE, '../../prisma/schema.prisma');

/** Prisma 스칼라 타입 — 이것 말고 대문자로 시작하면 관계(FK 필드는 따로 선언돼 있다)다. */
const SCALARS = new Set([
  'String', 'Int', 'Boolean', 'DateTime', 'Float', 'Decimal', 'Json', 'BigInt', 'Bytes',
]);

interface Expected { table: string; columns: Set<string> }

/**
 * schema.prisma → { 테이블: 컬럼들 }.
 *
 * ⚠️ enum 은 건너뛴다(테이블이 아니다). 관계 필드와 배열도 컬럼이 아니다.
 *    필드 단위 `@map` 은 현재 이 스키마에 없지만, 생기면 여기서 이름을 바꿔 줘야 한다.
 */
async function parseSchema(): Promise<Expected[]> {
  const src = await readFile(SCHEMA, 'utf-8');
  const out: Expected[] = [];

  for (const m of src.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, name, body] = m;
    const mapped = /@@map\("([^"]+)"\)/.exec(body ?? '');
    const table = mapped?.[1] ?? (name ?? '').toLowerCase();
    const columns = new Set<string>();

    for (const raw of (body ?? '').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue;
      const f = /^(\w+)\s+([\w[\]?]+)/.exec(line);
      if (!f) continue;
      const [, col, type] = f;
      if (!col || !type) continue;
      if (type.endsWith('[]')) continue;                       // 관계 배열
      const base = type.replace(/[?[\]]/g, '');
      // 스칼라가 아니고 대문자로 시작하면 관계 or enum. enum 은 컬럼이 맞지만
      // 이름만으로는 구분되지 않아, 아래에서 DB 에 있으면 통과시킨다(누락만 잡는 게 목적).
      if (!SCALARS.has(base) && /^[A-Z]/.test(base)) {
        const isEnum = new RegExp(`^enum\\s+${base}\\s*\\{`, 'm').test(src);
        if (!isEnum) continue;
      }
      // 필드 단위 @map 대응(지금은 없지만 생기면 그대로 동작한다)
      const renamed = /@map\("([^"]+)"\)/.exec(line);
      columns.add(renamed?.[1] ?? col);
    }
    if (columns.size) out.push({ table, columns });
  }
  return out;
}

async function main(): Promise<void> {
  const expected = await parseSchema();
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      select table_name, column_name from information_schema.columns where table_schema = 'public'
    `;
    const actual = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
      actual.get(r.table_name)!.add(r.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: string[] = [];
    for (const e of expected) {
      const got = actual.get(e.table);
      if (!got) { missingTables.push(e.table); continue; }
      for (const c of e.columns) if (!got.has(c)) missingColumns.push(`${e.table}.${c}`);
    }

    const cols = expected.reduce((n, e) => n + e.columns.size, 0);
    if (!missingTables.length && !missingColumns.length) {
      console.info(`[schema-drift] 일치 — 테이블 ${expected.length}개 · 컬럼 ${cols}개`);
      return;
    }

    console.error('[schema-drift] ❌ schema.prisma 와 DB 가 어긋납니다.');
    console.error('  Prisma 는 모델의 모든 컬럼을 SELECT 하므로, 아래가 빠져 있으면');
    console.error('  그 테이블을 읽는 기능이 전부 P2022 로 죽습니다.');
    if (missingTables.length) console.error(`\n  없는 테이블: ${missingTables.join(', ')}`);
    if (missingColumns.length) console.error(`\n  없는 컬럼:\n${missingColumns.map(c => `    - ${c}`).join('\n')}`);
    console.error('\n  DB 에 반영한 뒤 다시 배포하세요(참조 테이블만 건드리는 격리 SQL 권장).');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

await main();
