import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * **대화는 새로 생긴 것만 받아 온다.**
 *
 * 예전엔 몇 초마다 **처음부터 전부** 내려받았다. 대화가 길어질수록 오가는 양이 계속
 * 커지는 구조였다 — 사람이 늘어서가 아니라 시간이 지나서 무거워진다.
 * 실측: 메시지 9개짜리 주문에서 전체 2,993B → 증분 48B (98% 감소).
 */
describe('증분 조회 — 새로 생긴 것만', () => {
  it('🔴 서버가 `after` 뒤의 것만 고른다', () => {
    const svc = read('backend/src/services/step-comments.ts');
    expect(svc).toMatch(/function afterId/);
    expect(svc).toMatch(/id: \{ gt: after \}/);
    // 두 조회 모두 받아야 한다 — 한쪽만 고치면 그 화면만 계속 전부 받는다
    expect(svc).toMatch(/listComments\(orderId: number, stepCode: string, after\?: number\)/);
    expect(svc).toMatch(/listAllComments\(orderId: number, after\?: number\)/);
  });

  it('🔴 `after` 는 정수·양수일 때만 먹는다 — 손댄 주소로 깨지지 않게', () => {
    expect(read('backend/src/services/step-comments.ts')).toMatch(/Number\.isInteger\(after\)/);
  });

  it('🔴 증분일 때는 단계 목록을 다시 보내지 않는다', () => {
    /*
     * 14줄짜리 고정 목록(700B 남짓)을 몇 초마다 다시 실어 보내면 증분으로 아낀 것을
     * 그대로 도로 쓴다. 화면은 처음 받은 것을 그대로 갖고 있으면 된다.
     */
    const routes = read('backend/src/routes/steps.ts');
    expect(routes).toMatch(/incremental \? \{\} : \{ steps:/);
  });

  it('🔴 화면이 마지막으로 받은 id 를 기준으로 묻는다', () => {
    for (const f of ['frontend/src/components/StepChat.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      expect(codeOnly(read(f)), `${f} — 전부 다시 받고 있다`).toMatch(/lastId\(rows\)/);
    }
  });

  it('🔴 받은 것을 이어 붙이되 같은 글을 두 번 넣지 않는다', () => {
    /*
     * 요청이 겹치거나 글을 남긴 직후 폴링이 돌면 방금 것이 또 올 수 있다.
     * `id` 가 유일하므로 그것으로 거른다.
     */
    const lib = read('frontend/src/lib/chatPoll.ts');
    expect(lib).toMatch(/export function appendComments/);
    expect(lib).toMatch(/new Set\(base\.map\(c => c\.id\)\)/);
    // 순서가 곧 이야기 순서다 — 이어 붙인 뒤에도 id 순을 지킨다
    expect(lib).toMatch(/sort\(\(a, b\) => a\.id - b\.id\)/);
  });
});

/**
 * **이야기가 오갈 때만 자주 묻는다.**
 * 5초 고정이었을 때는 조용할 때도 5초마다 물었고, 정작 대화 중에는 5초가 느렸다.
 */
describe('폴링 간격 — 상황에 따라', () => {
  it('🔴 대화 중에는 당기고 조용하면 늦춘다', () => {
    const lib = read('frontend/src/lib/chatPoll.ts');
    expect(lib).toMatch(/export const CHAT_POLL_ACTIVE_MS = 2_000/);
    expect(lib).toMatch(/export const CHAT_POLL_IDLE_MS = 15_000/);
    expect(lib).toMatch(/export function pollDelay/);
  });

  it('🔴 고정 간격(setInterval)이 아니라 매번 다시 정한다', () => {
    /*
     * `setInterval` 은 간격을 처음 한 번만 읽는다. 대화가 시작돼도 계속 15초로 돈다.
     * 스스로 다음 차례를 잡는 `setTimeout` 이라야 그때그때 정할 수 있다.
     */
    const lib = codeOnly(read('frontend/src/lib/chatPoll.ts'));
    expect(lib).toMatch(/setTimeout\(/);
    expect(lib, 'setInterval 은 간격 변화를 못 따라간다').not.toMatch(/setInterval\(/);
    expect(lib).toMatch(/delay\.current\(\)/);
  });

  it('🔴 화면이 가려져 있으면 여전히 쉰다', () => {
    expect(read('frontend/src/lib/chatPoll.ts')).toMatch(/document\.hidden/);
  });
});

/**
 * **안 읽은 대화가 있으면 「대화」 탭 전체를 칠한다.**
 * 점 하나로는 다른 탭을 보고 있을 때 눈에 안 들어온다.
 */
describe('안 읽은 대화 표시', () => {
  it('🔴 단계별 점은 버튼 **안쪽**에 있다 — 밖에 두면 잘린다', () => {
    /*
     * 버튼 스타일(BTN.row)에 `overflow: hidden` 이 걸려 있어(긴 라벨 말줄임용),
     * 음수 좌표로 버튼 밖에 두면 **점이 잘려 보인다**(사진 제보).
     */
    const panel = read('frontend/src/components/OrderStepsPanel.tsx');
    expect(panel).toMatch(/dot: \{[\s\S]{0,120}top: \d+, right: \d+/);
    expect(panel, '음수 좌표는 버튼 밖이라 잘린다').not.toMatch(/dot: \{[\s\S]{0,120}top: -\d/);
    // 버튼이 자르는 성질을 갖고 있다는 전제 자체를 못박는다
    expect(read('frontend/src/styles/buttons.ts')).toMatch(/overflow: 'hidden'/);
  });

  it('🔴 대화 탭은 아래에서 위로 옅어지는 그라데이션 — 통째로 칠하거나 둥글리지 않는다', () => {
    /*
     * 통째로 칠하고 모서리를 둥글게 했더니 그 탭만 다른 부품처럼 튀어 보였다(제보).
     * 밑줄에서 색이 배어 오르는 모양으로 바꾼다. 글자는 본래 색 그대로 둔다 —
     * 흰 글자로 바꾸면 옅어지는 위쪽에서 읽히지 않는다.
     */
    const det = read('frontend/src/components/OrderDetail.tsx');
    expect(det).toMatch(/tabAlert: \{/);
    expect(det).toMatch(/linear-gradient\(to top, var\(--alert-fade\), transparent\)/);
    expect(det, '모서리를 둥글리면 그 탭만 튀어 보인다').not.toMatch(/tabAlert: \{[\s\S]{0,600}borderTopLeftRadius/);
    expect(det, "흰 글자는 옅어지는 위쪽에서 안 보인다").not.toMatch(/tabAlert: \{[\s\S]{0,600}color: '#fff'/);
    expect(det).toMatch(/unreadChat > 0 \? det\.tabAlert/);
    // 위험(--warn)·필수(--req)와 다른 색이어야 「새 소식」과 「위험」이 안 섞인다
    const css = read('frontend/src/styles/globals.css');
    expect(css).toMatch(/--alert: #/);
    expect(css).toMatch(/--alert-fade: rgba/);
  });

  it('🔴 대화 탭을 열면 **서버에서도** 읽음 처리한다 — 안 그러면 나오는 순간 되살아난다', () => {
    /*
     * 화면에서만 끄면 탭을 나오는 순간 다음 조회가 「안 읽음 5건」을 도로 가져온다(실측).
     * 그 탭은 모든 단계의 이야기를 한 줄로 보여 주므로 거기까지 열었으면 본 것이 맞다.
     */
    const svc = read('backend/src/services/step-comments.ts');
    expect(svc).toMatch(/export async function markAllRead/);
    const routes = read('backend/src/routes/steps.ts');
    expect(routes).toMatch(/if \(!incremental\) \{[\s\S]{0,200}markAllRead\(id, req\.auth!\.email\)/);
    // 증분 조회마다 같은 쓰기를 반복하지 않는다
    expect(routes).toMatch(/incremental/);
  });

  it('🔴 단계 탭에서 마지막 대화를 읽는 순간 강조가 꺼진다', () => {
    /*
     * 단계별로 읽어 0 이 되면 그 자리에서 꺼져야 한다. 안 알리면 다음 폴링(15초)까지
     * 다 읽었는데도 강조가 남는다.
     */
    const panel = read('frontend/src/components/OrderStepsPanel.tsx');
    expect(panel).toMatch(/onUnreadChange\?\.\(Object\.values\(u\)\.reduce/);
    expect(read('frontend/src/components/OrderDetail.tsx')).toMatch(/onUnreadChange=\{setUnreadChat\}/);
  });

  it('🔴 대화 탭에 들어가 있는 동안은 켜지 않는다', () => {
    const det = read('frontend/src/components/OrderDetail.tsx');
    // 읽고 있는 것을 「안 읽음」이라 말할 수 없다 — 들어가면 끄고, 묻지도 않는다
    expect(det).toMatch(/if \(tab === 'chat'\) \{ setUnreadChat\(0\); return \}/);
    expect(det).toMatch(/if \(tab === 'chat'\) return/);
  });
});

/**
 * **입력줄은 카카오톡처럼 하나의 상자다.**
 * 첨부 버튼만 따로 작은 네모라 입력칸과 높이가 안 맞아 혼자 떠 보였다(제보).
 */
describe('대화 입력줄', () => {
  const composer = () => read('frontend/src/components/ChatComposer.tsx');

  it('🔴 두 대화 화면이 **같은 입력줄**을 쓴다', () => {
    // 따로 두었더니 한쪽만 고쳐지는 자리가 생겼다(첨부 버튼 모양이 그랬다)
    for (const f of ['frontend/src/components/StepChat.tsx',
                     'frontend/src/components/OrderChatTab.tsx']) {
      expect(codeOnly(read(f)), f).toMatch(/<ChatComposer/);
    }
  });

  it('🔴 테두리는 바깥 상자 하나 — 첨부·입력·보내기가 그 안에 있다', () => {
    const src = composer();
    expect(src).toMatch(/box: \{[\s\S]{0,200}border: 'var\(--hairline\)'/);
    // 입력칸 자신은 테두리를 갖지 않는다 — 상자가 입력칸처럼 보이는 역할을 한다
    expect(src).toMatch(/area: \{[\s\S]{0,200}border: 'none'/);
    // 글이 길어져도 첨부·보내기는 바닥에 남는다
    expect(src).toMatch(/box: \{[\s\S]{0,120}alignItems: 'flex-end'/);
  });

  it('🔴 모바일 4.5줄 · PC 8.5줄까지만 자란다', () => {
    /*
     * `.5` 는 일부러다 — 맨 윗줄이 반쯤 걸쳐 보여야 「위에 더 있다」가 읽힌다.
     * 실측: 모바일 115px(줄높이 25.9) · PC 181px(줄높이 19.6) 에서 멈추고 스크롤이 켜졌다.
     */
    const src = composer();
    expect(src).toMatch(/const MAX_LINES_MOBILE = 4\.5/);
    expect(src).toMatch(/const MAX_LINES_DESKTOP = 8\.5/);
  });

  it('🔴 최대 높이를 픽셀로 못 박지 않는다 — 글꼴이 기기마다 다르다', () => {
    /*
     * 손가락 기기 18.5px(확대 방지) · PC 14px 이라 줄 높이가 다르다.
     * 숫자로 적어 두면 한쪽에서만 맞는다 — 그때의 줄 높이를 재서 계산한다.
     */
    const src = composer();
    expect(src).toMatch(/parseFloat\(cs\.lineHeight\)/);
    expect(src).toMatch(/line \* \(isMobile \? MAX_LINES_MOBILE : MAX_LINES_DESKTOP\)/);
  });

  it('🔴 한도에 닿았을 때만 스크롤을 켠다', () => {
    // 늘 켜 두면 짧은 글에서도 막대 자리가 생긴다
    expect(composer()).toMatch(/overflowY = el\.scrollHeight > max \? 'auto' : 'hidden'/);
  });

  it('🔴 보낸 뒤 비워지면 다시 한 줄로 줄어든다', () => {
    // 값이 바뀌는 경로가 onChange 만은 아니다(전송 후 초기화)
    expect(composer()).toMatch(/useEffect\(grow, \[text, isMobile\]\)/);
  });

  it('🔴 「대화」 탭의 단계 고르기는 그대로 있다', () => {
    // 입력줄을 공용으로 바꾸며 함께 지워진 적이 있다 — 무엇에 대한 글인지 못 고르면 못 쓴다
    const tab = read('frontend/src/components/OrderChatTab.tsx');
    expect(tab).toMatch(/<select style=\{s\.pick\}/);
    expect(tab).toMatch(/setStep\(e\.target\.value\)/);
  });
});
