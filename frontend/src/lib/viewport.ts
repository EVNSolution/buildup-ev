import { useEffect } from 'react'

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

/**
 * **앱 전체 높이를 여기 한 곳에서 정한다.**
 *
 * 예전에는 화면마다 뷰포트를 따로 쟀다(주문 상세·대화 탭·서랍). 아이폰에서는
 * `getBoundingClientRect()`(레이아웃 뷰포트 기준)와 `visualViewport.height`(실제 보이는
 * 높이)가 서로 다른 좌표계라, 그 둘을 섞어 계산한 높이가 **화면보다 커졌다.**
 * 그러면 바깥 칸이 넘쳐 스크롤이 생기고, 손가락으로 당기면 화면이 통째로 출렁였다
 * (사진 제보 — 헤더 아래로 내용이 한참 밀려 내려갔다).
 *
 * 이제 재는 곳은 **여기뿐**이다. `--app-h` 를 html·body 에 걸어 두면 그 아래는 전부
 * 백분율로 따라 내려가므로, 어느 화면도 자기 높이를 다시 계산할 필요가 없다.
 * 키보드가 올라오면 `--app-h` 가 줄고 앱 전체가 그만큼 줄어든다 — 카카오톡과 같은 동작이다.
 */
export function useAppHeight(): void {
  useEffect(() => {
    const set = () => {
      const visible = visibleHeight()
      const de = document.documentElement
      de.style.setProperty('--app-h', `${Math.round(visible)}px`)
      /*
       * `#root` 는 손가락 기기에서 `zoom: .88` 이 걸린다. 거기에 화면 높이를 그대로 주면
       * **0.88 배로 그려져 바닥에 100px 빈 칸**이 남는다(844 지정 → 743 렌더, 실측).
       * 백분율에 기대면 브라우저마다 해석이 달라 `calc(100% / .88)` 이 이중으로 먹기도 했다
       * (1090px, 실측). 그래서 **zoom 값을 직접 읽어** 한 번만 되돌린다.
       */
      const root = document.getElementById('root')
      const zoom = root ? parseFloat(getComputedStyle(root).zoom) || 1 : 1
      de.style.setProperty('--root-h', `${Math.round(visible / zoom)}px`)
    }
    set()
    // 글꼴·주소창이 자리 잡은 뒤 한 번 더 — 첫 계산이 어긋나는 경우가 있다
    const t = setTimeout(set, 120)
    const off = onVisibleHeightChange(set)
    return () => { off(); clearTimeout(t) }
  }, [])
}
