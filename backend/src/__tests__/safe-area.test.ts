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
  'frontend/src/components/PriceBar.tsx',    // 컨피규레이터 실구매가 줄
  'frontend/src/components/OptionPanel.tsx', // 견적 저장 버튼
  'frontend/src/components/StepChat.tsx',    // 단계별 대화 서랍
  'frontend/src/components/OrderChatTab.tsx',// 대화 탭 입력칸
  'frontend/src/components/Header.tsx',      // 노치 아래 헤더
];

describe('아이폰 안전영역', () => {
  it('🔴 viewport-fit=cover 가 켜져 있다 — 없으면 env() 가 늘 0 이라 무의미하다', () => {
    expect(read('frontend/index.html')).toMatch(/viewport-fit=cover/);
  });

  it('🔴 화면 끝에 닿는 면은 모두 안전영역을 쓴다', () => {
    const missing = EDGE_SURFACES.filter(f => !read(f).includes('styles/safeArea'));
    expect(missing, `안전영역을 안 쓰는 화면:\n${missing.join('\n')}`).toEqual([]);
  });

  it('🔴 안전영역은 여백으로 민다 — 높이를 줄여 피하지 않는다', () => {
    const helper = read('frontend/src/styles/safeArea.ts');
    // calc(기본값 + inset) 꼴이어야 한다. inset 만 쓰면 원래 여백이 사라진다
    expect(helper).toMatch(/calc\(\$\{base\} \+ env\(safe-area-inset-bottom/);
    expect(helper).toMatch(/calc\(\$\{base\} \+ env\(safe-area-inset-top/);
    // 안전영역이 없는 기기에서는 0px — 다른 기기에 영향이 없어야 한다
    expect(helper).toMatch(/safe-area-inset-bottom, 0px/);
  });
});
