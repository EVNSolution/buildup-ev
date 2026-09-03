/**
 * 아이폰 안전영역 — **노치·홈 인디케이터·둥근 모서리에 가리지 않게.**
 *
 * `index.html` 에 `viewport-fit=cover` 를 켜 두었다. 화면 끝까지 그리는 대신,
 * 가려지는 만큼을 **안쪽 여백**으로 밀어 준다.
 *
 * ⚠️ **버튼을 작게 만들어 피하지 않는다.** 배경은 화면 바닥까지 깔고 내용만 위로 올린다 —
 *    그래야 잘린 것이 아니라 원래 그런 모양으로 보인다.
 *
 * ⚠️ 아이폰이 아니거나 안전영역이 없으면 `env(...)` 는 **0px** 이다. 다른 기기에서는
 *    아무 일도 일어나지 않는다.
 */

/**
 * 아래쪽(홈 인디케이터) — **하단에 고정된 바·입력칸**에 쓴다.
 *
 * ⚠️ `base + inset` 이 아니라 **`max(base, inset)`** 이다. 더하면 원래 여백(16px)에
 *    인디케이터(34px)가 얹혀 50px 이 되어 「여백이 과하다」는 말이 나온다(실제 제보).
 *    인디케이터를 피하는 데는 34px 이면 충분하고, 안전영역이 없는 기기에서는
 *    원래 여백이 그대로 남는다.
 */
export const safeBottom = (base: string): string =>
  `max(${base}, env(safe-area-inset-bottom, 0px))`

/**
 * **스크롤해서 끝나는 화면**의 바닥 — 내용은 꽉 채우고 마지막 줄만 곡률을 피한다.
 * 고정 바가 없는 화면(주문 진행 등)에 쓴다.
 */
export const safeScrollBottom = (base = '8px'): string =>
  `max(${base}, env(safe-area-inset-bottom, 0px))`

/** 위쪽(노치·다이내믹 아일랜드) — 헤더에 */
export const safeTop = (base: string): string =>
  `calc(${base} + env(safe-area-inset-top, 0px))`

/** 좌우(가로 모드·둥근 모서리) */
export const safeLeft = (base: string): string =>
  `calc(${base} + env(safe-area-inset-left, 0px))`
export const safeRight = (base: string): string =>
  `calc(${base} + env(safe-area-inset-right, 0px))`

/** 화면을 가득 채우는 요소의 높이 — 위아래 안전영역을 뺀 값 */
export const SAFE_VH = 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))'
