import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isAssignRecipient } from '../services/notify.js';

/**
 * **배정을 기다리는 건이 생기면 반드시 알린다.**
 *
 * 실제로 이런 일이 있었다 — 서면계약 스캔본을 올려 계약완료가 됐는데 아무에게도
 * 메일이 가지 않았다(화이트축산 건). 원인이 둘이었다.
 *
 *  1. 알림이 **전자서명 완료 경로에만** 매달려 있었다. 계약완료로 오는 길은 네 갈래인데
 *     (전자서명 · 스캔본 등록 · 특장사 거부 · 주문 취소) 나머지 셋은 그냥 지나갔다.
 *  2. 알림 토글을 아무도 켜 두지 않으면 **아무에게도** 안 간다. 그런데 그 사실이
 *     화면에 드러나지 않아, 서버 로그를 열기 전에는 알 방법이 없었다.
 *
 * 1번은 「부르는 곳을 늘리는」 방식으로는 또 빠진다. 상태가 바뀌는 한 곳에 걸었다.
 * 2번은 마스터를 늘 받게 해서, 「아무에게도 안 갔다」가 성립하지 않게 했다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const MODULE = 'notify.assign';

const user = (over: Partial<Parameters<typeof isAssignRecipient>[0]> = {}) =>
  ({ email: 'a@x.com', role: 'ADMIN', extra_roles: [] as string[], ...over });
const ac = (subject_type: string, subject_ref: string, enabled: boolean) =>
  ({ subject_type, subject_ref, module_code: MODULE, enabled });

describe('누가 배정 알림을 받는가', () => {
  it('토글을 켠 계정이 받는다', () => {
    expect(isAssignRecipient(user(), [ac('user', 'a@x.com', true)])).toBe(true);
  });

  it('켜지 않은 계정은 받지 않는다 — 관리자여도', () => {
    expect(isAssignRecipient(user(), [])).toBe(false);
  });

  it('🔴 마스터는 아무 설정이 없어도 받는다', () => {
    /*
     * 이게 없으면 「아무도 안 켜 둠 → 아무에게도 안 감 → 아무도 모름」이 다시 성립한다.
     * 실제로 그렇게 방치된 건이 있었다.
     */
    expect(isAssignRecipient(user({ is_master: true }), [])).toBe(true);
  });

  it('🔴 마스터는 토글을 꺼도 받는다', () => {
    // 실수로 껐다고 최후의 수신자가 사라지면 안 된다
    expect(isAssignRecipient(user({ is_master: true }), [ac('user', 'a@x.com', false)])).toBe(true);
  });

  it('마스터가 아닌 계정은 역할로 켜면 받는다', () => {
    expect(isAssignRecipient(user(), [ac('role', 'ADMIN', true)])).toBe(true);
    expect(isAssignRecipient(user({ email: 'b@x.com' }), [ac('role', 'ADMIN', true)])).toBe(true);
  });
});

describe('알림을 내는 자리', () => {
  const STATUS = read('backend/src/services/quote-status.ts');
  const CONTRACT = read('backend/src/services/contract.ts');
  const PUBLIC = read('backend/src/routes/public.ts');

  it('🔴 계약완료 전이 한 곳에서 낸다 — 경로마다 챙기지 않는다', () => {
    expect(STATUS).toMatch(/if \(next === 'contracted'\) void notifyAssignNeeded\('maker', quoteId\)/);
  });

  it('🔴 전자서명 경로가 따로 부르지 않는다 — 그래야 다른 경로도 함께 산다', () => {
    /*
     * 여기서 부르기 시작하면 「이 경로는 챙겼으니 됐다」가 되고,
     * 스캔본·거부·취소는 다시 조용해진다.
     */
    expect(CONTRACT).not.toContain('notifyContractSigned');
    expect(CONTRACT).not.toContain('notifyAssignNeeded');
  });

  it('공개 문의 접수는 영업 배정 알림을 낸다', () => {
    expect(PUBLIC).toMatch(/notifyAssignNeeded\('sales', quote\.id\)/);
  });

  it('계약완료로 가는 네 경로가 모두 이 문을 지난다', () => {
    // 하나라도 status 를 직접 쓰면 알림을 건너뛴다
    const paths = [
      'backend/src/services/contract.ts',   // 전자서명 · 스캔본 등록
      'backend/src/routes/orders.ts',       // 특장사 거부 · 주문 취소
    ];
    for (const rel of paths) {
      const src = read(rel);
      expect(src, `${rel} 가 상태를 직접 씀`).not.toMatch(/data:\s*\{\s*status:\s*'contracted'/);
      expect(src).toContain("setQuoteStatus");
    }
  });
});

describe('알림 내용', () => {
  const NOTIFY = read('backend/src/services/notify.ts');

  it('메일과 앱 알림을 함께 보낸다', () => {
    expect(NOTIFY).toContain('pushNotify');
    expect(NOTIFY).toContain('pushAllowed');
  });

  it('🔴 메일 설정이 없어도 앱 알림은 나간다', () => {
    /*
     * 예전 구조는 SMTP 가 없으면 함수 첫머리에서 그냥 돌아갔다 — 앱 알림까지 함께 죽는다.
     * 「앞에 transport() 관문이 하나도 없을 것」으로 본다. 이름만 바꿔 끼워 넣어도 걸린다.
     */
    const fn = NOTIFY.slice(NOTIFY.indexOf('export async function notifyAssignNeeded'));
    const beforePush = fn.slice(0, fn.indexOf('pushNotify'));
    expect(beforePush, 'SMTP 관문이 앱 알림보다 앞에 있다').not.toContain('transport()');
  });

  it('알림을 누르면 관리자 견적 목록으로 간다 — 배정 버튼이 있는 곳', () => {
    expect(NOTIFY).toMatch(/const ASSIGN_LINK = '\/admin'/);
    expect(NOTIFY).toMatch(/url: ASSIGN_LINK/);
  });

  it('같은 건이 여러 번 쌓이지 않는다', () => {
    expect(NOTIFY).toMatch(/tag: `assign-\$\{kind\}-\$\{quote\.id\}`/);
  });
});
