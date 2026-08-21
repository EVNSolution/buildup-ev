import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * **새로고침은 탭 줄 오른쪽 끝에 있고, 컨피규레이터 말고는 어디서나 뜬다.**
 *
 * 예전에는 헤더에 「새로고침」 글자 버튼이 있었는데 이렇게 어긋났다(실제 제보):
 *   · **있다 없다 했다** — 화면이 다시 불러오기를 등록한 곳에서만 떴는데,
 *     등록해 둔 화면이 몇 개 없었다. 대부분의 탭에서 버튼이 사라졌다.
 *   · **핸드폰에서 줄이 바뀌었다** — 헤더가 좁아 버튼이 아래로 접혔다.
 *
 * 그래서 자리를 옮겼다. 탭과 같은 줄, 오른쪽 끝에 **고정**된다(탭을 옆으로 밀어도 따라가지
 * 않는다). 여기서 막는 것은 그 자리로 되돌아가는 회귀 세 가지다.
 */
const FE = path.resolve(__dirname, '../../../frontend/src');
const read = (rel: string) => readFileSync(path.join(FE, rel), 'utf8');

describe('새로고침 버튼', () => {
  it('헤더로 돌아가지 않는다 — 자리는 탭 줄이다', () => {
    const header = read('components/Header.tsx');
    expect(header).not.toContain('useRefreshApi');
    expect(header).not.toContain('새로고침');
  });

  it('탭 줄은 줄바꿈하지 않는다 — 좁은 화면에서도 한 줄로 밀린다', () => {
    const tabs = read('components/ui/Tabs.tsx');
    // 줄바꿈을 허용하면 탭 줄 높이가 화면 폭마다 달라져 아래 내용이 널뛴다
    expect(tabs).not.toContain('flexWrap');
    expect(tabs).toContain("overflowX: 'auto'");
  });

  it('곁들이(새로고침)는 탭과 함께 밀리지 않는다 — 밖에 따로 선다', () => {
    const tabs = read('components/ui/Tabs.tsx');
    // 스크롤되는 칸은 role=tablist 쪽이고, trailing 은 그 형제여야 한다.
    const barIdx = tabs.indexOf('role="tablist"');
    const trailIdx = tabs.indexOf('{trailing}');
    expect(barIdx).toBeGreaterThan(-1);
    expect(trailIdx).toBeGreaterThan(barIdx);
    // 같은 <div> 안에 들어가 있으면(=tablist 를 닫기 전이면) 함께 스크롤된다
    expect(tabs.slice(barIdx, trailIdx)).toContain('</div>');
  });

  it('세 화면 모두 탭 줄에 버튼을 단다', () => {
    for (const page of ['pages/SalesPage.tsx', 'pages/AdminPage.tsx', 'pages/MakerPage.tsx']) {
      expect(read(page), page).toContain('RefreshButton');
    }
  });

  it('화면 제목을 되살리지 않는다 — 세 화면이 같은 구조다', () => {
    // 좁은 화면에서 제목 한 줄이 내용을 그만큼 밀어냈다. 어느 화면인지는 헤더가 이미 말한다.
    // 주석에 남은 「예전엔 …이 있었다」까지 잡으면 설명을 못 쓰게 되므로, **화면에 찍히는 글자**만 본다.
    expect(read('pages/AdminPage.tsx')).not.toMatch(/>\s*관리자 대시보드\s*</);
    expect(read('pages/MakerPage.tsx')).not.toMatch(/>\s*특장사 작업\s*</);
  });

  it('컨피규레이터를 뺀 모든 탭이 다시 불러오기를 등록한다', () => {
    /*
     * 등록이 없는 탭에서는 버튼이 사라진다(눌러도 아무 일이 없는 버튼은 두지 않는다).
     * 탭 하나를 새로 만들면서 등록을 잊는 것이 「있다 없다」의 원인이었다.
     */
    const need: Record<string, string> = {
      // 관리자
      'pages/AdminPage.tsx': '견적 목록·주문 진행·고객·계정 관리·기능모듈',
      'components/OrderFilesTab.tsx': '파일',
      'components/OptionDbTab.tsx': '옵션DB·무게상수',
      'components/SalesPerformance.tsx': '영업 성과·마이페이지',
      // 영업·특장사 본체
      'pages/SalesPage.tsx': '견적·주문',
      'pages/MakerPage.tsx': '작업 목록',
    };
    for (const [file, what] of Object.entries(need)) {
      expect(read(file), `${file} (${what})`).toMatch(/useScreenRefresh|RefreshOn/);
    }
  });
});
