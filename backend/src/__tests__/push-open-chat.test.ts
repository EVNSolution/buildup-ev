import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **알림을 누르면 그 주문의 「대화」 탭이 열려야 한다.**
 *
 * 예전엔 `/?order=19&step=…` 로 보냈는데 아무도 그 물음표 뒤를 읽지 않았고,
 * `HomeGate` 가 자기 화면으로 보내면서 **주소째 잘라 버렸다.** 그래서 알림을 눌러도
 * 그냥 첫 화면이 열렸다(「이상한 데로 간다」).
 *
 * 고리가 네 개라 하나만 끊겨도 증상이 똑같다 — 네 곳을 다 못박는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('알림 → 주문 대화 탭', () => {
  it('🔴 ① 서버가 보내는 주소에 order 와 tab=chat 이 들어 있다', () => {
    const src = read('backend/src/services/step-comments.ts');
    expect(src).toMatch(/url: `\/\?order=\$\{order\.id\}&tab=chat&step=/);
  });

  it('🔴 ② 서비스워커가 그 주소로 이동한다', () => {
    const sw = read('frontend/public/sw.js');
    // 알림 데이터에 주소를 싣고, 누르면 그리로 간다
    expect(sw).toMatch(/data: \{ url:/);
    expect(sw).toMatch(/navigate\(url\)/);
    expect(sw).toMatch(/openWindow\(url\)/);
  });

  it('🔴 ③ HomeGate 가 물음표 뒤를 잘라먹지 않는다', () => {
    const gate = read('frontend/src/components/HomeGate.tsx');
    // 서버는 받는 사람이 관리자인지 특장사인지 모르므로 `/` 로 보낸다 — 여기서 갈라진다
    expect(gate).toMatch(/homeFor\(session\.user\.role\)\}\$\{search\}/);
    expect(gate).toMatch(/useLocation/);
  });

  it('🔴 ④ 두 화면이 주소를 읽어 그 주문을 대화 탭으로 연다', () => {
    for (const f of ['frontend/src/pages/AdminPage.tsx', 'frontend/src/pages/MakerPage.tsx']) {
      const src = read(f);
      expect(src, f).toMatch(/useOrderDeepLink/);
      expect(src, f).toMatch(/initialTab=\{deepLink\?\.chat/);
    }
    // 대화 탭은 알림이 온 그 단계를 골라 둔 채 열린다
    expect(read('frontend/src/components/OrderChatTab.tsx')).toMatch(/initialStep/);
  });

  it('🔴 주소는 읽고 지운다 — 안 지우면 새로고침마다 다시 열린다 · 뒤로가기 이력은 더럽히지 않는다', () => {
    const lib = read('frontend/src/lib/deepLink.ts');
    expect(lib).toMatch(/navigate\(pathname \+ hash, \{ replace: true \}\)/);
    expect(lib).not.toMatch(/pushState/);
  });

  /*
   * 2026-09-16 제보 — 휴대폰에서 알림을 눌러도 아무 일도 없었다. 이미 그 화면에 있으면
   * 주소만 바뀌고 화면은 그대로였다(예전엔 마운트할 때 한 번만 읽었다).
   */
  it('🔴 주소가 바뀔 때마다 읽는다 — 이미 그 화면에 있어도 열린다', () => {
    const lib = read('frontend/src/lib/deepLink.ts');
    expect(lib).toMatch(/const \{ search, pathname, hash \} = useLocation\(\)/);
    expect(lib.match(/\}, \[search\]\)/g)?.length, '주소 변화를 안 본다').toBeGreaterThanOrEqual(2);
    const admin = read('frontend/src/pages/AdminPage.tsx');
    expect(admin).toMatch(/useViewDeepLink\('view', 'assign'/);
    expect(admin).toMatch(/if \(openAssignAt > 0\)/);
    expect(admin).toMatch(/if \(deepLink\) setSelectedOrderId\(deepLink\.orderId\)/);
  });

  it('🔴 설치한 앱 — 서비스워커가 열린 화면에 「여기로 가라」고 말한다(창을 직접 옮기는 것은 자주 실패한다)', () => {
    const sw = read('frontend/public/sw.js');
    expect(sw).toMatch(/postMessage\(\{ type: 'navigate', url \}\)/);
    expect(sw).toMatch(/openWindow\(url\)/);
    const app = read('frontend/src/components/SwNavigate.tsx');
    expect(app).toMatch(/d\?\.type !== 'navigate'/);
    expect(app).toMatch(/d\.url\.startsWith\('\/'\)/);   // 앱 안 주소만 따라간다
    expect(read('frontend/src/App.tsx')).toMatch(/<SwNavigate \/>/);
  });

  it('🔴 주소가 이상해도 무시한다 — 손으로 고친 주소로 깨지지 않게', () => {
    const lib = read('frontend/src/lib/deepLink.ts');
    expect(lib).toMatch(/Number\.isInteger/);
  });
});
