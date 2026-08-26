import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **거부**(특장사) 와 **치우기**(관리자) — 둘 다 사유가 필수다.
 *
 * ⚠️ 「치우기」는 **행을 지우지 않는다.** 상태로 남긴다 —
 *    누가 언제 왜 치웠는지가 사라지면 나중에 아무도 설명하지 못한다.
 *    (견적 삭제가 서명된 계약까지 연쇄로 지운 사고 이후의 규칙 — CLAUDE.md)
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const ORDERS = read('backend/src/routes/orders.ts');

const slice = (from: string, to: string) => ORDERS.slice(ORDERS.indexOf(from), ORDERS.indexOf(to));
const REJECT = slice("'/:id/reject'", "'/:id/cancel'");
const CANCEL = slice("'/:id/cancel'", '// ── PATCH /orders/:id/accept');

describe('특장사 주문 거부', () => {
  it('🔴 사유가 없으면 거부되지 않는다', () => {
    // 「왜 안 받았는지」가 없으면 다시 배정할 수도, 고칠 수도 없다
    expect(REJECT).toMatch(/거부 사유를 적어야 합니다/);
    expect(REJECT).toMatch(/if \(!reason\)/);
  });

  it('배정 상태에서만 — 이미 수락해 제작이 도는 건은 거부가 아니다', () => {
    expect(REJECT).toMatch(/status !== 'assigned'/);
  });

  it('자기 조직 것만 거부한다', () => {
    expect(REJECT).toContain('ownOrgOnly');
  });

  it('🔴 배정을 풀어 다시 맡길 수 있게 한다', () => {
    // 거부만 하고 배정이 남으면 그 특장사에 계속 걸려 있다
    expect(REJECT).toMatch(/maker_org_id: null/);
    expect(REJECT).toMatch(/setQuoteStatus\(order\.quote\.id, 'contracted'/);
  });
});

describe('관리자 주문 치우기', () => {
  it('🔴 행을 지우지 않는다 — 상태로 남긴다', () => {
    expect(CANCEL).toMatch(/canceled_at: new Date\(\)/);
    expect(CANCEL).not.toMatch(/order\.delete|deleteMany/);
  });

  it('🔴 누가 언제 왜 치웠는지가 남는다', () => {
    for (const f of ['canceled_at', 'canceled_by', 'cancel_reason']) expect(CANCEL, f).toContain(f);
  });

  it('사유가 없으면 치워지지 않는다', () => {
    expect(CANCEL).toMatch(/치우는 사유를 적어야 합니다/);
  });

  it('🔴 수락 대기·진행중까지만 — 인도가 끝난 건은 이미 일어난 거래다', () => {
    expect(CANCEL).toMatch(/!== 'assigned' && order\.quote\.status !== 'ordered'/);
  });

  it('🔴 권한은 계정별 기능모듈로 — 관리자라고 다 되지 않는다', () => {
    const decl = ORDERS.slice(ORDERS.indexOf("'/:id/cancel'"), ORDERS.indexOf("'/:id/cancel'") + 200);
    expect(decl).toContain("rbac('ADMIN')");
    expect(decl).toContain("requirePermission('order.remove')");
  });

  it('두 번 치우지 않는다', () => {
    expect(CANCEL).toMatch(/if \(order\.canceled_at\)/);
  });
});

describe('치운 주문은 일감 목록에서 빠진다', () => {
  it('🔴 목록 조회가 걸러 낸다 — 안 그러면 치운 뜻이 없다', () => {
    expect(ORDERS).toMatch(/const where: Prisma\.OrderWhereInput = \{ canceled_at: null \}/);
  });
});

describe('기능모듈·migration', () => {
  const SQL = read('backend/prisma/migrations/20260826010000_order_reject_and_cancel/migration.sql');

  it('더하기만 한다 — 기존 열을 지우거나 바꾸지 않는다', () => {
    const statements = SQL.replace(/--.*$/gm, '').split(';').map(x => x.trim()).filter(Boolean);
    for (const st of statements) {
      expect(st, st.slice(0, 60)).toMatch(/^(ALTER TABLE "order" ADD COLUMN IF NOT EXISTS|INSERT INTO "feature_module")/);
    }
    expect(SQL).toMatch(/ON CONFLICT \("code"\) DO NOTHING/);
  });

  it('권한 기본값을 만들지 않는다 — 켜야 쓸 수 있다', () => {
    expect(SQL.replace(/--.*$/gm, '')).not.toMatch(/INSERT\s+INTO\s+"?access_control"?/i);
  });

  it('새 환경을 위해 seed 에도 있다', () => {
    expect(read('db/seed/feature_module.csv')).toContain('order.remove');
  });
});

describe('화면', () => {
  const MODAL = read('frontend/src/components/AcceptOrderModal.tsx');
  const ADMIN = read('frontend/src/pages/AdminPage.tsx');

  it('거부는 사유를 적어야 눌린다', () => {
    expect(MODAL).toMatch(/disabled=\{!reason\.trim\(\) \|\| busy\}/);
  });

  it('치우기 버튼은 권한이 있을 때만 뜬다', () => {
    expect(ADMIN).toMatch(/const canRemove = usePermission\('order\.remove'\)/);
    expect(ADMIN).toMatch(/\{canRemove && removable &&/);
  });

  it('치우기도 사유를 적어야 눌린다', () => {
    expect(ADMIN).toMatch(/disabled=\{!reason\.trim\(\) \|\| busy\}/);
  });
});
