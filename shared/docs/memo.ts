/**
 * 메모/안내문의 크기 제한 — **견적서와 계약서가 같은 규칙을 쓴다.**
 *
 * 메모는 줄바꿈을 그대로 살려 문서에 찍힌다. 그런데 서류는 **한 장에 들어가야 한다**:
 *   · 견적서 — 메모 칸이 정해진 높이다. 넘치면 잘려 나간다.
 *   · 계약서 — 특약사항이 길어지면 서명란이 **다음 장으로 밀린다.**
 *
 * 그래서 줄바꿈을 살리는 대신 **넣을 수 있는 양을 막는다.** 잘라 버리면 무엇이 사라졌는지
 * 모른 채 고객에게 나가므로, **애초에 입력이 안 되게** 하는 쪽이 맞다.
 */

/** 최대 줄 수 — 견적서 메모 칸과 계약서 특약사항이 함께 견디는 한계. */
export const MEMO_MAX_LINES = 4;

/**
 * 한 줄에 넣을 수 있는 글자 수.
 *
 * 이 값을 넘으면 문서에서 **저절로 다음 줄로 접힌다.** 그러면 4줄로 적은 것이 6줄이 되어
 * 결국 넘친다. 한글 기준으로 접히지 않는 폭을 잡았다.
 */
export const MEMO_MAX_LINE_CHARS = 40;

/** 화면에 적어 줄 안내문 — 규칙이 바뀌면 이 문구도 같이 바뀐다. */
export const MEMO_LIMIT_HINT = `최대 ${MEMO_MAX_LINES}줄 · 한 줄 ${MEMO_MAX_LINE_CHARS}자`;

/**
 * 제한에 맞게 다듬는다 — 줄 수와 줄 길이를 모두 자른다.
 *
 * 화면에서는 **입력을 막는 데** 쓰고(잘린 티가 안 나게), 서버에서는 **마지막 방어**로 쓴다.
 * 제한이 생기기 전에 저장된 메모가 이미 있어서, 서버도 한 번 더 걸러야 문서가 안 깨진다.
 */
export function clampMemo(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')          // 윈도우 줄바꿈을 하나로 맞춘다
    .split('\n')
    .slice(0, MEMO_MAX_LINES)
    .map(line => line.slice(0, MEMO_MAX_LINE_CHARS))
    .join('\n');
}

/** 이미 제한 안에 들어와 있는가 — 테스트와 서버 경고에 쓴다. */
export function memoWithinLimit(raw: string): boolean {
  return clampMemo(raw) === raw.replace(/\r\n?/g, '\n');
}
