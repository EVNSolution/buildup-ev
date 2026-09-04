import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 배정 팝업과 발주서 — **서류는 A4 비율, 팝업은 화면 안.**
 *
 * 세 가지가 한꺼번에 어긋나 있었다(제보 + 실측):
 *  1. PC 에서도 팝업이 화면을 꽉 채웠다 — 큰 화면에서 전체화면은 과하다.
 *  2. 팝업 높이를 정하지 않아 위아래가 **화면 밖으로 나갔고**, 안쪽 스크롤 칸의
 *     스타일은 이름만 있고 **값이 없어서**(`undefined`) 스크롤도 되지 않았다.
 *     그래서 아래쪽 「제작 배정」 버튼을 아예 누를 수 없었다.
 *  3. 발주서가 A4 비율이 아니었다. 실제로 출력했을 때와 다른 서류가 된다.
 *
 * 셋 다 **조용히** 재발한다 — 화면은 그럭저럭 그려지고, 잘못됐다는 신호가 없다.
 * 그래서 소스에 남긴 장치를 여기서 지킨다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const ADMIN = 'frontend/src/pages/AdminPage.tsx';
const SHEET = 'frontend/src/components/PurchaseOrderSheet.tsx';

describe('배정 팝업', () => {
  it('전체화면은 손가락 기기에서만 쓴다', () => {
    const src = read(ADMIN);
    // 조건 없이 boxFull 을 쓰면 PC 에서도 전체화면이 된다
    expect(src).not.toMatch(/style=\{modal\.boxFull\}/);
    expect(src).toMatch(/isMobile \? modal\.boxFull : modal\.boxSheet/);
    expect(src).toMatch(/const isMobile = useIsMobile\(\)/);
  });

  it('PC 팝업은 높이가 화면에 묶여 있다', () => {
    const src = read(ADMIN);
    const box = src.slice(src.indexOf('boxSheet: {'), src.indexOf('boxSheet: {') + 400);
    expect(box).toMatch(/maxHeight: '\d+vh'/);      // 화면 밖으로 나가지 않는다
    expect(box).toMatch(/flexDirection: 'column'/); // 안쪽 스크롤 칸이 남는 높이를 가져간다
  });

  it('팝업 안쪽 스크롤 칸에 실제로 스타일이 있다', () => {
    const src = read(ADMIN);
    expect(src).toMatch(/style=\{modal\.scroll\}/);   // 쓰이고 있고
    const i = src.indexOf('\n  scroll: {');
    expect(i).toBeGreaterThan(0);                     // 정의도 돼 있어야 한다
    const def = src.slice(i, i + 400);
    expect(def).toMatch(/overflowY: 'auto'/);
    expect(def).toMatch(/minHeight: 0/); // 이게 없으면 flex 칸이 줄지 않아 스크롤이 안 생긴다
  });
});

describe('발주서', () => {
  it('A4 비율(210:297)을 지킨다', () => {
    expect(read(SHEET)).toMatch(/aspectRatio: '210 \/ 297'/);
  });

  it('세로 flex 안에서 눌리지 않는다', () => {
    const src = read(SHEET);
    const i = src.indexOf('  frame: {');
    expect(i).toBeGreaterThan(0);
    // flexShrink 를 빼면 남는 높이에 맞춰 눌린다 — 실측 0.956(A4 는 0.707)
    expect(src.slice(i, i + 400)).toMatch(/flexShrink: 0/);
  });

  it('좁은 화면에서는 다시 조판하지 않고 통째로 축소한다', () => {
    const src = read(SHEET);
    // 폭이 좁으면 글이 더 접혀 세로로 늘어난다. 늘 같은 폭으로 그린 뒤 줄여야 비율이 산다.
    expect(src).toMatch(/const BASE_W = \d+/);
    expect(src).toMatch(/transform: `scale\(\$\{scale\}\)`/);
    expect(src).toMatch(/transformOrigin: 'top left'/);
    // zoom 은 iOS 가 입력칸 글씨를 작다고 판단해 초점 확대를 일으킨다
    expect(src).not.toMatch(/\bzoom:/);
  });
});
