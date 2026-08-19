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
 *   where: { ...VISIBLE, sales_user_id: email }     // 보이는 것만
 *   where: { ...visibilityWhere(view), ... }        // 화면이 「진행 중 / 숨김」을 고를 때
 */

/** 보이는 행만. 견적·고객 공통 — 두 테이블 모두 `hidden_at` 을 쓴다. */
export const VISIBLE = { hidden_at: null } as const;

/** 목록 보기 — 「진행 중」과 「숨김」은 **섞지 않는다.** 정리 작업은 숨긴 것만 봐야 편하다. */
export type VisibilityView = 'active' | 'hidden';

/**
 * 보기에 맞는 조건.
 *
 * ⚠️ `hidden` 은 **숨긴 것만**이다(「숨김 포함」이 아니다).
 *    예전엔 include_hidden 이라 전체를 줬는데, 화면이 「숨김」 탭에서 안 숨긴 것까지 보여
 *    무엇이 숨겨졌는지 알 수 없었다.
 */
export function visibilityWhere(view: VisibilityView): { hidden_at: null | { not: null } } {
  return view === 'hidden' ? { hidden_at: { not: null } } : { hidden_at: null };
}

/** 요청의 `?view=hidden` 해석. 그 값일 때만 숨김 보기이고, 나머지는 전부 진행 중이다. */
export function viewOf(v: unknown): VisibilityView {
  return v === 'hidden' ? 'hidden' : 'active';
}
