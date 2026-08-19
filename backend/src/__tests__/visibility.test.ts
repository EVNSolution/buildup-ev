import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { VISIBLE, visibleUnless, wantsHidden } from '../lib/visibility.js';

/**
 * 숨김 필터를 **빠뜨리지 않았는가.**
 *
 * soft hide 가 실패하는 방식은 늘 같다 — 조회 한 곳에서 `hidden_at` 조건을 잊는 것.
 * 그러면 숨긴 견적이 거기서만 다시 보이거나, 영업 성과에만 계속 잡힌다.
 * 계산은 멀쩡한데 조건이 빠져서 나는 버그라, 사람 눈으로는 잘 안 걸린다(#182 와 같은 종류).
 *
 * 그래서 **견적·고객을 조회하는 파일은 반드시 visibility 를 거치게** 못박는다.
 */
const SRC = path.resolve(__dirname, '..');

/** 조회 조건을 스스로 쓰지 않고 헬퍼를 거쳐야 하는 파일들(라우트·서비스). */
const SCANNED = ['routes', 'services'];

/** 숨김과 무관한 곳 — 이유를 적어 둔다. 여기 추가할 땐 근거가 있어야 한다. */
const EXEMPT: Record<string, string> = {
  // 견적 하나를 id 로 직접 여는 경로들은 목록이 아니다. 숨긴 견적도 링크로는 열려야
  // 「왜 안 보이지」를 확인하고 되돌릴 수 있다.
  'routes/contracts.ts': '계약은 견적 id 로 직접 연다(목록 아님)',
  'routes/tuning.ts': '튜닝은 주문 id 로 직접 연다(목록 아님)',
  'routes/steps.ts': '단계는 주문 id 로 직접 연다(목록 아님)',
  'routes/docs.ts': '서류는 주문 id 로 직접 연다(목록 아님)',
  // 계정 삭제 전 FK 참조 검사 — **숨긴 행도 세어야 한다.**
  // 숨겨도 행은 남아 FK 를 잡고 있다. 빼면 삭제가 진행되다 DB 제약(P2003)에 걸린다.
  'routes/users.ts': '계정 삭제 전 FK 참조 검사 — 숨긴 행도 참조는 참조다',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(p);
  }
  return out;
}

describe('숨김 필터', () => {
  it('VISIBLE 은 hidden_at 이 null 인 행만 고른다', () => {
    expect(VISIBLE).toEqual({ hidden_at: null });
  });

  it('숨김 포함이면 조건을 걸지 않는다', () => {
    expect(visibleUnless(false)).toEqual({ hidden_at: null });
    expect(visibleUnless(true)).toEqual({});
  });

  it("include_hidden 은 정확히 'true' 일 때만 참 — 아무 값이나 통과시키지 않는다", () => {
    expect(wantsHidden('true')).toBe(true);
    for (const v of ['false', '1', 'yes', '', undefined, null, true]) {
      expect(wantsHidden(v), `${String(v)} 가 통과했다`).toBe(false);
    }
  });

  /**
   * ⚠️ **이 테스트가 이 파일의 핵심이다.**
   * 견적·고객을 **여러 건** 조회하면서 visibility 를 안 거치는 파일이 있으면 걸린다.
   */
  it('견적·고객을 목록으로 조회하는 곳은 전부 visibility 를 거친다', () => {
    const offenders: string[] = [];
    for (const sub of SCANNED) {
      for (const file of walk(path.join(SRC, sub))) {
        const rel = path.relative(SRC, file).split(path.sep).join('/');
        if (EXEMPT[rel]) continue;
        const src = readFileSync(file, 'utf-8');
        const listsRows = /prisma!?\.(quote|customer)\.(findMany|count)\(/.test(src);
        if (!listsRows) continue;
        if (!src.includes("from '../lib/visibility.js'")) offenders.push(rel);
      }
    }
    expect(offenders,
      `견적·고객을 목록 조회하면서 숨김 필터를 안 쓰는 파일: ${offenders.join(', ')}`,
    ).toEqual([]);
  });
});
