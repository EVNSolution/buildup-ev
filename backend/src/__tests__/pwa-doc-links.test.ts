import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * **홈 화면에 추가한 앱(PWA)에서도 서류가 열려야 한다.**
 *
 * 그 창에는 **탭이 없다.** 그래서 `target="_blank"` 도 `window.open` 도 아무 일이
 * 일어나지 않아, 서류를 아예 볼 수 없었다(실제 제보 — 「PC 에서는 새 탭으로 열리는데
 * 앱에서는 막힌다」). 갈림은 `lib/openPdf.ts` 한 곳에서 처리한다 —
 * 브라우저면 새 탭, 설치형이면 내려받아 기기의 PDF 뷰어로 넘긴다.
 *
 * 여기서 막는 것: **서류를 여는 곳이 그 갈림을 건너뛰는 것.**
 * 화면마다 `<a target="_blank">` 를 새로 쓰면 그 화면만 조용히 앱에서 안 된다.
 */
const SRC = path.resolve(__dirname, '../../../frontend/src');

/** 갈림을 스스로 처리하는 파일들 — 여기서만 새 탭을 직접 연다. */
const ALLOWED = new Set(['lib/openPdf.ts', 'components/DocLink.tsx']);

/** 서류가 아닌 바깥 링크는 새 탭이 맞다(처리방침 등). */
const OUTBOUND = /rel="noreferrer"[^>]*>\s*개인정보 처리방침|to="\/privacy"/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('설치형 앱(PWA)에서도 서류가 열리는가', () => {
  const files = walk(SRC).map(f => ({ rel: path.relative(SRC, f), src: readFileSync(f, 'utf8') }));

  it('서류를 여는 곳은 새 탭을 직접 열지 않는다', () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      if (ALLOWED.has(rel)) continue;
      // API 로 받은 파일을 새 탭으로 여는 흔적
      const apiTab = /window\.open\(\s*[`'"][^`'"]*\/api\//.test(src);
      const apiAnchor = /<a[^>]+href=\{[^}]*(?:FileUrl|\/api\/)[^}]*\}[^>]*target="_blank"/s.test(src);
      if (apiTab || apiAnchor) bad.push(rel);
    }
    expect(bad, `openPdf/DocLink 를 거치지 않는 곳: ${bad.join(', ')}`).toEqual([]);
  });

  it('바깥 링크(처리방침)는 새 탭이어도 된다 — 서류가 아니다', () => {
    const priv = files.find(f => f.rel === 'components/InquiryModal.tsx');
    expect(priv, 'InquiryModal 을 못 찾았다 — 경로가 바뀌었으면 검사식을 고칠 것').toBeDefined();
    expect(OUTBOUND.test(priv!.src)).toBe(true);
  });

  it('갈림은 openPdf 한 곳에 있다', () => {
    const helper = files.find(f => f.rel === 'lib/openPdf.ts')!.src;
    expect(helper).toMatch(/export function isStandalone/);
    expect(helper).toMatch(/display-mode: standalone/);
    // 설치형에서는 내려받아 기기에 넘긴다
    expect(helper).toMatch(/a\.download/);
  });
});
