import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * 발주서 **임시저장** — 배정 전에 적어 둔 발주서 내용.
 *
 * 적는 사람과 배정을 누르는 사람이 다를 수 있다. 예전엔 배정 팝업을 닫으면 적던 것이
 * 전부 날아가서, 한 사람이 앉은자리에서 다 끝내야 했다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

const QUOTES = read('backend/src/routes/quotes.ts');
const ADMIN = read('frontend/src/pages/AdminPage.tsx');
const SCHEMA = read('backend/prisma/schema.prisma');
const MIGRATION = read('backend/prisma/migrations/20260908010000_add_po_draft/migration.sql');

describe('발주서 임시저장', () => {
  it('소스를 실제로 읽었다', () => {
    expect(QUOTES.length).toBeGreaterThan(1000);
    expect(SCHEMA.length).toBeGreaterThan(1000);
  });

  it('🔴 배정해도 초안을 **지우지 않는다** — 상태로 남긴다', () => {
    /*
     * 누가 적어 둔 것이 배정으로 이어졌는지가 기록이다(CLAUDE.md: 행을 지우지 않는다).
     * 그래도 다시 뜨면 안 되므로 「썼다」고 표시하고, 읽을 때 그 표시를 건너뛴다.
     */
    expect(QUOTES).toMatch(/poDraft\.updateMany\(\{\s*where: \{ quote_id: id, consumed_at: null \},\s*data: \{ consumed_at: now \}/);
    expect(QUOTES, '초안을 지우고 있다').not.toMatch(/poDraft\.delete/);
    // 읽을 때 쓴 것은 없는 것으로 본다 — 없으면 옛 내용이 되살아난다
    expect(QUOTES).toMatch(/poDraft\.findFirst\(\{ where: \{ quote_id: id, consumed_at: null \} \}\)/);
  });

  it('🔴 길이는 배정과 **같은 함수**로 자른다', () => {
    /*
     * 임시저장에서 안 자르면 저장은 됐는데 배정할 때 잘려,
     * 적어 둔 사람과 배정하는 사람이 다른 글을 본다.
     */
    const draft = QUOTES.slice(QUOTES.indexOf("quotesRouter.put('/:id/po-draft'"), QUOTES.indexOf("quotesRouter.patch('/:id/assign'"));
    expect(draft).toMatch(/clampMemo\(remark \?\? ''\)/);
    expect(draft).toMatch(/custom_badge === true && hasAppendix\(appendix\) \? clampAppendix\(appendix!\) : null/);
  });

  it('🔴 권한은 배정과 같다', () => {
    /*
     * 적어 둘 수 있는 사람과 배정할 수 있는 사람이 다르면,
     * 적어는 뒀는데 **아무도 못 누르는** 초안이 쌓인다.
     */
    for (const m of ["get('/:id/po-draft'", "put('/:id/po-draft'"]) {
      const decl = QUOTES.slice(QUOTES.indexOf(m), QUOTES.indexOf(m) + 200);
      expect(decl, m).toContain("rbac('ADMIN')");
      expect(decl, m).toContain("requirePermission('order.confirm')");
    }
  });

  it('🔴 이미 배정된 건에는 적어 둘 수 없다', () => {
    // 발주서는 이미 나갔다 — 고칠 곳은 초안이 아니다
    expect(QUOTES).toMatch(/quote\.status === 'assigned' \|\| quote\.status === 'ordered' \|\| quote\.status === 'completed'/);
  });

  it('🔴 적어 둔 것을 불러오는 일은 **팝업을 열 때 한 번**이다', () => {
    /*
     * 사람이 이미 고치기 시작한 뒤에 덮어쓰면 적던 글이 사라진다.
     * 그래서 이 효과는 `quoteId` 에만 매여 있어야 한다 — 값들이 의존성에 끼면
     * 한 글자 칠 때마다 다시 불러와 방금 친 글자를 지운다.
     */
    const eff = ADMIN.slice(ADMIN.indexOf('fetchPoDraft(quoteId)'));
    const dep = eff.slice(0, eff.indexOf('}, [') + 40);
    expect(dep, '의존성에 quoteId 말고 다른 값이 끼었다').toMatch(/\}, \[quoteId\]\)/);
  });

  it('🔴 특장사를 못 골라도 저장된다', () => {
    // 고르는 것은 배정의 조건이지 적어 두는 것의 조건이 아니다
    expect(ADMIN).toMatch(/disabled=\{saving \|\| loading\}/);
    expect(ADMIN, '특장사 선택을 임시저장의 조건으로 걸었다')
      .not.toMatch(/disabled=\{[^}]*!selected[^}]*\}\s*\n\s*onClick=\{\(\) => void saveDraft\(\)\}/);
  });

  it('🔴 표를 **더하기만** 했다 — 기존 표·컬럼을 건드리지 않는다', () => {
    /*
     * `quote` 에 컬럼을 더하면 운영 DB 에 그 컬럼이 없을 때 Prisma 가 `quote` 를 읽는
     * **모든** 기능을 P2022 로 죽인다(2026-08-18 사고). 새 표는 없더라도 이 기능만 멈춘다.
     */
    expect(MIGRATION).toMatch(/CREATE TABLE IF NOT EXISTS "po_draft"/);
    expect(MIGRATION, 'quote 를 고치고 있다').not.toMatch(/ALTER TABLE "quote"/);
    for (const bad of ['DROP TABLE', 'DROP COLUMN', 'ALTER COLUMN', 'TRUNCATE', 'DELETE FROM']) {
      expect(MIGRATION, bad).not.toContain(bad);
    }
    // 스키마와 migration 이 같은 표를 말한다
    expect(SCHEMA).toMatch(/model PoDraft \{/);
    expect(SCHEMA).toMatch(/@@map\("po_draft"\)/);
  });
});
