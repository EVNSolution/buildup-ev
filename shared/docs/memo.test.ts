import { describe, it, expect } from 'vitest';
import { clampMemo, memoWithinLimit, MEMO_MAX_LINES, MEMO_MAX_LINE_CHARS } from './memo.js';

/**
 * 메모는 **줄바꿈을 살려** 견적서·계약서에 찍힌다. 대신 넣을 수 있는 양을 막는다 —
 * 서류는 한 장에 들어가야 하고, 넘친 것을 잘라 내면 무엇이 사라졌는지 모른 채 고객에게 나간다.
 */
describe('메모 제한', () => {
  it('줄 수를 넘기면 뒤를 버린다', () => {
    const five = ['1', '2', '3', '4', '5'].join('\n');
    expect(clampMemo(five).split('\n')).toHaveLength(MEMO_MAX_LINES);
    expect(clampMemo(five)).toBe(['1', '2', '3', '4'].join('\n'));
  });

  it('한 줄이 길면 그 줄만 자른다 — 다른 줄은 건드리지 않는다', () => {
    const long = 'ㄱ'.repeat(MEMO_MAX_LINE_CHARS + 20);
    const out = clampMemo(`${long}\n짧은줄`).split('\n');
    expect(out[0]).toHaveLength(MEMO_MAX_LINE_CHARS);
    expect(out[1]).toBe('짧은줄');
  });

  it('제한 안이면 **글자 하나 바꾸지 않는다**', () => {
    // 입력할 때마다 clamp 를 거치므로, 멀쩡한 글이 손상되면 안 된다
    const ok = ['[ 서비스 항목 ]', '', '- 도어 슬라이딩 업그레이드', '- 온도기록계 추가'].join('\n');
    expect(clampMemo(ok)).toBe(ok);
    expect(memoWithinLimit(ok)).toBe(true);
  });

  it('빈 줄도 한 줄로 센다 — 문서에서 실제로 자리를 차지한다', () => {
    const withBlank = ['가', '', '나', '', '다'].join('\n');
    expect(clampMemo(withBlank).split('\n')).toHaveLength(4);
  });

  it('윈도우 줄바꿈을 섞어 붙여넣어도 같은 결과가 된다', () => {
    // 메일·엑셀에서 복사해 붙이는 일이 흔하다. \r 이 남으면 문서에 이상한 칸이 생긴다
    expect(clampMemo('가\r\n나\r다')).toBe('가\n나\n다');
  });

  it('여러 번 걸러도 같다 — 화면과 서버가 모두 거쳐도 안전하다', () => {
    const raw = ['ㄱ'.repeat(99), 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ'].join('\n');
    expect(clampMemo(clampMemo(raw))).toBe(clampMemo(raw));
  });
});
