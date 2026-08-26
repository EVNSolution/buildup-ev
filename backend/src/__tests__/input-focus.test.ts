import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * **입력칸에서 한 글자 칠 때마다 커서가 풀리지 않아야 한다.**
 *
 * React 는 컴포넌트 «타입»이 바뀌면 그 자리를 통째로 헐고 다시 짓는다.
 * 렌더 함수 안에서 컴포넌트를 만들면 렌더마다 새 함수 = 새 타입이 되어,
 * 안에 있던 `<input>` 이 사라졌다 새로 생긴다 — **한 글자마다 포커스가 날아간다.**
 *
 * 실제로 견적서 생성 팝업에서 났다. 원인은 이런 한 줄이었다:
 *
 *     Field={({ label, children }) => (...)}      // 렌더마다 새 컴포넌트
 *
 * 눈으로는 잡기 어렵다(타입 오류도 아니고 콘솔 경고도 없다). 그래서 훑는다.
 */
const SRC = path.resolve(__dirname, '../../../frontend/src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const FILES = tsxFiles(SRC);
const rel = (p: string) => path.relative(SRC, p);

describe('입력칸 포커스', () => {
  it('🔴 컴포넌트를 prop 으로 넘길 때 그 자리에서 만들지 않는다', () => {
    /*
     * `Foo={({ a, b }) => (...)}` 처럼 대문자 prop 에 인라인 컴포넌트를 넘기면,
     * 받는 쪽이 `<Foo>` 로 그리는 순간 렌더마다 다시 만들어진다.
     */
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        const m = /(\w+)=\{\(\s*\{[^}]*\}\s*\)\s*=>\s*\(/.exec(line);
        if (m && /^[A-Z]/.test(m[1]!)) bad.push(`${rel(f)}:${i + 1} — ${m[1]}`);
      }
    }
    expect(bad, `렌더 안에서 만들어지는 컴포넌트:\n${bad.join('\n')}`).toEqual([]);
  });

  it('🔴 컴포넌트를 다른 컴포넌트 **안에서** 선언하고 JSX 로 쓰지 않는다', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        // 들여쓰기된(=함수 안) 대문자 선언
        const m = /^(\s+)(?:const ([A-Z]\w*)\s*[:=]|function ([A-Z]\w*)\s*\()/.exec(line);
        if (!m?.[1]) continue;
        const name = m[2] ?? m[3]!;
        if (new RegExp(`<${name}[\\s/>]`).test(src)) bad.push(`${rel(f)}:${i + 1} — ${name}`);
      }
    }
    expect(bad, `함수 안에서 선언한 컴포넌트:\n${bad.join('\n')}`).toEqual([]);
  });

  it('입력칸에 값 기반 key 를 주지 않는다 — 값이 바뀔 때마다 새로 만들어진다', () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (/<(input|textarea)\b/.test(line) && /key=/.test(line)) bad.push(`${rel(f)}:${i + 1}`);
      }
    }
    expect(bad, `key 가 붙은 입력칸:\n${bad.join('\n')}`).toEqual([]);
  });

  it('훑을 파일이 실제로 있다 — 검사가 빈손으로 통과하지 않게', () => {
    expect(FILES.length).toBeGreaterThan(30);
  });
});

describe('선수금 입력 상한', () => {
  const DP = readFileSync(path.join(SRC, 'components/DownPaymentFields.tsx'), 'utf8');

  it('🔴 비율은 0~100 으로 눌러 준다', () => {
    // 넘기면 선수금이 몫을 넘어 할부원금이 음수가 된다.
    // (예전 팝업의 max={100} 이 이 조각으로 옮기면서 빠져 실제로 2468% 가 먹혔다)
    expect(DP).toMatch(/Math\.min\(Math\.max\(Number\(v\) \|\| 0, 0\), 100\)/);
  });

  it('금액도 몫으로 눌러 준다', () => {
    expect(DP).toMatch(/Math\.min\(Math\.max\(Number\(v\) \|\| 0, 0\), base\)/);
  });
});
