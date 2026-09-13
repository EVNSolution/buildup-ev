import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **휴대폰에서는 두 손가락으로 벌려 확대할 수 있다 — 그리고 그때만 확대된다.**
 *
 * 연세 있는 사용자가 모바일 글씨를 읽기 힘들어한다(2026-09-13 요청).
 * 예전에는 확대를 모든 기기에서 막았다. 확대하면 `visualViewport` 가 배율만큼 줄어
 * 앱 높이가 같이 쪼그라들었기 때문이다(390×844, 2.2 배 → 844 → 602px, 실측).
 *
 * 여기서 지키는 것:
 *   ① 확대 중에는 앱 높이를 다시 재지 않는다 — 확대해도 화면이 무너지지 않는다
 *   ② 휴대폰에서는 확대 제스처를 막지 않는다, 마우스 기기에서만 막는다
 *   ③ 손가락으로 벌리지 않았는데 커지는 경로(두 번 탭·입력칸 초점·가로 회전)는 막혀 있다
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

type VV = { scale: number; height: number; offsetTop: number; addEventListener: () => void; removeEventListener: () => void };

describe('① 확대 중에는 앱 높이를 다시 재지 않는다', () => {
  let vv: VV;
  beforeEach(() => {
    vi.resetModules();
    vv = { scale: 1, height: 844, offsetTop: 0, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal('window', { visualViewport: vv, innerHeight: 844, innerWidth: 390 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('🔴 확대하면 확대 전 높이를 그대로 돌려준다 — 배율만큼 줄어든 값을 쓰지 않는다', async () => {
    const { visibleHeight, isPinchZoomed } = await import('../../../frontend/src/lib/viewport');
    expect(visibleHeight()).toBe(844);
    // 2.2 배 확대 — 보이는 창은 384px, 옆으로 끌어 218px 내려가 있다
    Object.assign(vv, { scale: 2.2, height: 384, offsetTop: 218 });
    expect(isPinchZoomed()).toBe(true);
    expect(visibleHeight(), '확대하는 순간 앱 높이가 쪼그라든다').toBe(844);
    // 원래대로 돌아오면 다시 잰다
    Object.assign(vv, { scale: 1, height: 844, offsetTop: 0 });
    expect(isPinchZoomed()).toBe(false);
    expect(visibleHeight()).toBe(844);
  });

  it('🔴 확대하지 않았을 때 키보드로 줄어드는 것은 그대로 따라간다', async () => {
    const { visibleHeight } = await import('../../../frontend/src/lib/viewport');
    Object.assign(vv, { scale: 1, height: 500, offsetTop: 0 });
    expect(visibleHeight()).toBe(500);
  });

  it('🔴 기본 배율이 1 에서 살짝 어긋난 기기도 확대로 보지 않는다 — 영영 못 재게 된다', async () => {
    const { visibleHeight, isPinchZoomed } = await import('../../../frontend/src/lib/viewport');
    Object.assign(vv, { scale: 0.98, height: 860, offsetTop: 0 });
    expect(isPinchZoomed()).toBe(false);
    expect(visibleHeight()).toBe(860);
  });

  it('🔴 앱 높이를 넣는 곳은 확대 중이면 아무것도 바꾸지 않는다', () => {
    const vp = read('frontend/src/lib/viewport.ts');
    const body = vp.slice(vp.indexOf('export function useAppHeight'), vp.indexOf('export function useDesktopNoPinchZoom'));
    // 첫 줄에서 빠져나가야 한다 — innerWidth(아이폰은 확대 중 줄어든다)도 재지 않게
    expect(body).toMatch(/const set = \(\) => \{[^]*?if \(isPinchZoomed\(\)\) return\s*\n\s*const visible = visibleHeight\(\)/);
  });
});

describe('② 휴대폰은 확대를 막지 않는다', () => {
  it('🔴 확대 제스처 차단은 손가락 기기가 아닐 때만 건다', () => {
    const vp = read('frontend/src/lib/viewport.ts');
    const body = vp.slice(vp.indexOf('export function useDesktopNoPinchZoom'));
    const coarse = body.indexOf("matchMedia?.('(pointer: coarse)').matches) return");
    expect(coarse, '손가락 기기에서 빠져나가는 줄이 없다').toBeGreaterThan(0);
    expect(coarse, '막는 줄이 손가락 기기 확인보다 먼저 온다').toBeLessThan(body.indexOf("addEventListener('gesturestart'"));
    expect(vp, '예전 전체 차단이 남아 있다').not.toMatch(/export function useNoPinchZoom/);
    expect(read('frontend/src/App.tsx')).toMatch(/useDesktopNoPinchZoom\(\)/);
  });

  it('🔴 viewport 로 확대 한도를 걸지 않는다 — 안드로이드·카카오톡 브라우저에서 손가락 확대가 막힌다', () => {
    const meta = read('frontend/index.html').match(/<meta name="viewport" content="([^"]+)"/)?.[1] ?? '';
    expect(meta).toContain('width=device-width');
    expect(meta).not.toMatch(/maximum-scale|minimum-scale|user-scalable/);
  });

  it('🔴 어떤 요소도 손가락 확대를 끄는 touch-action 을 쓰지 않는다', () => {
    const css = read('frontend/src/styles/globals.css');
    // manipulation = 스크롤 + 손가락 확대. pan-x/pan-y 만 두거나 none 이면 확대가 막힌다
    expect(css).toMatch(/html, body, #root \{[^}]*touch-action: manipulation;/);
    expect(css).not.toMatch(/touch-action:\s*(none|pan-[xy](\s+pan-[xy])?\s*;)/);
  });
});

describe('③ 손가락으로 벌리지 않았는데 커지는 일은 없다', () => {
  it('🔴 두 번 탭 확대는 꺼져 있다', () => {
    expect(read('frontend/src/styles/globals.css')).toMatch(/touch-action: manipulation/);
  });

  it('🔴 가로로 돌렸을 때 아이폰이 글자를 부풀리지 않는다', () => {
    const css = read('frontend/src/styles/globals.css');
    expect(css).toMatch(/html \{[^}]*-webkit-text-size-adjust: 100%;/);
  });

  it('🔴 입력칸 초점 확대는 글꼴로 막혀 있다(ios-focus-zoom.test.ts) — 그 검사가 살아 있다', () => {
    expect(read('backend/src/__tests__/ios-focus-zoom.test.ts')).toMatch(/SAFARI_MIN_PX = 16/);
  });
});
