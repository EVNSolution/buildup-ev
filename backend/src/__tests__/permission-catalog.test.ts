import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { MODULES, MODULE_BY_CODE, LIVE_MODULES, isRetired } from '@buildup-ev/shared/rbac/modules';
import { PRESETS } from '@buildup-ev/shared/rbac/presets';

/**
 * **기능모듈 카탈로그가 한 벌인가.**
 *
 * 2026-09-16 전수조사에서 나온 것들을 여기서 못 박는다.
 *   · 아무 데서도 검사하지 않는 모듈이 목록에 남아 켜고 끌 수 있었다(견적 삭제·앱 알림·배정 알림 메일)
 *   · 같은 뜻의 모듈이 둘이었다(옛 우산 `basedata.manage` 와 새로 쪼갠 다섯)
 *   · 정렬 번호가 셋씩 겹쳐 목록 순서가 뜰 때마다 달라졌다
 *   · 이름·설명이 코드·시드·화면 세 곳에 흩어져 서로 어긋났다
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

/** 따옴표를 아는 아주 작은 CSV 파서 — surface 값에 쉼표가 들어 있다 */
function rows(rel: string): Record<string, string>[] {
  const lines = read(rel).trim().split('\n');
  const split = (line: string): string[] => {
    const out: string[] = []; let cur = '', q = false;
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

const SEED = rows('db/seed/feature_module.csv');
const GRANTS = rows('db/seed/access_control.csv');

/** 서버가 실제로 요구하는 모듈 — 라우트·서비스·미들웨어에서 그대로 긁는다 */
function enforced(): Set<string> {
  const out = new Set<string>();
  for (const sub of ['routes', 'services', 'lib']) {
    const dir = path.join(ROOT, 'backend/src', sub);
    for (const f of readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const src = readFileSync(path.join(dir, f), 'utf8');
      for (const m of src.matchAll(/(?:requirePermission|hasPermission)\(\s*(?:req,\s*)?'([a-z0-9._]+)'/g)) out.add(m[1]!);
      // 표 이름으로 고르는 자리(option-db) — 값으로 적힌 코드도 센다
      for (const m of src.matchAll(/'(basedata\.[a-z]+)'/g)) out.add(m[1]!);
    }
  }
  return out;
}

describe('기능모듈 카탈로그', () => {
  it('카탈로그를 실제로 읽었다', () => {
    expect(MODULES.length).toBeGreaterThan(20);
    expect(LIVE_MODULES.length).toBeGreaterThan(20);
    expect(SEED.length).toBe(MODULES.length);
  });

  it('🔴 코드가 겹치지 않는다', () => {
    const dup = MODULES.map(m => m.code).filter((c, i, a) => a.indexOf(c) !== i);
    expect(dup, '같은 코드가 두 번 적혔다').toEqual([]);
  });

  it('🔴 이름과 설명이 비어 있지 않고, 설명이 이름을 되풀이하지 않는다', () => {
    const bad = LIVE_MODULES.filter(m => !m.name.trim() || !m.desc.trim() || m.desc.trim() === m.name.trim());
    expect(bad.map(m => m.code), '이름만 되풀이하는 설명은 설명이 아니다').toEqual([]);
  });

  it('🔴 시드는 카탈로그를 그대로 비춘다 — 이름·화면·순서·활성', () => {
    const mismatch: string[] = [];
    MODULES.forEach((m, i) => {
      const row = SEED.find(r => r['code'] === m.code);
      if (!row) { mismatch.push(`${m.code}: 시드에 없다`); return; }
      if (row['name'] !== m.name) mismatch.push(`${m.code}: 이름 ${row['name']} ≠ ${m.name}`);
      if (row['surface'] !== m.surfaces.join(',')) mismatch.push(`${m.code}: 화면 ${row['surface']} ≠ ${m.surfaces.join(',')}`);
      if (Number(row['sort_order']) !== i + 1) mismatch.push(`${m.code}: 순서 ${row['sort_order']} ≠ ${i + 1}`);
      const active = m.retired ? 'N' : 'Y';
      if (row['active'] !== active) mismatch.push(`${m.code}: 활성 ${row['active']} ≠ ${active}`);
    });
    expect(mismatch, `카탈로그와 시드가 어긋났다:\n  ${mismatch.join('\n  ')}`).toEqual([]);
  });

  it('🔴 정렬 번호가 겹치지 않는다 — 겹치면 목록 순서가 뜰 때마다 달라진다', () => {
    const seen = new Set<string>();
    const dup = SEED.map(r => r['sort_order']!).filter(o => seen.has(o) || (seen.add(o), false));
    expect(dup, '같은 번호를 쓰는 모듈이 있다').toEqual([]);
  });

  it('🔴 살아 있는 모듈은 **어디선가 실제로 검사한다** — 켜도 아무 일 없는 토글을 두지 않는다', () => {
    const server = enforced();
    const ui = new Set<string>();
    const page = read('frontend/src/pages/AdminPage.tsx') + read('frontend/src/components/PermGate.tsx');
    for (const dir of ['frontend/src/components', 'frontend/src/pages']) {
      for (const f of readdirSync(path.join(ROOT, dir))) {
        if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
        for (const m of readFileSync(path.join(ROOT, dir, f), 'utf8').matchAll(/usePermission\(\s*'([a-z0-9._]+)'/g)) ui.add(m[1]!);
      }
    }
    for (const m of page.matchAll(/usePermission\(\s*'([a-z0-9._]+)'/g)) ui.add(m[1]!);
    const dead = LIVE_MODULES.filter(m => !server.has(m.code) && !ui.has(m.code));
    expect(
      dead.map(m => `${m.code}(${m.name})`),
      `아무 데서도 검사하지 않는 모듈 — 물러나게 하거나(retired) 검사를 붙여라:\n  ${dead.map(m => m.code).join('\n  ')}`,
    ).toEqual([]);
  });

  it('🔴 물러난 모듈은 프리셋·권한 시드에 없다 — 새로 켜지지 않는다', () => {
    const inPreset = PRESETS.flatMap(p => p.modules).filter(isRetired);
    expect([...new Set(inPreset)], '물러난 모듈이 자리 기본값에 남아 있다').toEqual([]);
    const inGrants = GRANTS.map(g => g['module_code']!).filter(isRetired);
    expect([...new Set(inGrants)], '물러난 모듈에 권한을 준다').toEqual([]);
  });

  it('🔴 프리셋이 없는 모듈을 가리키지 않는다', () => {
    const ghosts = PRESETS.flatMap(p => p.modules).filter(c => !MODULE_BY_CODE[c]);
    expect([...new Set(ghosts)], '카탈로그에 없는 모듈을 자리에 넣었다').toEqual([]);
  });

  it('🔴 이름·설명·묶음이 모두 영문 사전에 있다', () => {
    /*
     * 화면은 `t(mod.name)` 처럼 **값으로** 부른다 — i18n 검사의 정규식은 리터럴만 보므로
     * 여기 문구는 그쪽에서 안 걸린다. 빠지면 영어로 켠 사람에게 한국어가 그대로 나간다.
     */
    const en = read('frontend/src/i18n/en.ts');
    const has = (k: string) => en.includes(`\n  '${k.replace(/'/g, "\\'")}':`);
    const missing: string[] = [];
    for (const m of MODULES) {
      for (const k of [m.name, m.desc, m.group]) if (!has(k)) missing.push(`${m.code}: ${k}`);
    }
    expect(missing, `영문 사전에 없는 기능모듈 문구:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('🔴 목록은 물러난 모듈을 내보내지 않는다', () => {
    const route = read('backend/src/routes/feature-modules.ts');
    expect(route, 'retired 를 거르지 않는다').toMatch(/!m\.retired/);
    expect(LIVE_MODULES.some(m => isRetired(m.code))).toBe(false);
  });
});
