import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * **영업이 닿는 `:id` 경로에는 담당 검사가 있어야 한다** — 하나도 빠짐없이.
 *
 * 이번 구멍이 그렇게 생겼다. 견적 목록과 견적서 PDF 에는 검사가 있었는데, 나중에 늘어난
 * 경로들(견적 상세 · 계약 발송/취소/조회/서명본 · 계약서 생성)에는 아무도 넣지 않았다.
 * 하나씩 눈으로 챙기는 방식은 **경로가 늘어나는 속도를 못 따라간다.**
 *
 * 그래서 규칙을 사람이 아니라 여기서 지킨다: 영업이 닿을 수 있는 `:id`/`:key` 경로는
 * 담당을 확인하는 흔적이 있어야 한다. 새로 추가하면 이 검사가 먼저 걸린다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const DIR = path.join(ROOT, 'backend/src/routes');

/**
 * 담당을 확인하는 방법들 — 이름이 달라도 하는 일은 같다.
 *
 * ⚠️ **부분 문자열로 보지 않는다.** 처음에 `loadOrder` 를 넣었더니 `loadOrderScoped` 에도
 *    걸렸는데, 그건 **특장사 조직만** 보고 영업은 그냥 통과시킨다 —
 *    실제로 그래서 계약서 생성 경로의 구멍을 이 검사가 놓쳤다.
 *    이름이 비슷하다고 하는 일이 같지 않다.
 */
const OWNERSHIP = [
  'assertQuoteOwner', 'assertOrderQuoteOwner',   // 공용 문
  'ownQuotesOnly', 'scopedToMine', 'quoteScope', // 직접 판정
  'sales_user_id !==',                           // 직접 비교
  /*
   * 주문 단계 라우트의 공용 적재 — 영업(담당 견적)과 특장사(배정 조직) **둘 다** 본다.
   * 이름이 비슷한 `loadOrderScoped`(서류 라우트)는 특장사 조직만 보므로 여기 없다.
   * 낱말 경계로 맞추기 때문에 둘이 섞이지 않는다.
   */
  'loadOrder',
];

/** 낱말로 맞는지 본다 — `loadOrder` 가 `loadOrderScoped` 에 걸리지 않게 */
function hasOwnership(body: string): boolean {
  return OWNERSHIP.some(k => new RegExp(`(?<![A-Za-z0-9_])${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`).test(body));
}

/**
 * 이 검사에서 빼는 곳과 그 이유 — 빼려면 이유를 여기 적어야 한다.
 *
 * ⚠️ 「405 로 꺼 둔 기능」과 「공용 핸들러 안에서 검사하는 경로」는 여기 적지 않는다 —
 *    아래에서 **자동으로 알아본다.** 손으로 적는 목록이 길어지면 그 목록이 곧 구멍이 된다.
 */
const EXEMPT: Record<string, string> = {
  'external.ts': '라우터 전체가 x-api-key 상수시간 검증을 지난다(서버 간 API)',
};

interface Route { file: string; method: string; path: string; roles: string; body: string }

/**
 * 이 라우트가 **실제로 실행하는 코드**를 모은다.
 *
 * 라우트가 핸들러를 그 자리에 적지 않고 이름으로 넘기는 경우가 있다
 * (`docsRouter.post('/:id/docs/contract', rbac(...), contractHandler)`).
 * 그때 라우트 줄만 보면 검사가 없어 보이지만, 검사는 그 핸들러 안에 있다.
 * 이름으로 넘긴 핸들러의 본문까지 붙여서 본다 — 안 그러면 멀쩡한 코드를 구멍으로 신고한다.
 */
function effectiveBody(src: string, body: string): string {
  let out = body;
  for (const id of new Set([...body.matchAll(/,\s*(\w+)\s*\)\s*;/g)].map(m => m[1]!))) {
    const decl = new RegExp(`(?:const|function)\\s+${id}\\s*[=(][\\s\\S]*?\\n\\}`, 'm').exec(src);
    if (decl) out += '\n' + decl[0];
  }
  return out;
}

function routes(): Route[] {
  const out: Route[] = [];
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(path.join(DIR, file), 'utf8');
    const re = /(\w+Router)\.(get|post|put|patch|delete)\(\s*'([^']*)'([^\n]*)/g;
    const ms = [...src.matchAll(re)];
    ms.forEach((m, i) => {
      const end = i + 1 < ms.length ? ms[i + 1]!.index! : src.length;
      const head = m[4] ?? '';
      const roles = /rbac\(([^)]*)\)/.exec(head)?.[1]?.replace(/['\s]/g, '') ?? '';
      const raw = src.slice(m.index!, end);
      out.push({ file, method: m[2]!.toUpperCase(), path: m[3]!, roles, body: effectiveBody(src, raw) });
    });
  }
  return out;
}

describe('담당 검사 빠짐 없기', () => {
  const all = routes();

  it('라우트를 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(all.length).toBeGreaterThan(80);
  });

  it('🔴 영업이 닿는 :id 경로에 담당 검사가 있다', () => {
    const missing = all.filter(r => {
      if (!r.path.includes(':id') && !r.path.includes(':key')) return false;
      if (!r.roles.includes('SALES')) return false;              // 영업이 못 닿으면 다른 규칙이 본다
      if (EXEMPT[r.file] || EXEMPT[`${r.file} ${r.method} ${r.path}`]) return false;
      // 405 로 꺼 둔 기능은 들어갈 몸통이 없다 — 검사할 것도 없다
      if (/res\.status\(405\)/.test(r.body)) return false;
      return !hasOwnership(r.body);
    }).map(r => `${r.method} ${r.path}  (${r.file})`);

    expect(missing, `담당 검사가 없는 경로:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('🔴 공용 문이 규칙을 한 곳에서 정한다', () => {
    // 경로마다 제각기 판정하면 또 갈린다 — 실제로 그래서 갈렸다
    const helper = readFileSync(path.join(ROOT, 'backend/src/lib/quote-access.ts'), 'utf8');
    expect(helper).toContain('ownQuotesOnly');
    // 관리자는 막지 않는다 — 「내 고객만」은 영업 화면에서만 해당한다
    expect(helper).toMatch(/관리자 권한이 있으면/);
  });
});
