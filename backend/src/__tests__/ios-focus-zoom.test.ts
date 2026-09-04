import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **아이폰에서 입력칸을 눌러도 화면이 확대되면 안 된다.**
 *
 * 사파리는 글꼴이 16px 보다 **작게 그려지는** 입력칸에 초점이 가면 화면을 확대한다.
 * 그리고 이 앱은 손가락 확대를 막아 두었으므로 — 한번 확대되면 **되돌릴 길이 없다.**
 * 사용자는 그 화면에 갇힌다(실제 제보).
 *
 * 여기서 못박는 것은 값 하나가 아니라 **관계**다:
 *
 *     적힌 글꼴 × #root 의 zoom  ≥  16px
 *
 * 값을 하나만 고정해 두면 다른 하나가 바뀔 때 조용히 깨진다. 실제로 그렇게 깨졌다 —
 * 「입력칸만 커 보인다」는 이유로 글꼴을 16px 로 내렸는데, zoom 이 0.88 이라
 * 화면에는 14.08px 로 그려져 확대가 되살아났다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const CSS = readFileSync(path.join(ROOT, 'frontend/src/styles/globals.css'), 'utf8');

/** 사파리가 초점 확대를 하지 않는 경계 */
const SAFARI_MIN_PX = 16;

/** `(pointer: coarse)` 안에서 정한 값만 본다 — 손가락 기기가 문제이므로 */
function coarseBlock(): string {
  const i = CSS.indexOf('@media (pointer: coarse)');
  expect(i, '손가락 기기 규칙이 없다').toBeGreaterThan(0);
  return CSS.slice(i);
}

describe('아이폰 초점 확대', () => {
  const coarse = coarseBlock();

  const fontMatch = coarse.match(/--fs-input:\s*([\d.]+)px/);
  const zoomMatch = coarse.match(/#root\s*\{\s*zoom:\s*([\d.]+)/);

  it('손가락 기기의 입력 글꼴과 zoom 이 둘 다 적혀 있다', () => {
    expect(fontMatch, '--fs-input 을 못 찾았다').not.toBeNull();
    expect(zoomMatch, '#root 의 zoom 을 못 찾았다').not.toBeNull();
  });

  it('🔴 적힌 글꼴 × zoom ≥ 16px — 그려지는 크기가 기준을 넘어야 한다', () => {
    const font = Number(fontMatch![1]);
    const zoom = Number(zoomMatch![1]);
    const rendered = font * zoom;
    expect(
      rendered,
      `입력 글꼴 ${font}px × zoom ${zoom} = ${rendered.toFixed(2)}px — `
      + `${SAFARI_MIN_PX}px 미만이면 아이폰이 화면을 확대하고, 손가락 확대를 막아 두어 되돌릴 수 없다`,
    ).toBeGreaterThanOrEqual(SAFARI_MIN_PX);
  });

  it('🔴 모든 입력칸이 그 값을 강제로 물려받는다', () => {
    /*
     * 이 앱은 인라인 스타일로 UI 를 짜서 입력칸마다 `fontSize: 13` 같은 값이 박혀 있다.
     * 한 곳이라도 놓치면 그 칸에서만 확대되는데, 사용자는 어느 칸인지 모른 채
     * 「가끔 확대된다」로 겪는다.
     */
    expect(coarse).toMatch(/font-size:\s*var\(--fs-input\)\s*!important/);
    for (const sel of ['input:not(', 'select', 'textarea']) {
      expect(coarse, `${sel} 이 규칙에서 빠졌다`).toContain(sel);
    }
  });

  it('🔴 iOS 가 무시하는 방법으로 막으려 하지 않는다', () => {
    /*
     * `user-scalable=no`·`maximum-scale=1` 은 iOS 10 부터 무시된다 — 확대는 그대로
     * 일어나면서 안드로이드에서 손가락 확대만 막혀, 없느니만 못한 상태가 된다.
     */
    const html = readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
    const viewport = html.match(/<meta[^>]*name="viewport"[^>]*>/)?.[0] ?? '';
    expect(viewport).not.toMatch(/user-scalable\s*=\s*no/);
    expect(viewport).not.toMatch(/maximum-scale/);
  });
});
