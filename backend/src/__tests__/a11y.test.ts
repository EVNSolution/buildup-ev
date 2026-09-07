import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * **마우스가 없어도 쓸 수 있어야 한다.**
 *
 * 전수조사에서 나온 것들이다 — 눌러야 하는 것이 `<div>` 라 Tab 으로 닿지 않았고,
 * 화면을 덮는 창 19개 중 15개가 Esc 로 닫히지 않았다. 덮는 창은 「바깥 클릭」과
 * 「닫기 버튼」을 갖고 있었지만 **둘 다 마우스가 필요한 길**이라, 키보드만 쓰는 사람은
 * 창에 갇혔다.
 *
 * 이건 눈으로는 안 보인다 — 마우스로 쓰면 멀쩡해 보인다. 그래서 여기서 지킨다.
 */
const ROOT = path.resolve(__dirname, '../../..');
const SRC = path.join(ROOT, 'frontend/src');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (e.endsWith('.tsx')) out.push(p);
  }
  return out;
}
const files = tsxFiles(SRC).map(p => [path.relative(SRC, p), readFileSync(p, 'utf8')] as const);

describe('키보드로 쓸 수 있는가', () => {
  it('화면을 실제로 읽었다', () => {
    // 파싱이 깨지면 「빠진 것이 없다」가 거짓으로 초록이 된다
    expect(files.length).toBeGreaterThan(60);
  });

  it('🔴 눌러야 하는 것에는 키보드 길이 있다', () => {
    /*
     * `<div onClick>` 은 Tab 으로 닿지 않고 Enter·Space 로도 눌리지 않는다.
     * 버튼으로 바꾸거나, 자리·크기 때문에 그럴 수 없으면 `pressable()` 로
     * 역할·초점·건반을 함께 붙인다.
     *
     * ⚠️ 덮는 창의 **바깥 클릭으로 닫기**는 여기서 뺀다 — 그건 조작 요소가 아니라
     *    편의이고, 그 자리의 답은 tabIndex 가 아니라 Esc 다(아래에서 따로 지킨다).
     */
    const bad: string[] = [];
    for (const [rel, src] of files) {
      for (const m of src.matchAll(/<(div|span|td|tr|li|p)\b([^>]*?)onClick=\{([^}]*)\}/gs)) {
        const attrs = m[2] ?? '', handler = (m[3] ?? '').trim();
        // 덮는 창 여닫이 — 조작 요소가 아니다
        if (/stopPropagation/.test(handler)) continue;
        if (/^onClose$/.test(handler) || /^onCancel$/.test(handler)) continue;
        if (/ev\.target === ev\.currentTarget|handleOverlayClick/.test(handler)) continue;
        if (/set\w*\(null\)$/.test(handler)) continue;
        // 키보드 길이 붙어 있으면 통과
        if (/\{\.\.\.pressable\(/.test(src.slice(Math.max(0, m.index! - 260), m.index! + 260))) continue;
        if (attrs.includes('tabIndex') && /onKeyDown/.test(src.slice(m.index!, m.index! + 400))) continue;
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}  <${m[1]}> ${handler.slice(0, 40)}`);
      }
    }
    expect(bad, `키보드로 못 누르는 자리:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 덮는 창은 Esc 로 닫힌다', () => {
    const bad: string[] = [];
    for (const [rel, src] of files) {
      const overlay = /position: 'fixed'[\s\S]{0,120}inset: 0/.test(src);
      if (!overlay || !/onClose|setDoneId|setResetConfirm/.test(src)) continue;
      if (/useEscapeClose|useBackClose/.test(src)) continue;
      bad.push(rel);
    }
    expect(bad, `Esc 로 못 닫는 창:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('🔴 컨피규레이터 탭은 버튼이다', () => {
    /*
     * 예전에는 `<div>` 였다 — 「disabled 가 없어서」가 이유였는데, 그 대가로
     * 키보드로는 특장·옵션 탭에 아예 닿지 못했다.
     */
    const src = readFileSync(path.join(SRC, 'components/OptionPanel.tsx'), 'utf8');
    const strip = src.slice(src.indexOf('{TABS.map('), src.indexOf('{TABS.map(') + 900);
    expect(strip).toContain('<button');
    expect(strip).toContain('role="tab"');
    expect(strip).toContain('aria-selected');
    // disabled 는 초점이 가지 않아 「왜 못 쓰는지」를 읽을 방법이 사라진다
    expect(strip, 'disabled 를 쓰면 잠긴 이유를 읽을 수 없다').not.toMatch(/\sdisabled=/);
    expect(strip).toContain('aria-disabled');
  });

  it('🔴 표의 줄을 버튼으로 만들지 않는다', () => {
    // 줄에 role="button" 을 붙이면 표 구조가 깨져 낭독기가 몇 행짜리 표인지 알 수 없다
    for (const [rel, src] of files) {
      for (const m of src.matchAll(/<tr\b([^>]*)>/g)) {
        expect(m[1], `${rel} 의 줄에 role 이 붙었다`).not.toMatch(/role=/);
      }
    }
  });

  it('🔴 날짜 접기 버튼이 칸의 여백까지 덮는다', () => {
    /*
     * `<tr onClick>` 을 칸 안의 버튼으로 바꿀 때, 여백을 칸(groupCell)에 남겨 두면
     * 버튼이 글자 크기로만 줄어든다. 글자 위치는 그대로라 **눈으로는 아무 차이가 없는데**
     * 예전에 눌리던 글자 둘레 12px 가 죽는다(옛 커밋과 나란히 재 보고 알았다).
     *
     * 여백은 버튼이 갖고, 칸은 0 이어야 누르는 자리가 예전만큼 넓다.
     */
    for (const f of ['frontend/src/pages/SalesPage.tsx', 'frontend/src/pages/AdminPage.tsx']) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      const btn = src.slice(src.indexOf('groupBtn: {'), src.indexOf('groupCell: {'));
      const cell = src.slice(src.indexOf('groupCell: {'), src.indexOf('groupCell: {') + 200);
      expect(btn, `${f}: 여백이 버튼에 없다`).toMatch(/padding: 'var\(--sp-3\) var\(--sp-3\) var\(--sp-2\)'/);
      expect(cell, `${f}: 칸이 여백을 도로 가져갔다`).toMatch(/padding: 0/);
    }
  });

  it('아이콘만 있는 버튼에는 이름이 있다', () => {
    const bad: string[] = [];
    for (const [rel, src] of files) {
      for (const m of src.matchAll(/<(button|a)\b([^>]*)>((?:\s|<(?:[A-Z]\w*Icon|svg)\b[^>]*\/?>|<\/svg>|<path[^>]*\/>)*)<\/\1>/gs)) {
        const attrs = m[2] ?? '', inner = m[3] ?? '';
        if (!/<(?:[A-Z]\w*Icon|svg)/.test(inner)) continue;
        if (/aria-label|title=/.test(attrs)) continue;
        bad.push(`${rel}:${src.slice(0, m.index!).split('\n').length}`);
      }
    }
    expect(bad, `이름 없는 아이콘 버튼:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
