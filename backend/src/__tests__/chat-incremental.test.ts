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

  it('🔴 대화 탭은 버튼째 칠한다 — 크기·자리는 다른 탭과 같게', () => {
    const det = read('frontend/src/components/OrderDetail.tsx');
    expect(det).toMatch(/tabAlert: \{/);
    expect(det).toMatch(/background: 'var\(--alert\)'/);
    expect(det).toMatch(/unreadChat > 0 \? det\.tabAlert/);
    // 위험(--warn)·필수(--req)와 다른 색이어야 「새 소식」과 「위험」이 안 섞인다
    const css = read('frontend/src/styles/globals.css');
    expect(css).toMatch(/--alert: #/);
  });

  it('🔴 대화 탭에 들어가 있는 동안은 켜지 않는다', () => {
    const det = read('frontend/src/components/OrderDetail.tsx');
    // 읽고 있는 것을 「안 읽음」이라 말할 수 없다 — 들어가면 끄고, 묻지도 않는다
    expect(det).toMatch(/if \(tab === 'chat'\) \{ setUnreadChat\(0\); return \}/);
    expect(det).toMatch(/if \(tab === 'chat'\) return/);
  });
});
