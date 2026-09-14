import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **날짜 띠** — 차량 도착 · 납기 · 고객 인도를 한 줄 세 칸에(2026-09-14 지시, 예전엔 세 줄).
 *   · 날짜는 「10/13」 — 올해가 아니면 연도를 붙인다
 *   · 고객 인도 칸은 관리자 + addon.manage 만 — 특장사 화면에는 칸 자체가 없다
 *   · 칸 높이는 최소 — 입력 줄은 칸을 눌렀을 때만 열린다
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');

describe('날짜 표시', () => {
  it('🔴 10/13 — 앞자리 0 없이, 올해가 아니면 연도를 붙인다', async () => {
    const { shortDate } = await import('../../../frontend/src/lib/shortDate');
    const now = new Date('2026-09-14T09:00:00');
    expect(shortDate('2026-10-13', now)).toBe('10/13');
    expect(shortDate('2026-09-02', now)).toBe('9/2');
    expect(shortDate('2027-01-05', now)).toBe('2027/1/5');
    expect(shortDate(null, now)).toBe('');
  });
});

describe('화면 규칙', () => {
  const detail = read('frontend/src/components/OrderDetail.tsx');
  const strip = read('frontend/src/components/DateStrip.tsx');

  it('🔴 주문 상세 날짜는 띠 하나 — 예전 한 줄씩 세 줄 컴포넌트는 없다', () => {
    expect(detail).toMatch(/<DateStrip/);
    expect(detail).not.toMatch(/CarArrivalRow|DeliveryDueRow|AddonTargetRow/);
    expect(read('frontend/src/components/AcceptOrderModal.tsx')).toMatch(/<DateStrip/);
  });

  it('🔴 고객 인도 칸은 부가작업 권한이 있을 때만 — 특장사 화면(makerView)은 권한 계산에서 빠진다', () => {
    expect(detail).toMatch(/target=\{canAddon\}/);
    expect(detail).toMatch(/const canAddon = usePermission\('addon\.manage'\) && isAdmin && !makerView/);
    expect(strip).toMatch(/\.\.\.\(target \? \[/);
  });

  it('🔴 칸은 얇게 — 세로 여백 최소, 입력 줄은 누른 칸만', () => {
    const cell = strip.slice(strip.indexOf('  cell: {'), strip.indexOf('  cellDivider:'));
    expect(cell).toMatch(/padding: '3px 10px'/);
    expect(strip).toMatch(/\{current && \(/);
  });
});
