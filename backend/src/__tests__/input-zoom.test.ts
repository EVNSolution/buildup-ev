import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **입력칸에 초점이 가도 화면이 확대되면 안 된다.**
 *
 * 아이폰은 글꼴이 16px 미만인 입력칸에 초점이 가면 화면 전체를 확대한다.
 * 대화창에 글을 쓰려는데 화면이 커져 버린다는 제보가 있었다.
 * 카카오톡처럼 **키보드가 올라온 만큼만** 올라가야 한다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const css = () => read('frontend/src/styles/globals.css');

describe('입력 초점 확대 방지', () => {
  it('🔴 손가락 기기의 입력칸 글꼴은 zoom 을 되돌려도 16px 이상이다', () => {
    const src = css();
    const zoom = Number(/#root \{ zoom: ([\d.]+)/.exec(src)?.[1]);
    const fs = Number(/--fs-input: ([\d.]+)px/.exec(src)?.[1]);
    expect(zoom, 'zoom 값을 못 읽었다').toBeGreaterThan(0);
    expect(fs, '--fs-input 을 못 읽었다').toBeGreaterThan(0);
    /*
     * 아이폰이 「적힌 값」을 보든 「그려진 값」을 보든 둘 다 16px 이상이어야 한다.
     * zoom 이 .88 이므로 16px 을 적으면 화면에는 14.08px 로 그려져 부족하다.
     */
    expect(fs, '적힌 값이 16px 미만').toBeGreaterThanOrEqual(16);
    expect(fs * zoom, `화면에 그려지는 크기(${(fs * zoom).toFixed(2)}px)가 16px 미만`)
      .toBeGreaterThanOrEqual(16);
  });

  it('🔴 인라인 style 을 이긴다 — 한 칸이라도 새면 거기서만 확대된다', () => {
    const src = css();
    /*
     * 이 앱은 인라인 스타일 객체로 UI 를 짜서 입력칸마다 `fontSize: 13`, `12.5` 가
     * 박혀 있다. `!important` 가 없으면 그 칸들만 조용히 확대된다.
     */
    expect(src).toMatch(/font-size: var\(--fs-input\) !important/);
    expect(src).toMatch(/input:not\(\[type='checkbox'\]\)/);
    expect(src).toMatch(/^\s*select,$/m);
    expect(src).toMatch(/^\s*textarea \{$/m);
  });

  it('🔴 인라인 !important 로 이 규칙을 되돌린 곳이 없다', () => {
    // React 인라인 style 로는 !important 를 넣을 수 없지만, 다른 CSS 로는 가능하다
    const offenders: string[] = [];
    for (const f of ['frontend/src/styles/globals.css']) {
      for (const line of read(f).split('\n')) {
        if (/font-size[^;]*!important/.test(line) && !line.includes('--fs-input')) offenders.push(line.trim());
      }
    }
    expect(offenders, `입력칸 글꼴을 되돌리는 선언:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('🔴 표 안 숫자칸은 키운 글꼴만큼 넓혀 둔다 — 안 그러면 금액이 잘린다', () => {
    /*
     * 글꼴만 키우면 옵션DB 의 단가칸에서 「46,530,000」 이 잘린다(실측 79px 칸).
     * 넓혀 두면 **변경 전과 잘리는 칸 수가 같다**(38칸 → 38칸, 실측). 표는 이미
     * 가로로 스크롤되므로 넓혀도 화면이 밀리지 않는다.
     */
    expect(css()).toMatch(/td input[^\n]*min-width: \d+px !important/);
  });

  it('🔴 maximum-scale·user-scalable 로 막지 않는다 — iOS 는 무시하고 확대는 그대로다', () => {
    /*
     * 흔한 오답이다. iOS 10 부터 무시되어 초점 확대는 그대로 일어나고,
     * 안드로이드에서는 **손가락으로 키우는 것만** 막혀 접근성만 나빠진다.
     */
    const html = read('frontend/index.html');
    expect(html).not.toMatch(/maximum-scale/);
    expect(html).not.toMatch(/user-scalable/);
  });
});

describe('키보드는 올라온 만큼만 — 카카오톡처럼', () => {
  it('🔴 innerHeight 가 아니라 visualViewport 로 잰다', () => {
    const lib = read('frontend/src/lib/viewport.ts');
    /*
     * 아이폰은 키보드가 올라와도 `innerHeight` 가 그대로다(레이아웃 뷰포트는 안 준다).
     * 그 값으로 높이를 잡으면 **입력칸이 키보드 뒤로 숨는다.**
     */
    expect(lib).toMatch(/visualViewport/);
    expect(lib).toMatch(/vv\.height \+ vv\.offsetTop/);
    // 안 되는 기기에서는 예전처럼 동작해야 한다
    expect(lib).toMatch(/window\.innerHeight/);
  });

  it('🔴 대화 화면 두 곳이 모두 키보드를 따라간다', () => {
    for (const f of ['frontend/src/components/OrderDetail.tsx',
                     'frontend/src/components/StepChat.tsx']) {
      const src = read(f);
      expect(src, `${f} — 키보드 높이를 안 따라간다`).toMatch(/visibleHeight\(\)/);
      expect(src, `${f} — 키보드 여닫기를 안 듣는다`).toMatch(/onVisibleHeightChange/);
    }
  });
});
