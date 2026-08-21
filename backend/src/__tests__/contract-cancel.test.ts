import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **발송 취소** — 재발송을 여는 유일한 문.
 *
 * 재발송은 `DRAFT·REJECTED·CANCELED` 일 때만 열린다. 고객이 끝내 서명하지 않은 건은
 * `SENT` 에 남아 **다시 보낼 방법이 없었다**(실제로 8/18 발송분이 그렇게 묶였다).
 *
 * 여기서 지키는 것은 「취소가 된다」가 아니라 **「취소되면 안 되는 것이 안 된다」**이다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

const SERVICE = read('backend/src/services/contract.ts');
const ROUTE = read('backend/src/routes/contracts.ts');
const MODUSIGN = read('backend/src/services/modusign.ts');

describe('계약 발송 취소', () => {
  it('🔴 서명이 끝난 계약은 취소할 수 없다', () => {
    /*
     * 되돌릴 수 없는 일이다. 그 서명본이 정본이고, 취소되면 계약완료가 풀려
     * 이미 배정된 제작까지 흔들린다. (CLAUDE.md: 서명이 끝난 계약은 절대 지워지지 않는다)
     */
    const fn = SERVICE.slice(SERVICE.indexOf('export async function cancelContract'));
    expect(fn).toContain("contract.status === 'COMPLETED'");
    const guard = fn.slice(fn.indexOf("contract.status === 'COMPLETED'"), fn.indexOf("contract.status === 'COMPLETED'") + 220);
    expect(guard).toContain('ContractError');
  });

  it('🔴 행을 지우지 않는다 — 상태만 바꾼다', () => {
    // 언제 누가 무엇을 보냈는지는 남아야 한다(CLAUDE.md: 행을 지우지 않는다)
    const fn = SERVICE.slice(SERVICE.indexOf('export async function cancelContract'));
    expect(fn).toContain("status: 'CANCELED'");
    expect(fn).not.toMatch(/purchaseContract\.delete/);
    expect(fn).not.toMatch(/deleteMany/);
  });

  it('모두싸인 취소가 실패해도 우리 쪽은 풀린다 — 대신 그 사실을 알린다', () => {
    /*
     * 옛 계정에서 만든 문서는 우리가 손댈 수 없다(403). 거기서 막으면 영영 재발송을 못 한다.
     * 그렇다고 조용히 넘어가면 고객이 옛 링크로 서명해 계약이 둘로 갈린 뒤에야 알게 된다.
     */
    const fn = SERVICE.slice(SERVICE.indexOf('export async function cancelContract'));
    expect(fn).toContain('remote_canceled');
    expect(fn).toMatch(/catch[\s\S]{0,200}remote_canceled\s*=|catch[\s\S]{0,200}console\.error/);
    // 화면이 그 사실을 반드시 띄워야 한다
    const panel = read('frontend/src/components/ContractPanel.tsx');
    expect(panel).toContain('remote_canceled');
    expect(panel).toMatch(/이전 링크가 아직 살아 있을 수 있습니다/);
  });

  it('취소는 발송과 같은 권한을 요구한다', () => {
    // 고객에게 보이는 행동이고 곧바로 재발송이 뒤따른다
    const i = ROUTE.indexOf("'/:id/contract/cancel'");
    expect(i).toBeGreaterThan(-1);
    const line = ROUTE.slice(i, i + 200);
    expect(line).toContain("rbac('ADMIN', 'SALES')");
    expect(line).toContain("requirePermission('doc.send.sign')");
  });

  it('모두싸인 취소는 문서가 정한 주소·형식을 쓴다', () => {
    // POST /documents/{id}/cancel · body { message } (2~200자)
    expect(MODUSIGN).toMatch(/\/documents\/\$\{encodeURIComponent\(documentId\)\}\/cancel/);
    expect(MODUSIGN).toMatch(/\{ message \}/);
    // 실발송 차단 스위치를 존중한다 — 개발 중에 진짜 고객 문서를 취소하면 안 된다
    const fn = MODUSIGN.slice(MODUSIGN.indexOf('export async function cancelDocument'));
    expect(fn.slice(0, 400)).toContain('isDryRun()');
  });

  it('재발송이 열리는 상태에 CANCELED 가 들어 있다', () => {
    // 이게 빠지면 취소해도 여전히 못 보낸다 — 취소의 존재 이유가 사라진다
    expect(SERVICE).toMatch(/\['DRAFT', 'REJECTED', 'CANCELED'\]\.includes\(latest\.status\)/);
  });
});
