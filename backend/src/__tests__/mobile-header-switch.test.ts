import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **역할이 여럿인 계정의 화면 전환 토글** — 휴대폰에서 제 줄을 차지한다.
 *
 * 한 줄에 로고·토글·이름·로그아웃을 다 넣었더니 토글이 70px 로 눌려 칸마다 35px 이 됐고,
 * 이름과 맞붙어 어디까지가 버튼인지 알 수 없었다(사진 제보 — 역할 셋인 마스터에서 특히 심하다).
 * 줄을 하나 내주니 칸이 114px 이 됐다(실측).
 *
 * ⚠️ 「글자를 줄여서」 맞추는 방식으로 되돌아가지 말 것 — 그게 원래 하던 것이고, 그래서 깨졌다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const HEADER = readFileSync(path.join(ROOT, 'frontend/src/components/Header.tsx'), 'utf8');

describe('휴대폰 화면 전환 토글', () => {
  it('🔴 제 줄을 차지한다', () => {
    expect(HEADER).toMatch(/order: 1, flexBasis: '100%'/);
  });

  it('🔴 좁은 자리에 우겨넣으려 글자를 줄이지 않는다', () => {
    // size="sm" 은 「한 줄에 어떻게든 넣어 보려던」 시절의 흔적이다
    expect(HEADER).not.toMatch(/size=\{isMobile \? 'sm' : undefined\}/);
    expect(HEADER).toMatch(/fullWidth=\{isMobile\}/);
  });

  it('토글이 있다고 워드마크를 감추지 않는다', () => {
    /*
     * 예전엔 자리가 없어 워드마크를 접었다. 토글이 제 줄로 내려가면서 첫 줄에
     * 자리가 생겼으므로 되살렸다 — 접을 이유가 사라졌다.
     */
    expect(HEADER).not.toMatch(/!\(isMobile && mySurfaces\.length > 1\)/);
  });

  it('역할이 하나면 토글 자체가 없다', () => {
    // 고를 것이 없는 토글은 자리만 차지하고 「뭔가 더 있나」 하고 누르게 만든다
    expect(HEADER).toMatch(/mySurfaces\.length > 1 && \(/);
  });
});

describe('배정 팝업 고르는 칸', () => {
  const ADMIN = readFileSync(path.join(ROOT, 'frontend/src/pages/AdminPage.tsx'), 'utf8');

  it('🔴 앱 공통 컨트롤 규칙을 따른다 — 세로 패딩으로 높이를 정하지 않는다', () => {
    /*
     * 여기만 글꼴 14px 과 세로 패딩 10px 을 박아 두어 공통 규칙에서 빠져 있었다.
     * 높이를 정하는 주체가 둘(최소높이 · 세로 패딩)이면 서로 다투고, 밀려나는 건 글자다
     * — 휴대폰에서 「선택하세요」가 잘려 보였다(사진 제보).
     */
    const i = ADMIN.indexOf('\n  select: {\n');
    expect(i).toBeGreaterThan(0);
    const decl = ADMIN.slice(i, i + 320);
    expect(decl).toContain("fontSize: 'var(--fs-input)'");
    expect(decl).toContain("minHeight: 'var(--h-control)'");
    expect(decl).toContain("padding: '0 12px'");
    expect(decl, '세로 패딩이 되살아났다').not.toMatch(/padding: '\d+px \d+px'/);
  });
});
