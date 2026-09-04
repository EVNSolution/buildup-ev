import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 아이폰 안전영역 — **노치·홈 인디케이터·둥근 모서리에 UI 가 가리면 안 된다.**
 *
 * 실제로 컨피규레이터의 검은 「실구매가」 줄 아래 모서리가 잘렸다(사진 제보).
 * `viewport-fit=cover` 로 화면 끝까지 쓰되, 가려지는 만큼을 **안쪽 여백**으로 민다.
 *
 * ⚠️ 버튼을 작게 만들어 피하는 방식은 금지다 — 배경은 바닥까지, 내용만 위로.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** 화면 끝에 닿는 면들 — 하나라도 빠지면 그 화면만 잘린다 */
const EDGE_SURFACES = [
  'frontend/src/components/PriceBar.tsx',      // 컨피규레이터 실구매가 줄
  'frontend/src/components/OptionPanel.tsx',   // 견적 저장 버튼
  /*
   * 대화 입력줄 — 단계별 서랍과 「대화」 탭이 **같은 것**을 쓴다.
   * 예전엔 두 화면이 각자 입력줄을 갖고 각자 안전영역을 챙겼다.
   * 하나로 합치면서 바닥에 닿는 면도 여기 하나가 됐다.
   */
  'frontend/src/components/ChatComposer.tsx',
  'frontend/src/components/Header.tsx',        // 노치 아래 헤더
];

describe('아이폰 안전영역', () => {
  it('🔴 viewport-fit=cover 가 켜져 있다 — 없으면 env() 가 늘 0 이라 무의미하다', () => {
    expect(read('frontend/index.html')).toMatch(/viewport-fit=cover/);
  });

  it('🔴 화면 끝에 닿는 면은 모두 안전영역을 쓴다', () => {
    const missing = EDGE_SURFACES.filter(f => !read(f).includes('styles/safeArea'));
    expect(missing, `안전영역을 안 쓰는 화면:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 단계별 대화 서랍은 노치 아래에서 시작한다', () => {
    // 화면 끝까지 덮는 고정 서랍이라 위쪽 노치를 스스로 피해야 한다
    expect(read('frontend/src/components/StepChat.tsx')).toMatch(/env\(safe-area-inset-top/);
  });

  it('🔴 안전영역은 여백으로 민다 — 높이를 줄여 피하지 않는다', () => {
    const helper = read('frontend/src/styles/safeArea.ts');
    /*
     * 아래쪽은 `max(base, inset)` 이다 — `base + inset` 이 아니다.
     *
     * 더하면 원래 여백(16px)에 홈 인디케이터(34px)가 **얹혀** 50px 이 되어
     * 「아래 안전구역 마진이 너무 심하다」는 제보가 나왔다. 지켜야 할 것은 두 가지뿐이다.
     *   ① 인디케이터를 피할 만큼은 반드시 확보한다(≥ inset)
     *   ② 안전영역이 없는 기기에서 원래 여백이 사라지지 않는다(≥ base)
     * `max` 는 둘 다 만족하고, 여백을 필요 이상으로 부풀리지 않는다.
     */
    expect(helper).toMatch(/max\(\$\{base\}, env\(safe-area-inset-bottom/);
    // 되돌아가지 않게 못을 박는다 — 더하기 꼴이 다시 들어오면 50px 여백이 부활한다
    expect(helper).not.toMatch(/calc\(\$\{base\} \+ env\(safe-area-inset-bottom/);
    // 위쪽(노치)은 겹쳐 가리므로 더하는 게 맞다 — 아래와 사정이 다르다
    expect(helper).toMatch(/calc\(\$\{base\} \+ env\(safe-area-inset-top/);
    // 안전영역이 없는 기기에서는 0px — 다른 기기에 영향이 없어야 한다
    expect(helper).toMatch(/safe-area-inset-bottom, 0px/);
  });

  it('🔴 스크롤로 끝나는 화면은 꽉 채우고 바닥만 살짝 띄운다', () => {
    /*
     * 하단 고정 바가 없는 화면(주문 진행)은 내용이 바닥까지 차야 한다.
     * 여기서도 `max` 라 인디케이터가 없는 기기에서는 8px 만 남는다.
     */
    const helper = read('frontend/src/styles/safeArea.ts');
    expect(helper).toMatch(/safeScrollBottom/);
    expect(helper).toMatch(/max\(\$\{base\}, env\(safe-area-inset-bottom/);
  });

  it('🔴 zoom 을 되돌린 높이를 **한 곳에서** 정한다 — 안 그러면 바닥에 빈 칸이 남는다', () => {
    /*
     * 손가락 기기에서 `#root` 에 `zoom: .88` 이 걸린다. 화면 높이를 그대로 주면
     * **0.88 배로 그려져 바닥에 100px 빈 칸**이 남는다(844 지정 → 743 렌더, 실측).
     * 백분율에 기대면 브라우저 해석이 갈린다 — `calc(100% / .88)` 은 이중으로 먹었다(1090px, 실측).
     * 그래서 zoom 값을 **직접 읽어** 한 번만 되돌린다.
     */
    expect(read('frontend/src/styles/globals.css')).toMatch(/#root \{ zoom: 0?\.88/);
    const vp = read('frontend/src/lib/viewport.ts');
    expect(vp).toMatch(/getComputedStyle\(root\)\.zoom/);
    expect(vp).toMatch(/--root-h/);
    // 백분율 calc 로 되돌리면 브라우저마다 다르게 먹는다(실측 1090px) — CSS 로 되돌리지 않는다
    expect(read('frontend/src/styles/globals.css')).not.toMatch(/#root \{ zoom[^}]*calc\(/);
  });

  it('🔴 뷰포트를 재는 곳은 **한 곳뿐**이다', () => {
    /*
     * 예전엔 주문 상세·대화 탭이 각자 뷰포트를 쟀다. 아이폰에서 `visualViewport.height`
     * 와 `getBoundingClientRect().top` 은 **좌표계가 달라**, 섞어 계산한 높이가 화면보다
     * 커졌다 → 바깥 칸이 넘쳐 화면 전체가 스크롤됐다(사진 제보).
     * 이제 각 화면은 부모를 채우기만 한다.
     */
    for (const f of ['frontend/src/components/OrderDetail.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      const src = read(f);
      expect(src, `${f} — 화면을 또 재고 있다`).not.toMatch(/visibleHeight\(\)/);
      expect(src, `${f} — innerHeight 를 직접 쓰고 있다`).not.toMatch(/window\.innerHeight/);
    }
    // 주문 상세는 부모를 채운다
    expect(read('frontend/src/components/OrderDetail.tsx')).toMatch(/height: '100%'/);
  });

});
