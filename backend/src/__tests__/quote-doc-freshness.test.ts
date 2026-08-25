import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * **고친 값이 서류에 바로 보여야 한다** — 그리고 **서류가 남의 PC 에 남으면 안 된다.**
 *
 * `Cache-Control` 이 없는 응답은 브라우저가 제 마음대로 캐시해도 된다(RFC 9111).
 * 그래서 선수금을 고치고 견적서를 다시 열면 **바뀌기 전 PDF 가 그대로 떴다**
 * (실제 제보: 「선수금 수정 시 반영이 안 된다」). 서버는 새 값으로 렌더했는데
 * 브라우저가 요청조차 보내지 않은 것이다.
 */
const ROUTES = path.resolve(__dirname, '../routes');

/** 서류(PDF·스캔본)를 내려보내는 파일들 — 여기 응답에는 캐시 지시가 반드시 있어야 한다. */
function docRouteFiles(): string[] {
  return readdirSync(ROUTES)
    .filter(f => f.endsWith('.ts'))
    .filter(f => readFileSync(path.join(ROUTES, f), 'utf8').includes('application/pdf'));
}

describe('서류 응답은 캐시되지 않는다', () => {
  it('서류를 내려보내는 **응답마다** 캐시 지시가 붙는다', () => {
    /*
     * 「파일에 한 번이라도 있으면 통과」로 두면, 한 파일 안에 응답이 넷인데 하나만 붙여도
     * 넘어간다(docs.ts 가 실제로 넷이다). 응답 수만큼 있어야 한다.
     */
    const short: string[] = [];
    for (const f of docRouteFiles()) {
      const src = readFileSync(path.join(ROUTES, f), 'utf8');
      const responses = (src.match(/setHeader\('Content-Type', '?application\/pdf|setHeader\('Content-Type', (TYPE|CONTRACT_MIME)\[/g) ?? []).length;
      const guarded = (src.match(/noStore\(res\)/g) ?? []).length;
      if (guarded < responses) short.push(`${f}(응답 ${responses} / 지시 ${guarded})`);
    }
    expect(short, `빠진 곳: ${short.join(', ')}`).toEqual([]);
  });

  it('🔴 `no-store` 다 — `no-cache` 로 바꾸지 않는다', () => {
    /*
     * `no-cache` 는 「쓸 때마다 서버에 물어보라」일 뿐 **디스크에 남는 것은 막지 않는다.**
     * 견적서·계약서에는 고객 이름·연락처·금액이 들어 있어, 공용 PC 에서 열어 본 문서가
     * 캐시에 남으면 다음 사람이 꺼내 볼 수 있다.
     */
    const src = readFileSync(path.resolve(__dirname, '../lib/doc-headers.ts'), 'utf8');
    expect(src).toContain("'no-store, private'");
    expect(src).not.toMatch(/setHeader\('Cache-Control', 'no-cache'\)/);
  });

  it('캐시 지시를 한 곳에서만 정한다 — 라우트마다 손으로 쓰지 않는다', () => {
    // 손으로 쓰면 한 곳을 빠뜨려도 아무도 모른다(실제로 서명본 라우트만 빠져 있었다)
    const handwritten = docRouteFiles().filter(f =>
      /setHeader\('Cache-Control'/.test(readFileSync(path.join(ROUTES, f), 'utf8')));
    expect(handwritten, `직접 쓴 곳: ${handwritten.join(', ')}`).toEqual([]);
  });
});

describe('메모 줄바꿈', () => {
  const ROOT = path.resolve(__dirname, '../../..');
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

  it('🔴 견적서 양식이 줄바꿈을 살린다', () => {
    // 살리지 않으면 항목이 전부 한 줄로 이어붙어 무엇이 몇 개인지 읽을 수 없다(실제 제보)
    const tpl = read('doc-templates/quote-template.html');
    expect(tpl).toContain('white-space:pre-line');
    expect(tpl).toContain('<div class="memo-body">{{ memoText }}</div>');
  });

  it('🔴 계약서가 줄바꿈을 공백으로 뭉개지 않는다', () => {
    const src = read('backend/src/services/contract-docgen.ts');
    // 예전엔 `.replace(/\s*\n+\s*/g, ' ')` 로 한 문단으로 눌렀다
    expect(src).not.toMatch(/memo.*\.replace\(\/\\s\*\\n\+\\s\*\/g/);
    expect(src).toContain('linebreaks: true');
    expect(src).toContain('clampMemo');
  });

  it('화면과 서버가 같은 제한을 쓴다', () => {
    // 갈리면 화면에선 되는데 서버에서 잘리는(또는 그 반대) 일이 생긴다
    expect(read('frontend/src/components/QuoteExtras.tsx')).toContain("from '@shared/docs/memo'");
    expect(read('backend/src/services/contract-docgen.ts')).toContain("from '@buildup-ev/shared/docs/memo'");
  });
});
