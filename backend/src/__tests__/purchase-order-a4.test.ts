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
  it('🔴 서류는 **아래로 이어진다** — 한 장에 가두지 않는다', () => {
    /*
     * ⚠️ 여기 있던 「A4 비율(210:297)을 지킨다」를 **바꿔 썼다.**
     *
     *    한 장에 가두니 내용이 길수록 통째로 축소돼 글씨가 작아졌고, 그래서 적을 수 있는
     *    분량을 곳곳에서 막아야 했다(비고 4줄 · 커스텀 요청사항 30줄 · 아예 2페이지로 분리).
     *    **분량이 계속 골칫거리**가 됐다는 제보로 한 장 제약을 걷어냈다.
     *
     *    비율을 지키던 이유(「출력했을 때와 다른 서류가 된다」)는 인쇄를 붙일 때 다시 본다.
     *    지금 이 서류는 화면에서 읽고 승인하는 것이고, 잘리거나 작아지는 쪽이 더 나쁘다.
     */
    const src = read(SHEET);
    expect(src, '높이를 다시 가뒀다').not.toMatch(/aspectRatio: '210 \/ 297'/);
    expect(src, 'A4 높이 상수가 되살아났다').not.toMatch(/const BASE_H/);
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

  it('🔴 내용을 잘라 내지 않는다', () => {
    /*
     * 예전엔 `overflow: hidden` 으로 넘치는 만큼을 잘랐다. 특이사항 3·4 항이 소리 없이
     * 사라졌고, 읽는 사람은 **없는 줄 안다**(사진 제보). 그다음엔 잘라 내는 대신 세로로
     * 줄여 담았는데, 이번엔 길수록 글씨가 작아졌다.
     *
     * 지금은 **자르지도 줄이지도 않는다** — 길면 길어지고, 부모가 스크롤한다.
     */
    for (const name of ['frame', 'sheet']) {
      expect(styleBlock(SRC, name), `${name} 이 내용을 잘라 내고 있다`).not.toMatch(/overflow: 'hidden'/);
    }
    // 표제부 값도 잘리지 않는다 — 「브레…」로 잘리면 어느 회사인지 알 수 없다
    expect(styleBlock(SRC, 'metaValue'), '값을 …로 자르고 있다').not.toMatch(/textOverflow/);
    expect(SRC, '세로로 다시 줄이고 있다').not.toMatch(/setFit\(/);
  });

  it('🔴 재는 값과 손대는 값이 서로 물리지 않는다', () => {
    /*
     * 축소 배율과 자리 높이를 한 effect 에서 함께 정한다. 잰 값으로 높이를 바꾸는데
     * 그 높이가 다시 측정에 끼면 **끝없이 다시 그린다**(예전에 화면이 백지가 됐다).
     *
     * `scrollHeight` 는 transform 의 영향을 받지 않으므로 축소해도 값이 흔들리지 않고,
     * 폭은 **바깥틀**(frame)에서 재므로 안쪽 높이 변화에 물리지 않는다.
     *
     * ⚠️ **주석은 빼고 본다.** 「왜 이렇게 하면 안 되는가」를 적어 둔 주석에 검사가 걸려
     *    멀쩡한 코드에서 실패했다 — 이 저장소에서 두 번째다.
     */
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code, '폭을 서류 자신에게서 잰다 — 높이 변화와 물린다')
      .toMatch(/frame\.clientWidth \/ BASE_W/);
    expect(code, '축소된 값을 되돌려 읽고 있다').not.toMatch(/scrollHeight \/ \(?scale/);
    const i = SRC.indexOf('const frame = wrapRef.current');
    expect(SRC.slice(i, i + 900)).toMatch(/\}, \[\]\)/);
  });

  it('축소된 만큼만 자리를 차지한다', () => {
    /*
     * `transform` 은 레이아웃 높이를 바꾸지 않는다. 그대로 두면 축소해 놓고도
     * **원래 높이만큼 빈자리**가 남아 서류 아래가 휑해진다.
     */
    expect(SRC).toMatch(/setHeight\(sheet\.scrollHeight \* k\)/);
    expect(SRC).toMatch(/\.\.\.s\.frame, height/);
  });
});
