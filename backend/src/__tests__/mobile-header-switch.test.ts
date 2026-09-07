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

  it('자리를 내주려고 워드마크를 접는다', () => {
    expect(HEADER, '워드마크를 접지 않는다').toMatch(/\{!isMobile && \(/);
  });

  it('🔴 계정 이름은 접지 말고 줄인다', () => {
    /*
     * 예전엔 휴대폰 + 겸직 계정일 때 계정 이름을 **아예 감췄다**(`!(isMobile && mySurfaces.length > 1)`).
     * 자리를 내주려던 것인데, 이름이 **마이페이지로 들어가는 유일한 길**이 되면서
     * 휴대폰에서 언어·비밀번호 설정에 닿을 방법이 사라졌다.
     *
     * 지켜야 할 것은 「감춘다」가 아니라 **헤더가 한 줄로 남는다** 였다. 그래서 고객 칩과
     * 같은 방식으로 바꿨다 — 자리가 모자라면 사라지는 게 아니라 '…' 로 줄어든다.
     * 375px 실측: 헤더 66px 한 줄, 가로로 새어 나가는 것 0.
     */
    expect(HEADER, '이름을 도로 감췄다 — 휴대폰에서 마이페이지에 닿을 수 없게 된다')
      .not.toMatch(/!\(isMobile && mySurfaces\.length > 1\)/);
    const i = HEADER.indexOf('userInfo: {');
    expect(i, 'userInfo 스타일이 사라졌다').toBeGreaterThan(0);
    const style = HEADER.slice(i, i + 400);
    expect(style, '줄어들지 못하면 헤더를 밀어 두 줄로 만든다').toMatch(/flexShrink: 1/);
    expect(style).toMatch(/minWidth: 0/);
  });

  it('🔴 마이페이지로 가는 길이 있다', () => {
    // 언어·비밀번호·로그아웃이 전부 마이페이지에만 있다 — 길이 끊기면 로그아웃도 못 한다
    expect(HEADER, '계정 이름이 마이페이지로 가지 않는다').toMatch(/navigate\('\/me'/);
    // 온 자리를 실어 보내야 마이페이지의 「뒤로」가 제자리로 되돌린다
    expect(HEADER, '어디서 왔는지를 넘기지 않는다').toMatch(/state: \{ from: location\.pathname \}/);
  });

  it('🔴 로그아웃은 최상단바가 아니라 마이페이지에 있다', () => {
    /*
     * 하루에 한 번 누를까 말까 한 동작이 이 줄에서 늘 자리를 차지했고, 휴대폰에서는
     * 그 폭이 화면 전환 토글을 눌렀다(이 파일 맨 위 사고 기록 1번이 바로 그것이다).
     * 계정에 딸린 동작은 계정 화면에 둔다.
     *
     * 375px 실측: 헤더 한 줄 66px · 새어 나감 0 · 전환 토글 123px 로 회복.
     */
    expect(HEADER, '로그아웃이 최상단바로 돌아왔다').not.toMatch(/logout\(\)/);
    const my = readFileSync(
      path.resolve(__dirname, '../../../frontend/src/pages/MyPage.tsx'), 'utf8',
    );
    expect(my, '마이페이지에 로그아웃이 없다 — 나갈 길이 사라진다').toMatch(/await logout\(\)/);
    expect(my, '로그아웃 뒤 홈으로 보내지 않는다').toMatch(/navigate\('\/', \{ replace: true \}\)/);
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
