import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **역할이 여럿인 계정의 화면 전환 토글** — 휴대폰에서 한 줄 안에, 제 크기로.
 *
 * 두 번 헛짚었다.
 *  1. 한 줄에 로고·워드마크·토글·이름·로그아웃을 다 넣었더니 토글이 70px 로 눌려
 *     칸마다 35px 이 됐다(사진 제보).
 *  2. 그래서 줄을 통째로 내줬더니 헤더가 60 → 116px 이 되어 화면을 너무 먹었고
 *     (「공간 차지가 너무 심하다」), 남는 폭을 채우게 했더니 칸 하나가 화면 절반이 됐다
 *     (「토글버튼 자체가 너무 큼」).
 *
 * 답은 **없어도 되는 것을 접는 것**이었다 — 워드마크와 계정 이름. 그러면 토글이 제 크기로
 * 설 자리가 난다. 넓히지도 줄이지도 않는다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const HEADER = readFileSync(path.join(ROOT, 'frontend/src/components/Header.tsx'), 'utf8');

describe('휴대폰 화면 전환 토글', () => {
  it('🔴 제 줄을 통째로 차지하지 않는다', () => {
    expect(HEADER, '헤더가 두 줄이 된다').not.toMatch(/flexBasis: '100%'/);
  });

  it('🔴 남는 폭을 채우게 하지 않는다 — 글자 몇 자짜리 버튼이다', () => {
    expect(HEADER, '칸 하나가 화면 절반을 먹는다').not.toMatch(/fullWidth=\{isMobile\}/);
    expect(HEADER).not.toMatch(/flex: 1, minWidth: 0/);
  });

  it('🔴 좁다고 글자를 줄이지 않는다', () => {
    // size="sm" 은 「한 줄에 어떻게든 넣어 보려던」 시절의 흔적이다
    expect(HEADER).not.toMatch(/size=\{isMobile \? 'sm' : undefined\}/);
  });

  it('자리를 내주려고 워드마크와 계정 이름을 접는다', () => {
    expect(HEADER, '워드마크를 접지 않는다').toMatch(/\{!isMobile && \(/);
    expect(HEADER, '계정 이름을 접지 않는다').toMatch(/!\(isMobile && mySurfaces\.length > 1\)/);
  });

  it('역할이 하나면 토글 자체가 없다', () => {
    expect(HEADER).toMatch(/mySurfaces\.length > 1 && \(/);
  });
});

describe('배정 팝업 고르는 칸', () => {
  const ADMIN = readFileSync(path.join(ROOT, 'frontend/src/pages/AdminPage.tsx'), 'utf8');

  it('🔴 앱 공통 컨트롤 규칙을 따른다 — 세로 패딩으로 높이를 정하지 않는다', () => {
    /*
     * ⚠️ **어느 스타일 객체의 것인지까지 짚는다.** 이 파일에는 `select` 라는 이름의 칸이
     *    둘 있다 — 배정 팝업(`modal`)과 견적 목록 좁히는 줄(`qt`). 이름만으로 찾았더니
     *    엉뚱한 쪽을 집어 **멀쩡한 코드에서 실패**했다.
     */
    const objStart = ADMIN.indexOf('const modal: Record<string, React.CSSProperties> = {');
    expect(objStart, '배정 팝업 스타일 객체가 없다').toBeGreaterThan(0);
    const i = ADMIN.indexOf('\n  select: {\n', objStart);
    expect(i).toBeGreaterThan(0);
    const decl = ADMIN.slice(i, ADMIN.indexOf('\n  },', i));
    expect(decl).toContain("fontSize: 'var(--fs-input)'");
    expect(decl).toContain("minHeight: 'var(--h-control)'");
    expect(decl).toContain("padding: '0 12px'");
    expect(decl, '세로 패딩이 되살아났다').not.toMatch(/padding: '\d+px \d+px'/);
  });
});
