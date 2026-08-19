/**
 * 숨김(soft hide) — **지우지 않고 화면에서만 감춘다.**
 *
 * 삭제 기능을 없앤 뒤(#198), 테스트로 만든 임시저장 견적과 고객이 쌓여 화면과
 * WARP 연동 목록을 어지럽혔다. 지우는 대신 `hidden_at` 을 찍어 조회에서 뺀다.
 *
 * ⚠️ **이 방식이 실패하는 길은 하나뿐이다 — 조회 한 곳에서 조건을 빠뜨리는 것.**
 *    그러면 숨긴 게 거기서만 다시 보인다(또는 통계에만 잡힌다). 그래서 조건을
 *    각자 쓰지 않고 **여기 한 곳**에서 낸다. `visibility.test.ts` 가 이걸 강제한다.
 *
 * 쓰는 법:
 *   where: { ...VISIBLE, sales_user_id: email }        // 보이는 것만
 *   where: { ...visibleUnless(includeHidden), ... }    // 「숨김 포함」 토글이 있을 때
 */

/** 보이는 행만. 견적·고객 공통 — 두 테이블 모두 `hidden_at` 을 쓴다. */
export const VISIBLE = { hidden_at: null } as const;

/**
 * `includeHidden` 이 참이면 조건을 걸지 않는다(관리자가 숨긴 것까지 보려 할 때).
 * 빈 객체를 펼치면 아무 조건도 안 걸린다.
 */
export function visibleUnless(includeHidden: boolean): { hidden_at?: null } {
  return includeHidden ? {} : { ...VISIBLE };
}

/** 요청의 `?include_hidden=true` 해석. 값이 정확히 'true' 일 때만 참. */
export function wantsHidden(v: unknown): boolean {
  return v === 'true';
}
