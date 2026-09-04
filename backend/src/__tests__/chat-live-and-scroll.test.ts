import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * **상대가 남긴 글은 저절로 떠야 한다.**
 * 열 때 한 번만 받아 오던 시절에는 알림만 오고 화면은 그대로여서, 새로고침을 눌러야
 * 보였다(실제 제보). 대화는 지금 주고받는 것이라 그러면 안 된다.
 */
describe('대화 — 새 글이 저절로 뜬다', () => {
  it('🔴 두 대화 화면 모두 주기적으로 다시 받아 온다', () => {
    for (const f of ['frontend/src/components/StepChat.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      expect(codeOnly(read(f)), `${f} — 새로고침해야만 보인다`).toMatch(/useChatPoll\(/);
    }
  });

  it('🔴 화면이 가려져 있으면 쉰다 — 배터리·서버를 낭비하지 않는다', () => {
    const lib = read('frontend/src/lib/chatPoll.ts');
    expect(lib).toMatch(/document\.hidden/);
    // 돌아오면 기다리지 않고 바로 한 번
    expect(lib).toMatch(/visibilitychange/);
    expect(lib).toMatch(/'focus'/);
  });

  it('🔴 바뀐 게 없으면 목록을 손대지 않는다 — 다시 그리면 사진이 깜빡이고 스크롤이 튄다', () => {
    /*
     * 증분 조회로 바뀐 뒤에는 **빈 응답이 곧 「새 글 없음」**이다.
     * `appendComments` 는 그때 **앞서 쓰던 배열을 그대로** 돌려준다 —
     * 내용이 같은 새 배열을 넣으면 리액트가 목록을 통째로 다시 그린다.
     */
    const lib = read('frontend/src/lib/chatPoll.ts');
    expect(lib).toMatch(/export function appendComments/);
    expect(lib, '새 글이 없을 때 앞서 쓰던 배열을 그대로 돌려줘야 한다')
      .toMatch(/if \(incoming\.length === 0\) return prev/);
    expect(lib, '걸러 낸 결과가 비어도 마찬가지다').toMatch(/if \(added\.length === 0\) return prev/);
    for (const f of ['frontend/src/components/StepChat.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      expect(codeOnly(read(f)), f).toMatch(/appendComments\(/);
    }
  });

  it('🔴 폴링이 「불러오는 중」으로 화면을 비우지 않는다', () => {
    /*
     * 처음 열 때만 비운다. 폴링에서 `setRows(null)` 을 하면 5초마다 글이 사라졌다
     * 나타나 읽던 사람이 깜빡임을 본다.
     */
    const chat = read('frontend/src/components/StepChat.tsx');
    const poll = chat.slice(chat.indexOf('useChatPoll('), chat.indexOf('useChatPoll(') + 700);
    expect(poll).not.toMatch(/setRows\(null\)/);
  });

  it('🔴 고른 단계를 되돌리지 않는다 — 답을 쓰는 중에 바뀌면 안 된다', () => {
    const tab = read('frontend/src/components/OrderChatTab.tsx');
    const poll = tab.slice(tab.indexOf('useChatPoll('), tab.indexOf('useChatPoll(') + 700);
    expect(poll).not.toMatch(/setStep\(/);
  });
});

/**
 * **화면 전체는 절대 스크롤되지 않는다.** 스크롤되는 것은 각 화면이 정한 안쪽 칸뿐이다.
 * `overflow: hidden` 만으로는 아이폰에서 안 막힌다 — 사파리가 문서를 끌어당겨
 * 화면이 통째로 움직이고 주소창이 접혔다 펴진다(반복 제보).
 */
describe('문서 스크롤 잠금', () => {
  const css = () => read('frontend/src/styles/globals.css');

  it('🔴 두 겹으로 막는다 — overflow 만으로는 아이폰에서 안 듣는다', () => {
    expect(css()).toMatch(/html, body, #root \{[\s\S]{0,400}overflow: hidden/);
    expect(css(), '고무줄·당겨서 새로고침이 안 막혔다').toMatch(/overscroll-behavior: none/);
    expect(css(), '아이폰에서 문서가 끌린다').toMatch(/body \{\s*\n\s*position: fixed;/);
    // 안쪽 칸이 끝에 닿아도 그 힘을 바깥으로 넘기지 않는다 — 넘기면 화면이 통째로 출렁인다
    for (const f of ['frontend/src/pages/AdminPage.tsx',
                     'frontend/src/pages/MakerPage.tsx',
                     'frontend/src/components/OrderDetail.tsx',
                     'frontend/src/components/StepChat.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      expect(read(f), `${f} — 스크롤이 바깥으로 넘어간다`).toMatch(/overscrollBehavior: 'contain'/);
    }
  });

  it('🔴 안쪽 칸은 그대로 스크롤된다 — 막는 것은 문서이지 내용이 아니다', () => {
    // 각 화면의 본문은 자기 칸에서 스크롤한다
    for (const f of ['frontend/src/pages/AdminPage.tsx',
                     'frontend/src/pages/MakerPage.tsx',
                     'frontend/src/components/OrderDetail.tsx']) {
      expect(read(f), f).toMatch(/overflowY: 'auto'/);
    }
  });
});
