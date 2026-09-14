import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * **화면 공통 부품** — 2026-09-14 제보 셋.
 *   ① 달력이 입력칸 아래로만 떠 화면 밖·독 뒤로 잘렸다 → 브라우저 기본 날짜 입력 금지, DateField(위·아래 자리 계산)
 *   ② 뒤로가기 상자가 한 줄을 통째로 차지했다 → BackLink(글자 한 줄 높이, 누르는 자리는 그대로)
 *   ③ 주문 목록 카드에 차량 도착·납기·고객 인도 날짜(없으면 미정), 특장사에게는 고객 인도 없음
 */
const ROOT = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8');
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}
const files = walk(path.join(ROOT, 'frontend/src')).map(p => [path.relative(ROOT, p), readFileSync(p, 'utf8')] as const);

describe('① 날짜 고르기', () => {
  it('🔴 브라우저 기본 날짜 입력을 쓰지 않는다 — 달력 위치를 못 바꿔 화면 아래에서 잘린다', () => {
    const bad = files.filter(([, s]) => /type=["']date["']/.test(s)).map(([f]) => f);
    expect(bad).toEqual([]);
  });

  it('🔴 화면 아래쪽이면 위로 — 달력 아랫변을 칸 윗변에 붙인다(높이와 상관없이 안 겹친다)', () => {
    const df = read('frontend/src/components/ui/DateField.tsx');
    expect(df).toMatch(/\(r\.top \+ r\.height \/ 2\) > vh \* 0\.5/);
    expect(df).toMatch(/\{ left, bottom: vh - r\.top \+ 6 \}/);
    expect(df).toMatch(/createPortal\(popup, document\.body\)/);
  });
});

describe('② 뒤로가기', () => {
  it('🔴 뒤로가기는 BackLink 한 벌 — 이름표에 화살표를 따로 넣지 않는다', () => {
    for (const f of ['frontend/src/components/OrderDetail.tsx', 'frontend/src/components/OrderFilesTab.tsx', 'frontend/src/pages/MyPage.tsx']) {
      expect(read(f), f).toMatch(/<BackLink /);
    }
    expect(read('frontend/src/components/OrderDetail.tsx')).not.toMatch(/backBtn/);
    const bad = files.filter(([f, s]) => !f.endsWith('LoginPage.tsx') && !f.endsWith('QuoteStatusTip.tsx') && /t\('← /.test(s)).map(([f]) => f);
    expect(bad, '화살표를 이름표에 넣은 뒤로가기가 남았다').toEqual([]);
  });

  it('🔴 보이는 높이는 낮추되 누르는 자리는 줄이지 않는다(안쪽 여백 + 같은 크기 음수 바깥 여백)', () => {
    const bl = read('frontend/src/components/ui/BackLink.tsx');
    expect(bl).toMatch(/paddingTop: 12, paddingBottom: 12/);
    expect(bl).toMatch(/marginTop: -12, marginBottom: -12/);
    expect(bl).not.toMatch(/border: '[^n]/);
  });
});

describe('③ 목록 카드 날짜 줄', () => {
  it('🔴 차량 도착·납기는 늘, 고객 인도는 부가작업이 실린 응답(관리자 + 권한)에만 — 없으면 미정', () => {
    const board = read('frontend/src/components/OrderStepsBoard.tsx');
    expect(board).toMatch(/t\('차량 도착'\)/);
    // 끝났으면 실제 날짜, 아니면 예정일, 둘 다 없으면 미정(실제 날짜 규칙은 actual-dates.test.ts)
    expect(board).toMatch(/arrivalShown\.value \? shortDate\(arrivalShown\.value\) : t\('미정'\)/);
    expect(board).toMatch(/dueShown\.value \? shortDate\(dueShown\.value\) : t\('미정'\)/);
    expect(board).toMatch(/\{o\.addon !== undefined && \(\(\) => \{/);
  });
});
