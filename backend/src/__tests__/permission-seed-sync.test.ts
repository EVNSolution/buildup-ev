import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * **코드가 요구하는 권한은 시드에 반드시 있다.**
 *
 * ⚠️ 두 가지가 실제로 났다.
 *
 *   1. 없는 모듈 이름을 지어 썼다 — `requirePermission('basedata.edit')`. 실제 모듈은
 *      `basedata.manage` 다. 없는 모듈을 요구하면 **아무도 그 기능을 못 쓴다.**
 *      화면은 그럭저럭 그려지고 「권한 없음」만 나오니 원인을 찾기 어렵다.
 *
 *   2. `feature_module.csv` 가 운영보다 8개 모자랐다. 시드는 `deleteMany({})` 로 표를
 *      **통째로 비우고** CSV 대로 다시 만든다 — 그래서 시드를 돌리면 CSV 에 없는 모듈이
 *      권한과 함께 사라진다. 실제로 로컬에서 옵션DB 탭이 통째로 없어졌다.
 *
 * 여기서 지키는 것은 **코드·시드·권한이 서로 어긋나지 않는 것**이다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** 따옴표를 아는 아주 작은 CSV 파서 — surface 값에 쉼표가 들어 있다(`"영업,관리자"`) */
function rows(rel: string): Record<string, string>[] {
  const lines = read(rel).trim().split('\n');
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '', q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map(c => c.trim());
  };
  const head = split(lines[0]!);
  return lines.slice(1).map(l => Object.fromEntries(head.map((h, i) => [h, split(l)[i] ?? ''])));
}

const MODULES = rows('db/seed/feature_module.csv');
const GRANTS = rows('db/seed/access_control.csv');
const moduleCodes = new Set(MODULES.map(m => m['code']));

/** 라우트가 요구하는 권한 모듈 — 소스에서 그대로 긁는다 */
function requiredModules(): { code: string; file: string }[] {
  const dir = path.join(ROOT, 'backend/src/routes');
  const out: { code: string; file: string }[] = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/requirePermission\(\s*'([^']+)'/g)) {
      out.push({ code: m[1]!, file: f });
    }
  }
  return out;
}

describe('권한 모듈 — 코드와 시드가 맞물린다', () => {
  it('시드를 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(MODULES.length).toBeGreaterThan(10);
    expect(GRANTS.length).toBeGreaterThan(10);
    expect(moduleCodes.has('basedata.manage')).toBe(true);
  });

  it('🔴 라우트가 요구하는 모듈은 모두 시드에 있다', () => {
    /*
     * 없는 모듈을 요구하면 그 기능을 **아무도 못 쓴다.**
     * 오타 하나로 화면이 통째로 잠기는데, 화면에는 「권한 없음」만 나온다.
     */
    const missing = requiredModules().filter(r => !moduleCodes.has(r.code));
    expect(
      missing.map(r => `${r.code} (${r.file})`),
      `시드에 없는 모듈을 요구한다:\n  ${missing.map(r => `${r.code} — ${r.file}`).join('\n  ')}`,
    ).toEqual([]);
  });

  it('🔴 권한 부여가 없는 모듈을 가리키지 않는다', () => {
    /*
     * 시드는 `feature_module` 을 통째로 비우고 다시 만든다. CSV 에 없는 모듈을
     * `access_control.csv` 가 가리키면 시드가 외래키에서 멈춘다(실제로 멈췄다).
     */
    const ghosts = GRANTS.map(g => g['module_code']!).filter(c => !moduleCodes.has(c));
    expect([...new Set(ghosts)], '없는 모듈에 권한을 준다').toEqual([]);
  });

  it('🔴 세 역할 모두 기본 권한이 있다', () => {
    // 한 역할이라도 비면 그 역할로 로그인한 사람은 아무것도 못 한다
    for (const role of ['SALES', 'ADMIN', 'MAKER']) {
      const has = GRANTS.filter(g => g['subject_type'] === 'role' && g['subject_ref'] === role);
      expect(has.length, `${role} 역할에 기본 권한이 없다`).toBeGreaterThan(2);
    }
  });

  it('🔴 시드가 모듈을 **지우면서** 다시 만든다는 것을 잊지 않는다', () => {
    /*
     * 이 사실이 위 검사들의 이유다. upsert 로 바뀌면 CSV 가 모자라도 아무 일이 없어지고,
     * 그때는 이 검사들이 지키던 것도 함께 뜻을 잃는다 — 그러면 여기도 같이 고쳐야 한다.
     */
    const seed = read('backend/prisma/seed.ts');
    expect(seed).toMatch(/featureModule\.deleteMany\(\{\}\)/);
    expect(seed).toMatch(/accessControl\.deleteMany\(\{\}\)/);
  });
});
