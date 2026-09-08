/**
 * 발주서 **별지**(2페이지) — 커스텀 주문의 상세 요청사항.
 *
 * 비고(`memo.ts`)와 나란한 규칙이지만 목적이 다르다. 비고는 1페이지 양식의 한 칸이라
 * 4줄로 묶여 있고, 별지는 **한 장을 통째로** 쓴다.
 *
 * ⚠️ 그래도 상한은 있다 — 한 페이지를 넘기면 발주서가 **축소되어** 글씨가 작아지고
 *    결국 못 읽는다(발주서는 A4 비율을 지키려고 넘칠 때 줄인다). 담기지 않는 글을
 *    받아 두고 안 보이게 하느니, 받을 때 막는 편이 낫다.
 *
 * 화면과 서버가 **같은 값을 본다** — 화면에서만 막으면 API 를 직접 불러 우회된다.
 */

/** 한 장에 담기는 줄 수 — A4 세로 한 면 기준(실측 후 조정) */
export const APPENDIX_MAX_LINES = 30;

/** 한 줄 글자 수 */
export const APPENDIX_MAX_LINE_CHARS = 40;

/** 넉넉히 잡은 전체 상한. 줄·글자 규칙을 통과해도 이 값을 넘지 않는다 */
export const APPENDIX_MAX_CHARS = APPENDIX_MAX_LINES * APPENDIX_MAX_LINE_CHARS;

/**
 * 한 장에 담기게 잘라 낸다 — 입력칸이 이 결과를 그대로 값으로 쓴다.
 * 줄바꿈은 **적은 그대로 보관한다**(줄로 뜻을 나눈 글이 한 줄로 붙으면 다른 말이 된다).
 */
export function clampAppendix(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n').slice(0, APPENDIX_MAX_LINES);
  return lines.map(l => l.slice(0, APPENDIX_MAX_LINE_CHARS)).join('\n').slice(0, APPENDIX_MAX_CHARS);
}

/** 적힌 것이 있는가 — 공백만 있는 것은 비어 있는 것으로 본다 */
export function hasAppendix(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * 커스텀 건의 1페이지 비고 — **서버가 정하는 고정 문구.**
 *
 * 비고 칸은 4줄이라 커스텀 내용을 담지 못한다. 그 칸은 「어디를 보라」만 말하고
 * 내용은 별지로 보낸다. 관리자가 다른 글을 넣을 수 없게 서버가 이 값으로 덮는다.
 *
 * ⚠️ 저장되는 값이라 **한국어로 남는다**(구조는 한국어, 화면만 영어).
 *    영어로 보는 특장사에게는 화면에서 옮겨 준다 — 그러려면 옮기는 쪽이 이 값을
 *    **알아볼 수 있어야** 해서, 문구를 여기 한 곳에 둔다.
 */
export const APPENDIX_REMARK = '커스텀 주문 건입니다. 2페이지(별지)를 확인하세요.';
