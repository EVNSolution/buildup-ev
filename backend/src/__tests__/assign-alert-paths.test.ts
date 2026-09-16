import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NOTIFY_TOPIC_BY_CODE } from '@buildup-ev/shared/rbac/presets';

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
describe('누가 배정 알림을 받는가 — 자리(프리셋)가 정한다', () => {
  /*
   * 2026-09-16 — 예전에는 기능모듈 하나(notify.assign)로 골랐고, 그 모듈은 **역할을 보지 않아**
   * 특장사·영업 계정에 켜 두면 고객 이름·실구매가가 담긴 메일을 받았다. 이제 자리로 정한다.
   */
  it('🔴 제작 배정 필요 — 영업관리·PM·생산관리·마스터', () => {
    expect(NOTIFY_TOPIC_BY_CODE['assign.maker']!.presets).toEqual(['sales_mgr', 'pm', 'prod_mgr', 'master']);
    expect(NOTIFY_TOPIC_BY_CODE['assign.maker']!.extra).toEqual([]);
  });

  it('🔴 영업 배정 필요 — 영업관리·마스터', () => {
    expect(NOTIFY_TOPIC_BY_CODE['assign.sales']!.presets).toEqual(['sales_mgr', 'master']);
  });

  it('🔴 경영관리는 배정 알림을 받지 않는다 — 보는 자리이지 배정하는 자리가 아니다', () => {
    for (const code of ['assign.maker', 'assign.sales', 'assign.request', 'assign.reject', 'assign.cancel']) {
      expect(NOTIFY_TOPIC_BY_CODE[code]!.presets, code).not.toContain('exec');
    }
  });

  it('🔴 특장사·영업 계정은 자리가 없으면 관리자 알림을 받지 않는다 — 프리셋 목록에 역할이 없다', () => {
    const all = Object.values(NOTIFY_TOPIC_BY_CODE).flatMap(t => t.presets);
    expect(all).not.toContain('SALES');
    expect(all).not.toContain('MAKER');
  });
});

describe('알림을 내는 자리', () => {
  const STATUS = read('backend/src/services/quote-status.ts');
  const CONTRACT = read('backend/src/services/contract.ts');
  const PUBLIC = read('backend/src/routes/public.ts');

  it('🔴 계약완료 전이 한 곳에서 낸다 — 경로마다 챙기지 않는다', () => {
    // 2026-09-15 — 계약완료 전이 한 곳에서 내되, 관리자 알림은 **영업의 배정 요청이 있는 건**만(없으면 영업에게 요청 재촉)
    expect(STATUS).toMatch(/if \(next === 'contracted'\) \{[^]*?if \(q\?\.assign_requested_at\) void notifyAssignNeeded\('maker', quoteId\)/);
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

  it('메일과 앱 알림을 함께 보내고, 받는 사람은 자리(프리셋)가 정한다', () => {
    expect(NOTIFY).toContain('pushNotify');
    expect(NOTIFY).toContain("topicRecipients(kind === 'maker' ? 'assign.maker' : 'assign.sales')");
    // 옛 기능모듈 수신자 판정은 걷어냈다 — 역할을 보지 않아 특장사에게도 갔다
    expect(NOTIFY).not.toContain('adminRecipients(');
  });

  it('🔴 메일 받을 사람이 아무도 없어도 앱 알림은 나간다', () => {
    const fn = NOTIFY.slice(NOTIFY.indexOf('export async function notifyAssignNeeded'));
    const push = fn.indexOf('pushNotify');
    const mailGate = fn.indexOf('if (to.length === 0)');
    expect(push, '앱 알림이 없다').toBeGreaterThan(0);
    expect(push, '메일 받는 사람 확인(없으면 return)이 앱 알림보다 앞에 있다').toBeLessThan(mailGate);
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

  it('알림을 누르면 배정하는 자리로 간다 — 제작 배정은 주문 진행 탭 배정 대기, 영업 배정은 견적 목록(2026-09-14)', () => {
    expect(NOTIFY).toMatch(/const ASSIGN_LINKS: Record<AssignKind, string> = \{ maker: '\/admin\?view=assign', sales: ASSIGN_LINK \}/);
    expect(NOTIFY).toMatch(/const ASSIGN_LINK = '\/admin'/);
    expect(NOTIFY).toMatch(/url: ASSIGN_LINKS\[kind\]/);
    // 메일 링크도 같은 곳
    expect(NOTIFY).toMatch(/\$\{BASE_URL\}\$\{ASSIGN_LINKS\[kind\]\}/);
  });

  it('같은 건이 여러 번 쌓이지 않는다', () => {
    expect(NOTIFY).toMatch(/tag: `assign-\$\{kind\}-\$\{quote\.id\}`/);
  });
});
