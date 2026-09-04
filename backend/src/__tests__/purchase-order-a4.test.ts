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

/**
 * 인라인 스타일 객체에서 **선언 하나를 통째로** 꺼낸다 — `name: { … }`.
 * 글자 수로 자르면 주석 길이에 따라 검사가 흔들린다(실제로 그렇게 헛짚었다).
 */
function styleBlock(src: string, name: string): string {
  const i = src.indexOf(`\n  ${name}: {`);
  expect(i, `${name} 스타일이 없다`).toBeGreaterThan(0);
  const end = src.indexOf('\n  },', i);
  expect(end, `${name} 스타일이 닫히지 않았다`).toBeGreaterThan(i);
  return src.slice(i, end);
}

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
    /*
     * flexShrink 를 빼면 남는 높이에 맞춰 눌린다 — 실측 0.956(A4 는 0.707).
     *
     * ⚠️ **선언 블록 전체를 본다.** 예전에는 앞에서 400 자만 잘라 봤는데, 주석이
     *    길어지자 정작 볼 줄이 그 밖으로 밀려 **멀쩡한 코드에서 실패**했다.
     *    검사가 글자 수에 흔들리면 고칠 곳을 잘못 짚게 된다.
     */
    expect(styleBlock(read(SHEET), 'frame')).toMatch(/flexShrink: 0/);
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

describe('발주서 내용', () => {
  const SRC = read(SHEET);

  it('🔴 한 장을 넘치면 잘라 내지 않고 줄여서 담는다', () => {
    /*
     * `overflow: hidden` 으로 넘치는 만큼을 잘랐더니 특이사항 3·4 항이 소리 없이
     * 사라졌다 — 읽는 사람은 **없는 줄 안다**(사진 제보). 서류에서 이건 사고다.
     * 종이에 맞춰 인쇄할 때처럼 글씨를 조금 줄여 한 장에 담는다(실측 배율 0.982).
     */
    expect(SRC).toMatch(/setFit\(natural > room \? room \/ natural : 1\)/);
    expect(SRC).toMatch(/transform: `scale\(\$\{fit\}\)`/);
  });

  it('🔴 재는 값과 손대는 값이 서로 물리지 않는다', () => {
    /*
     * 처음엔 `scrollHeight / fit` 로 되돌려 읽었다. 그러면 배율을 바꿀 때마다 측정값이
     * 조금씩 달라져 **끝없이 다시 그렸다**(Maximum update depth exceeded — 화면이 백지가 됐다).
     * `scrollHeight` 는 transform 의 영향을 받지 않으므로 되돌릴 필요가 없다.
     */
    /*
     * ⚠️ **주석은 빼고 본다.** 「왜 이렇게 하면 안 되는가」를 적어 둔 주석에 검사가 걸려
     *    멀쩡한 코드에서 실패했다 — 이 저장소에서 두 번째다.
     */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '측정값을 배율로 되돌리고 있다').not.toMatch(/scrollHeight \/ \(?fit/);
    // 의존성 없는 effect 는 매 렌더 재구독하며 같은 고리를 만든다
    const i = SRC.indexOf('const natural = el.scrollHeight');
    expect(SRC.slice(i, i + 400)).toMatch(/\}, \[\]\)/);
  });

  it('담기는 높이는 종이 안쪽 여백을 뺀 값이다', () => {
    // 여백을 빼지 않으면 「들어간다」고 판단해 놓고 실제로는 마지막 줄이 걸린다
    expect(SRC).toMatch(/const room = BASE_H - PAGE_PAD \* 2/);
    expect(SRC).toMatch(/padding: PAGE_PAD/);
  });
});
