import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **메일로 무엇을 보냈는지 남긴다** — 견적서만인지, 계약서까지인지.
 *
 * 「그 고객에게 계약서까지 보냈던가?」를 사람 기억에 맡기면 두 번 보내거나 안 보낸다.
 * 어느 판을 보냈는지 가리도록 **견적번호와 날짜**를 함께 남긴다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

describe('발송 기록', () => {
  const ROUTE = read('backend/src/routes/email.ts');

  it('보낼 때마다 남긴다 — 무엇을·어디로·언제·누가', () => {
    expect(ROUTE).toContain('quoteEmailLog.create');
    for (const f of ['quote_no', 'to_email', 'with_contract', 'attachments', 'sent_by']) {
      expect(ROUTE, f).toContain(f);
    }
  });

  it('🔴 기록이 실패해도 발송은 성공으로 응답한다', () => {
    /*
     * 발송은 이미 끝난 일이다. 여기서 던지면 「보냈는데 실패했다」로 보여 다시 보내게 되고,
     * 고객이 같은 메일을 두 번 받는다.
     */
    const i = ROUTE.indexOf('quoteEmailLog.create');
    const around = ROUTE.slice(Math.max(0, i - 600), i + 700);
    expect(around).toContain('catch');
    expect(around).toMatch(/발송은 완료/);
    // 기록 뒤에 응답이 나가야 한다
    expect(ROUTE.indexOf('res.json({ data: { to: r.to')).toBeGreaterThan(i);
  });

  it('조회는 최신순으로, 발송과 같은 권한을 요구한다', () => {
    const i = ROUTE.indexOf("'/:id/email-log'");
    expect(i).toBeGreaterThan(-1);
    const decl = ROUTE.slice(i, i + 220);
    expect(decl).toContain("rbac('ADMIN', 'SALES')");
    expect(decl).toContain("requirePermission('doc.send.email')");
    expect(ROUTE.slice(i, i + 600)).toContain("orderBy: { sent_at: 'desc' }");
  });

  it('표는 더하기만 한다 — 기존 것을 건드리지 않는다', () => {
    const sql = read('backend/prisma/migrations/20260826000000_add_quote_email_log/migration.sql');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "quote_email_log"/);
    /*
     * 「구문의 시작」만 본다. 외래키의 `ON DELETE RESTRICT` 는 지우는 명령이 아니라
     * **지우지 못하게 막는 선언**이다 — 단어만 보면 그것까지 걸린다.
     */
    const statements = sql.replace(/--.*$/gm, '').split(';').map(x => x.trim()).filter(Boolean);
    const destructive = statements.filter(x => /^(DROP|DELETE|TRUNCATE|UPDATE|ALTER)\b/i.test(x));
    expect(destructive, `파괴적 구문: ${destructive.join(' | ')}`).toEqual([]);
  });
});

describe('메일 전달 팝업', () => {
  const SALES = read('frontend/src/pages/SalesPage.tsx');
  const MODAL = read('frontend/src/components/EmailSendModal.tsx');

  it('🔴 고객 메일이 없어도 버튼이 열린다 — 팝업에서 적어 보낸다', () => {
    // 견적서는 메일 없이도 만들어진다. 메일이 없다고 발송 자체를 막을 이유가 없다.
    const i = SALES.indexOf('메일 전달');
    const around = SALES.slice(Math.max(0, i - 900), i);
    expect(around).not.toMatch(/disabled=\{!q\.customer\?\.email\}/);
    expect(around).toMatch(/defaultTo: q\.customer\?\.email/);
  });

  it('받는 사람이 비면 발송이 잠긴다', () => {
    expect(MODAL).toMatch(/disabled=\{sending \|\| !to\.trim\(\)\}/);
  });

  it('이력에 견적번호와 날짜가 함께 나온다 — 어느 판을 보냈는지 가린다', () => {
    const LOG = read('frontend/src/components/EmailLog.tsx');
    expect(LOG).toContain('r.quoteNo');
    expect(LOG).toContain('r.sentAt');
    expect(LOG).toMatch(/견적서\+계약서/);
    expect(LOG).toMatch(/견적서만/);
  });

  it('영업은 발송 팝업에서, 관리자는 조회 팝업에서 같은 이력을 본다', () => {
    // 목록에 열을 더하지 않는다 — 「보냈나」는 보낼 때 궁금한 것이다
    expect(MODAL).toContain('<EmailLog rows={log} />');
    expect(read('frontend/src/components/CustomerViewModal.tsx')).toContain('<EmailLogFor quoteId={quote.id} />');
  });
});
