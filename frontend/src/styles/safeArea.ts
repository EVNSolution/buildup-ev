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

/** 아래쪽(홈 인디케이터) — 하단 고정 바·입력칸에 */
export const safeBottom = (base: string): string =>
  `calc(${base} + env(safe-area-inset-bottom, 0px))`

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
