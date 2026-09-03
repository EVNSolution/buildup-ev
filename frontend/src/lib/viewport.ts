/**
 * **키보드가 올라온 만큼만 화면을 줄인다** — 카카오톡처럼.
 *
 * 아이폰에서 키보드가 올라와도 `window.innerHeight` 는 그대로다(레이아웃 뷰포트는
 * 안 줄어든다). 그래서 그 값으로 높이를 잡으면 **입력칸이 키보드 뒤로 숨는다.**
 * 실제로 보이는 높이는 `visualViewport.height` 다 — 키보드가 올라오면 그만큼 준다.
 *
 * ⚠️ `visualViewport.offsetTop` 은 브라우저가 페이지를 밀어 올린 양이다. 초점 확대가
 *    일어나면 여기에 값이 실린다. 우리는 확대 자체를 막지만(입력칸 글꼴 16px 이상),
 *    혹시 밀려도 그만큼 빼서 화면 안에 남게 한다.
 */

/** 지금 실제로 보이는 화면 높이(화면 픽셀). 키보드가 올라오면 줄어든다. */
export function visibleHeight(): number {
  const vv = window.visualViewport
  return vv ? vv.height + vv.offsetTop : window.innerHeight
}

/**
 * 보이는 높이가 바뀔 때마다 알려 준다 — 키보드 여닫기·회전·주소창 접힘 모두.
 * 정리 함수를 돌려준다.
 */
export function onVisibleHeightChange(fn: () => void): () => void {
  const vv = window.visualViewport
  window.addEventListener('resize', fn)
  window.addEventListener('orientationchange', fn)
  vv?.addEventListener('resize', fn)
  vv?.addEventListener('scroll', fn)
  return () => {
    window.removeEventListener('resize', fn)
    window.removeEventListener('orientationchange', fn)
    vv?.removeEventListener('resize', fn)
    vv?.removeEventListener('scroll', fn)
  }
}
