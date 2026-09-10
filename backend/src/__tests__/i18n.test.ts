import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * **영문화가 조용히 망가지는 세 가지 길**을 막는다.
 *
 *  1. 데이터 값을 번역해 계산이 틀리는 것 — 화면은 멀쩡해 보이고 오류도 안 난다.
 *  2. t() 를 값 비교에 쓰는 것 — 한국어일 땐 통과하고 영어일 때만 거짓이 된다.
 *  3. 자리가 좁다고 그 버튼만 글자를 줄이는 것 — 같은 역할인데 크기가 달라진다.
 *
 * 셋 다 눈으로는 안 잡힌다(1·2 는 한국어로 쓰면 멀쩡하고, 3 은 그럴듯해 보인다).
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'frontend/src');
const EN_TS = readFileSync(path.join(SRC, 'i18n/en.ts'), 'utf8');

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...srcFiles(p));
    else if (e.endsWith('.ts') || e.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const files = srcFiles(SRC)
  .filter(p => !p.includes(`${path.sep}i18n${path.sep}`))
  .map(p => [path.relative(SRC, p), readFileSync(p, 'utf8')] as const);

function block(name: string): string {
  const i = EN_TS.indexOf(`export const ${name}`);
  expect(i, `${name} 이 사라졌다`).toBeGreaterThan(-1);
  const j = EN_TS.indexOf('\n}', i);
  return EN_TS.slice(i, j);
}
const keysOf = (b: string) => [...b.matchAll(/^ {2}'((?:[^'\\]|\\.)*)'/gm)].map(m => m[1]!);

describe('영문화', () => {
  it('사전을 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(keysOf(block('EN:')).length).toBeGreaterThan(700);
    expect(files.length).toBeGreaterThan(60);
  });

  it('🔴 값으로 비교되는 자리는 한국어 원문 그대로다', () => {
    /*
     * **구조는 한국어, 화면만 영어**가 이 영문화의 규칙이다. 그러니 이 다섯도
     * 사전에 번역이 있어야 한다(화면에 「없음」이 아니라 None 이 떠야 하니까).
     *
     * 위험한 것은 표시가 아니라 **비교**다. 아래 자리들이 t() 를 타는 순간
     * 영어일 때만 거짓이 되어, 서울 취득세 감면이나 토글형 옵션이 조용히 틀어진다.
     * 오류도 안 나고 한국어로 쓰면 멀쩡하다.
     */
    const must: [string, string][] = [
      ['components/OptionDbTab.tsx', "=== '원'"],
      ['components/OptionToggle.tsx', "=== '없음'"],
      ['components/OptionToggle.tsx', "=== '추가없음'"],
      ['lib/liveQuote.ts', "=== '일반인'"],
      ['lib/liveQuote.ts', "=== '서울특별시'"],
    ];
    for (const [rel, cmp] of must) {
      const src = readFileSync(path.join(SRC, rel), 'utf8');
      expect(src, `${rel} 의 ${cmp} 비교가 사라졌다 — t() 로 바뀌지 않았는지 보라`).toContain(cmp);
    }
    // 화면 쪽은 반대로 **번역이 있어야** 한다
    const en = block('EN:');
    for (const data of ['원', '없음', '서울특별시', '일반인']) {
      expect(en, `'${data}' 의 화면 번역이 없다`).toMatch(new RegExp(`^ {2}'${data}':`, 'm'));
    }
  });

  it('🔴 t() 를 값 비교에 쓰지 않는다', () => {
    // 영어로 켰을 때만 거짓이 되는 종류의 버그다 — 한국어로 테스트하면 안 잡힌다
    const bad: string[] = [];
    for (const [rel, src] of files) {
      // `get(`·`sort(` 처럼 t 로 끝나는 다른 함수까지 잡히면 안 된다 — 앞에 낱말 글자가 없어야 t() 다
      const CALL = String.raw`(?<![\w$.])t[cf]?\(`;
      const RE = new RegExp(`(?:===|!==|\\.includes\\(|\\bcase\\s)\\s*${CALL}|${CALL}[^)]*\\)\\s*(?:===|!==)`, 'g');
      for (const m of src.matchAll(RE)) {
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}  ${m[0]}`);
      }
    }
    expect(bad, `t() 로 값을 비교한 자리:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 번역문을 저장하지 않는다 — 화면만 영어, 저장은 한국어', () => {
    /*
     * 같은 발주서를 특장사는 한국어로, 해외 담당자는 영어로 본다. **내용은 하나**다.
     * 그러려면 DB 에는 늘 한국어가 들어가고 바뀌는 것은 그리는 순간뿐이어야 한다.
     *
     * `save({ memo: t('메모') })` 처럼 번역 결과가 서버로 나가면, 영어로 켜 둔 사람이
     * 저장하는 순간 그 값이 영어로 굳어 한국어 화면에서도 영어로 보인다 — 되돌릴 수 없다.
     */
    const bad: string[] = [];
    for (const [rel, src] of files) {
      // api 호출·상태 저장에 t() 결과를 실어 보내는 꼴
      for (const m of src.matchAll(/(?:body|payload|data)\s*[:=]\s*\{[^}]*\bt[cf]?\(/g)) {
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}`);
      }
      for (const m of src.matchAll(/\b(?:save|create|update|patch|post|put)\w*\([^)]*\bt[cf]?\('/gi)) {
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}`);
      }
    }
    expect(bad, `번역문이 서버로 나간다:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 `t` 라는 이름을 다른 데 쓰지 않는다', () => {
    /*
     * 파일 위에서 `import { t }` 를 해 놓고 함수 안에 `const t = setTimeout(...)` 이 있으면,
     * **그 블록에서만** 번역이 조용히 사라진다. 오류도 안 나고 한국어로 쓰면 멀쩡하다.
     * 실제로 6곳에 있었다(타이머 핸들·파싱한 날짜·견적 입력값 접근자).
     */
    const bad: string[] = [];
    for (const [rel, src] of files) {
      for (const m of src.matchAll(/\b(?:const|let|var|function)\s+t\s*[=(]/g)) {
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}`);
      }
    }
    expect(bad, `t 를 번역 아닌 것에 쓴 자리:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 서식 문자열의 자리표시자가 한글·영어에서 같다', () => {
    /*
     * `'{0} 의 견적 {1}건'` 이 영어로 `'{1} quote(s)'` 가 되면 값 하나가 사라진다.
     * 번호가 어긋나면 엉뚱한 값이 박히고, 개수가 다르면 `{1}` 이 날글자로 화면에 뜬다.
     */
    const b = block('EN_FMT');
    const bad: string[] = [];
    for (const m of b.matchAll(/^ {2}'((?:[^'\\]|\\.)*)': '((?:[^'\\]|\\.)*)',$/gm)) {
      const set = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map(x => x[1]!).sort().join(',');
      if (set(m[1]!) !== set(m[2]!)) bad.push(`${m[1]}  →  ${m[2]}`);
    }
    expect(bad, `자리표시자가 어긋난 문장:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 조각난 문장은 아직 t() 로 감싸지 않았다', () => {
    /*
     * 토막 난 문장은 낱말로 옮기면 영어가 무너진다(동사가 강조 앞으로 가야 하는 등).
     * JSX 를 다시 짜기 전에 t() 로 덮으면 「영어처럼 보이는 비문」이 배포된다.
     *
     * 33개로 시작했고 **전부 다시 짰다** — 문장을 통째로 사전에 넣고, 값이 끼는 자리는
     * tf() 로 뺐다. 대가는 문장 가운데 있던 굵은 글씨 몇 개다(말이 되는 영어와 맞바꿨다).
     */
    const frags = keysOf(block('NEEDS_RESTRUCTURE')).map(s => s.replace(/\\'/g, "'"));
    // 33개로 시작해 **전부 다시 짰다.** 목록이 비는 것이 끝난 상태다.
    // 새 조각이 생기면(강조를 문장 가운데 끼우면) 여기 적고, 다시 짜기 전에는 t() 로 덮지 않는다.
    const wrapped: string[] = [];
    for (const [rel, src] of files) {
      for (const f of frags) {
        if (src.includes(`t('${f.replace(/'/g, "\\'")}')`)) wrapped.push(`${rel}: ${f.slice(0, 30)}`);
      }
    }
    expect(wrapped, `다시 짜기 전에 t() 로 감싼 조각:\n  ${wrapped.join('\n  ')}`).toEqual([]);
  });

  /*
   * ── 사전에 없는 문구 ──────────────────────────────────────────────────
   *
   * `t()` 는 사전에 없으면 **한국어를 그대로 돌려준다.** 화면이 깨지지 않으니
   * 눈으로는 절대 못 잡는다 — 영어로 보는 사람에게만 한국어가 나간다.
   * 이 검사를 붙이던 날 이미 **19개**가 그렇게 나가고 있었다
   * (MyPage 「계정」·「언어」, Header 「일반」, SalesPage 「지연」, 대화 탭 증빙 버튼 …).
   *
   * 그래서 「배포 전에 잘 보자」로 두지 않고 여기서 막는다(지시: 2026-09-10).
   *
   * ⚠️ `tf()` 는 **EN_FMT 만** 본다. 틀을 EN 쪽에 적어 두면 번역이 사전에 있는데도
   *    한국어가 나간다 — 실제로 「숨긴 고객 {0}명」이 그렇게 있었다.
   */
  const CALLS = [
    { fn: 't', re: /\bt\('((?:[^'\\]|\\.)*)'\)/g, dict: () => keysOf(block('EN:')) },
    // tc('원문','맥락') — 맥락 키가 없으면 보통 번역으로 떨어지므로 원문만 있으면 된다
    { fn: 'tc', re: /\btc\('((?:[^'\\]|\\.)*)'\s*,/g, dict: () => keysOf(block('EN:')) },
    { fn: 'tf', re: /\btf\('((?:[^'\\]|\\.)*)'\s*[,)]/g, dict: () => keysOf(block('EN_FMT')) },
  ] as const;

  it('🔴 화면에 내보내는 한국어는 전부 사전에 있다', () => {
    const bad: string[] = [];
    for (const { fn, re, dict } of CALLS) {
      const have = new Set(dict().map(k => k.replace(/\\'/g, "'")));
      for (const [rel, src] of files) {
        for (const m of src.matchAll(re)) {
          const ko = m[1]!.replace(/\\'/g, "'");
          if (!/[가-힣]/.test(ko)) continue;          // 영문 라벨은 옮길 것이 없다
          if (have.has(ko)) continue;
          bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}  ${fn}('${ko}')`);
        }
      }
    }
    expect(bad, `사전에 없어 **영어 화면에 한국어로 나가는** 문구:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('사전에 없는 문구를 실제로 잡아낸다', () => {
    // 정규식이 안 맞아 **아무것도 못 보고 초록**이 되는 것을 막는다
    const hit = [...`t('사전에없는문구입니다')`.matchAll(CALLS[0]!.re)].map(m => m[1]);
    expect(hit, '정규식이 t() 호출을 못 읽는다').toEqual(['사전에없는문구입니다']);
    expect(keysOf(block('EN:'))).not.toContain('사전에없는문구입니다');
  });

  it('🔴 자리표시자는 {0}·{1} 뿐이다 — {-1} 은 영영 채워지지 않는다', () => {
    /*
     * tf() 가 채우는 규칙은 `/\{(\d+)\}/` 다. `{-1}` 은 숫자로 안 읽혀 **그대로 남고**,
     * 키로도 영영 안 맞아 죽은 항목이 된다. 실제로 88개가 그렇게 쌓여 있었다.
     */
    const odd = [...EN_TS.matchAll(/^ {2}'((?:[^'\\]|\\.)*)':/gm)]
      .map(m => m[1]!)
      .filter(k => /\{-\d+\}/.test(k));
    expect(odd, `자리표시자가 {-1} 인 사전 항목:\n  ${odd.slice(0, 10).join('\n  ')}`).toEqual([]);
  });

  it('🔴 같은 역할의 버튼은 같은 크기를 쓴다', () => {
    /*
     * 영어가 길어 자리에 안 들어갈 때 **그 버튼만** 글자를 줄이고 싶어진다.
     * 그러면 나란히 선 같은 역할의 버튼들이 서로 다른 크기가 되어 화면이 어수선해진다.
     * 자리가 모자라면 고칠 것은 글자 크기가 아니라 **그릇**(줄바꿈·가로 스크롤)이거나
     * **문구 자체**(짧은 영어 라벨)다.
     *
     * 공용 버튼 스타일은 본문(--fs-body)과 표 안 작은 버튼(--fs-caption) 두 가지뿐이어야 한다.
     */
    const btn = readFileSync(path.join(SRC, 'styles/buttons.ts'), 'utf8');
    const sizes = [...btn.matchAll(/fontSize:\s*([^,\n]+)/g)].map(m => m[1]!.trim());
    expect(sizes.length).toBeGreaterThan(0);
    const allowed = new Set(["'var(--fs-body)'", "'var(--fs-caption)'"]);
    const odd = sizes.filter(s => !allowed.has(s));
    expect(odd, `공용 버튼에 새 글자 크기가 생겼다: ${odd.join(', ')}`).toEqual([]);
  });
});
