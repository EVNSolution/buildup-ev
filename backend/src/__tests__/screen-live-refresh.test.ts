import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **켜 둔 화면이 따라온다 · 창 폭을 오가도 헤더가 흐트러지지 않는다**(2026-09-14 로컬 제보).
 *
 * ① 특장사가 단계를 끝내도 관리자 현황판 숫자가 그대로였다 — 처음 한 번만 읽었다.
 *    주문 상세를 열었다 뒤로 와도 같았다. 재현: 착수 8 · 완료 0 → 끝낸 뒤에도 8 · 0.
 *    고친 뒤: 뒤로 오면 바로, 켜 두면 30초 안에 7 · 1.
 * ② 창을 좁혔다 넓히면 헤더 좌우 여백이 0 이 됐다(1000→600→1000px: 24 → 0px).
 *    휴대폰 모양이 `padding` 한 줄로 덮고, PC 로 돌아갈 때 React 가 그 한 줄만 지워 PC 의
 *    paddingLeft·Right 까지 지워졌다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('① 목록이 저절로·돌아올 때 새로 읽힌다', () => {
  const ADMIN = read('frontend/src/pages/AdminPage.tsx');
  const kanban = ADMIN.slice(ADMIN.indexOf('function KanbanTab('), ADMIN.indexOf('export function AdminPage('));
  const MAKER = read('frontend/src/pages/MakerPage.tsx');

  it('🔴 관리자 주문 진행 — 켜 두면 조용히 다시 읽고, 상세·발주서에서 돌아오면 바로 읽는다', () => {
    expect(kanban).toMatch(/useLiveReload\(\(\) => load\(true\), selectedOrderId === null\)/);
    expect(kanban).toMatch(/onBack=\{\(\) => \{ setSelectedOrderId\(null\); load\(true\) \}\}/);
    expect(kanban).toMatch(/onClose=\{\(\) => \{ setViewingPo\(null\); load\(true\) \}\}/);
    // 조용히 읽을 때는 로딩 표시로 화면(펼친 칸·목록)을 비우지 않는다
    expect(kanban).toMatch(/if \(!silent\) setLoading\(true\)/);
  });

  it('🔴 특장사 목록도 같다', () => {
    expect(MAKER).toMatch(/useLiveReload\(\(\) => load\(true\), selectedId === null && !!email\)/);
    expect(MAKER).toMatch(/onBack=\{\(\) => \{ setSelectedId\(null\); load\(true\) \}\}/);
    expect(MAKER).toMatch(/if \(!silent\) setLoading\(true\)/);
  });

  it('🔴 보이는 동안에만 읽는다', () => {
    expect(read('frontend/src/lib/liveReload.ts')).toMatch(/document\.visibilityState === 'visible'/);
  });
});

describe('② 헤더 여백', () => {
  it('🔴 휴대폰 모양이 `padding` 한 줄로 덮지 않는다 — 네 방향 따로', () => {
    const header = read('frontend/src/components/Header.tsx');
    const i = header.indexOf('...(isMobile ? { height:');
    expect(i, '휴대폰 헤더 여백 줄이 사라졌다').toBeGreaterThan(0);
    const line = header.slice(i, header.indexOf('\n', i));
    expect(line, '한 줄 padding — PC 로 돌아갈 때 좌우 여백이 0 이 된다').not.toMatch(/\bpadding:/);
    expect(line).toMatch(/paddingLeft: 14, paddingRight: 14/);
  });
});
