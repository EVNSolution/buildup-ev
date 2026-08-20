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

/**
 * **앱을 열면 그 계정의 화면으로 간다.**
 *
 * `start_url` 이 없으면 **추가할 때 보던 페이지가 시작 페이지로 굳는다** — 관리자 화면에서
 * 추가하면 영업 계정으로 로그인해도 관리자 주소로 열리고, 그 반대도 마찬가지다.
 * `/` 로 두면 `HomeGate` 가 **역할을 보고** 보낸다(관리자→/admin · 영업→/sales · 특장→/maker).
 */
describe('앱을 열었을 때 가는 곳', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'frontend/public/site.webmanifest'), 'utf8'));

  it('시작 주소는 뿌리다 — 어디서 추가하든 같은 자리에서 시작한다', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
  });

  it('앱처럼 뜬다 — 주소창 없이', () => {
    expect(manifest.display).toBe('standalone');
  });

  it('뿌리에서 역할을 보고 보낸다', () => {
    // start_url 만 고치고 이 갈림이 없으면 모두가 공개 화면에 떨어진다
    const gate = readFileSync(path.join(ROOT, 'frontend/src/components/HomeGate.tsx'), 'utf8');
    expect(gate).toMatch(/homeFor\(session\.user\.role\)/);
  });

  it('역할별 도착지가 정해져 있다', () => {
    const surfaces = readFileSync(path.join(ROOT, 'frontend/src/lib/surfaces.ts'), 'utf8');
    for (const [role, home] of [['SALES', '/sales'], ['ADMIN', '/admin'], ['MAKER', '/maker']]) {
      expect(surfaces, `${role} → ${home}`).toMatch(new RegExp(`path: '${home}'[^}]*role: '${role}'`));
    }
  });
});

/**
 * **새로고침은 화면을 리로드하지 않는다.**
 *
 * 설치형 앱에는 주소창도 새로고침도 없고, 이 앱은 문서가 스크롤되지 않아 당겨서
 * 새로고침도 발동하지 않는다. 그래서 헤더에 버튼을 하나 뒀다 — 다만 **리로드가 아니라
 * 지금 화면의 데이터만** 다시 불러온다.
 *
 * 리로드로 만들면 견적 저장·고객정보 수정처럼 긴 폼을 채우던 중에 눌렸을 때 전부 날아간다.
 * 하필 「막혔다」 싶은 순간에 눌리는 버튼이라 그 위험이 크다.
 */
describe('새로고침 버튼', () => {
  const ROOT2 = path.resolve(__dirname, '../../..');
  const readF = (rel: string) => readFileSync(path.join(ROOT2, rel), 'utf8');

  it('페이지를 리로드하지 않는다', () => {
    for (const rel of ['frontend/src/components/Header.tsx', 'frontend/src/contexts/RefreshContext.tsx']) {
      expect(readF(rel), `${rel} 에서 리로드를 부른다`).not.toMatch(/location\.reload\(|location\.href\s*=/);
    }
  });

  it('앱으로 돌아오면 저절로 다시 불러온다', () => {
    const ctx = readF('frontend/src/contexts/RefreshContext.tsx');
    expect(ctx).toMatch(/visibilitychange/);
    expect(ctx).toMatch(/'focus'/);
  });

  it('돌아올 때마다 부르지는 않는다 — 잦은 왕복에 목록이 깜빡이면 방해가 된다', () => {
    const ctx = readF('frontend/src/contexts/RefreshContext.tsx');
    expect(ctx).toMatch(/STALE_MS/);
  });

  it('목록 화면들이 등록해 둔다 — 등록이 없으면 버튼이 안 뜬다', () => {
    for (const rel of [
      'frontend/src/pages/SalesPage.tsx',
      'frontend/src/pages/AdminPage.tsx',
      'frontend/src/pages/MakerPage.tsx',
    ]) {
      expect(readF(rel), `${rel} 이 useScreenRefresh 를 안 부른다`).toMatch(/useScreenRefresh\(load\)/);
    }
  });
});
