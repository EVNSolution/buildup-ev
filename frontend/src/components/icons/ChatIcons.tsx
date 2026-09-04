/**
 * 대화창 아이콘 — **이모지를 쓰지 않는다.**
 *
 * 이모지(📎·🔔)는 기기마다 다른 그림으로 그려져 크기·색·정렬이 제각각이다.
 * 같은 줄에 놓으면 하나만 크거나 아래로 처져 보인다(실제 제보).
 * 선으로 그린 아이콘은 글자색(`currentColor`)을 따라가므로 상태에 따라 색만 바꾸면 된다.
 */

/** 클립 — 사진 붙이기 */
export function ClipIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
    </svg>
  )
}

/** 종이비행기 — 보내기. 오른쪽 위로 날아가는 모양 */
export function SendIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {/* 바깥 날개 */}
      <path d="M21.5 2.5 2.5 10.2l7.3 2.9 2.9 7.3z" />
      {/* 안쪽 접힌 선 — 이것이 있어야 평면 삼각형이 아니라 비행기로 읽힌다 */}
      <path d="M21.5 2.5 9.8 13.1" />
    </svg>
  )
}

/** 뒤로 — 사진을 크게 볼 때 왼쪽 위 */
export function BackIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  )
}
