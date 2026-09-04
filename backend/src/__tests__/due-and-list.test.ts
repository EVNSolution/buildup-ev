import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * **납기는 관리자와 특장사가 같은 것을 보고 이야기해야 한다.**
 * 화면마다 따로 계산하면 한쪽에서는 「3일 전」, 다른 쪽에서는 아무 표시도 없는 일이 생긴다.
 */
describe('납기 강조', () => {
  it('🔴 규칙은 shared 한 곳에 있고, 목록이 그것을 쓴다', () => {
    expect(read('shared/process/due.ts')).toMatch(/export function dueInfo/);
    const board = read('frontend/src/components/OrderStepsBoard.tsx');
    expect(board).toMatch(/from '@shared\/process\/due'/);
    // 관리자·특장사가 **같은 목록 컴포넌트**를 쓴다 — 그래서 한 번만 고치면 된다
    for (const f of ['frontend/src/pages/AdminPage.tsx', 'frontend/src/pages/MakerPage.tsx']) {
      expect(read(f), f).toMatch(/OrderStepsBoard/);
    }
  });

  it('🔴 급한 순서로 정렬한다 — 지난 건이 맨 위', () => {
    const board = codeOnly(read('frontend/src/components/OrderStepsBoard.tsx'));
    expect(board).toMatch(/dueInfo\(a\.delivery_due\)\.sortKey - dueInfo\(b\.delivery_due\)\.sortKey/);
  });

  it('🔴 날짜 옆에 「n일 전」·「n일 경과」를 붙인다', () => {
    const board = read('frontend/src/components/OrderStepsBoard.tsx');
    expect(board).toMatch(/\{due\.label\}/);
    expect(board).toMatch(/dueTagOver/);
  });

  it('🔴 줄 전체를 붉히는 것은 **지난 건만** — 다가온 건은 날짜만', () => {
    /*
     * 다가온 것과 넘긴 것은 다른 일이다. 사흘 전부터 줄까지 다 붉으면
     * 정말 넘긴 건이 그 속에 묻힌다.
     */
    const board = codeOnly(read('frontend/src/components/OrderStepsBoard.tsx'));
    expect(board).toMatch(/due\.state === 'overdue' \|\| !!st\?\.stalled/);
    expect(board).toMatch(/due\.state === 'soon' \? s\.dueSoon/);
  });
});

/**
 * **고객 이름으로 좁히기** — 기간·상태는 그대로 두고 그 안에서만.
 */
describe('견적 목록 이름 검색', () => {
  it('🔴 판정은 한 곳에 — 두 화면이 같은 함수를 쓴다', () => {
    expect(read('frontend/src/lib/quoteSearch.ts')).toMatch(/export function filterByCustomer/);
    for (const f of ['frontend/src/pages/AdminPage.tsx', 'frontend/src/pages/SalesPage.tsx']) {
      expect(codeOnly(read(f)), f).toMatch(/filterByCustomer\(quotes, nameQuery\)/);
    }
  });

  it('🔴 띄어쓰기·대소문자는 무시한다', () => {
    // 「홍 길동」으로 저장된 고객을 「홍길동」으로 찾을 수 있어야 한다
    expect(read('frontend/src/lib/quoteSearch.ts')).toMatch(/replace\(\/\\s\+\/g, ''\)\.toLowerCase\(\)/);
  });

  it('🔴 찾는 중에는 날짜 묶음을 전부 편다 — 접힌 날짜 안에 있으면 「없다」로 보인다', () => {
    expect(read('frontend/src/pages/SalesPage.tsx'))
      .toMatch(/if \(nameQuery\.trim\(\)\) \{ setCollapsed\(new Set\(\)\); return \}/);
  });
});

describe('처리 필요 견적 — 기본은 접힘', () => {
  it('🔴 접었다 펼 수 있고, 처음엔 접혀 있다', () => {
    /*
     * 쌓이면 수십 줄이라 그 아래 성과 숫자가 화면 밖으로 밀린다(제보).
     * 몇 건인지는 접힌 채로도 보여야 한다.
     */
    const perf = read('frontend/src/components/SalesPerformance.tsx');
    expect(perf).toMatch(/useState\(false\)/);
    expect(perf).toMatch(/setAttentionOpen/);
    expect(perf).toMatch(/aria-expanded=\{attentionOpen\}/);
    // 건수는 접혀 있어도 보인다
    expect(perf).toMatch(/처리 필요 견적 <span style=\{s\.count\}>\{attention\.length\}/);
  });
});

/**
 * **화면 전체는 확대되지도, 밀리지도 않는다.**
 */
describe('확대·바깥 스크롤 차단', () => {
  it('🔴 두 손가락 확대를 막는다 — meta 만으로는 아이폰에서 안 막힌다', () => {
    /*
     * `user-scalable=no` 는 iOS 10 부터 무시된다. 사파리는 확대 제스처를
     * `gesture*` 이벤트로 따로 주므로 그것을 막아야 실제로 멈춘다.
     */
    const vp = read('frontend/src/lib/viewport.ts');
    expect(vp).toMatch(/export function useNoPinchZoom/);
    expect(vp).toMatch(/gesturestart/);
    expect(read('frontend/src/App.tsx')).toMatch(/useNoPinchZoom\(\)/);
    // 더블탭 확대는 CSS 가 막는다. `none` 이면 안쪽 칸 스크롤까지 죽는다
    const css = read('frontend/src/styles/globals.css');
    expect(css).toMatch(/touch-action: manipulation/);
    expect(css).not.toMatch(/touch-action: none/);
  });

  it('🔴 서랍 폭은 zoom 보정을 받는다 — vw 는 보정을 못 받는다', () => {
    /*
     * `min(420px, 100vw)` 로 뒀더니 390 화면에서 **343px** 로 그려졌다(실측).
     * 서랍이 화면을 못 덮으니 옆이 비고, 기기에 따라 반대로 삐져나와 가로로 끌렸다.
     */
    const drawer = read('frontend/src/components/StepChat.tsx');
    expect(drawer).toMatch(/width: 'var\(--panel-w/);
    expect(drawer, 'vw 는 zoom 보정을 못 받는다').not.toMatch(/width: 'min\(420px, 100vw\)'/);
    expect(read('frontend/src/lib/viewport.ts')).toMatch(/--panel-w/);
  });
});
