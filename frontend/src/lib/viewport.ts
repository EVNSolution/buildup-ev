import { useEffect } from 'react'

/**
 * **키보드가 올라온 만큼만 화면을 줄인다** — 카카오톡처럼.
 *
 * 아이폰에서 키보드가 올라와도 `window.innerHeight` 는 그대로다(레이아웃 뷰포트는
 * 안 줄어든다). 그래서 그 값으로 높이를 잡으면 **입력칸이 키보드 뒤로 숨는다.**
 * 실제로 보이는 높이는 `visualViewport.height` 다 — 키보드가 올라오면 그만큼 준다.
 *
 * ⚠️ `visualViewport.offsetTop` 은 브라우저가 페이지를 밀어 올린 양이다. 초점 확대가
 *    일어나면 여기에 값이 실린다. 초점 확대는 입력칸 글꼴(16px 이상)로 막고,
 *    혹시 밀려도 그만큼 빼서 화면 안에 남게 한다. 손가락 확대 중에는 아예 재지 않는다.
 */

/**
 * **손가락으로 확대한 상태인가.**
 *
 * 확대하면 `visualViewport.height`·`offsetTop` 은 물론 아이폰에서는 `innerWidth` 까지
 * **확대 배율만큼 줄어든다.** 그 값으로 앱 높이를 다시 잡으면 확대하는 순간 앱이
 * 쪼그라든다(390×844 에서 2.2 배 확대 → 앱 높이 844 → 602px, 실측).
 * 확대는 **보이는 창만 키우는 것**이지 화면 크기가 바뀐 게 아니므로, 그동안은 재지 않는다.
 */
export function isPinchZoomed(): boolean {
  const vv = window.visualViewport
  // 1 보다 클 때만 — 기기에 따라 기본 배율이 1 에서 살짝 어긋나면 영영 재지 못하게 된다
  return !!vv && vv.scale > 1.01
}

/** 확대되기 직전에 잰 높이 — 확대 중에는 이 값을 그대로 쓴다 */
let lastUnzoomedHeight: number | null = null

/** 지금 실제로 보이는 화면 높이(화면 픽셀). 키보드가 올라오면 줄어든다. 확대 중에는 확대 전 값. */
export function visibleHeight(): number {
  const vv = window.visualViewport
  if (!vv) return window.innerHeight
  if (isPinchZoomed()) return lastUnzoomedHeight ?? window.innerHeight
  lastUnzoomedHeight = vv.height + vv.offsetTop
  return lastUnzoomedHeight
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
      // 손가락으로 확대한 동안은 그대로 둔다 — 확대 배율만큼 줄어든 값으로 앱을 다시 짜면
      // 확대하는 순간 화면이 쪼그라든다. 원래 크기로 돌아오면 그때 다시 잰다.
      if (isPinchZoomed()) return
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
      /*
       * 폭도 같이 준다. `position: fixed` 인 요소(단계별 대화 서랍)가 `100vw` 를 쓰면
       * **zoom 이 보정되지 않아 0.88 배로 그려진다**(390 화면에서 343px, 실측).
       * 서랍이 화면을 못 덮으니 옆이 비고, 기기에 따라 반대로 삐져나와 가로 스크롤이
       * 생겨 화면 전체가 좌우로 끌렸다(사진 제보).
       */
      de.style.setProperty('--root-w', `${Math.round(window.innerWidth / zoom)}px`)
      /*
       * 옆에서 나오는 창(단계별 대화 서랍)의 폭 — **넓은 화면에서는 420px 까지,
       * 좁은 화면에서는 화면을 꽉.** 상한도 zoom 보정을 받아야 한다.
       * CSS 로 `min(420px, 100vw)` 라고 적었더니 둘 다 보정을 못 받아 390 화면에서
       * 370px 로 그려졌다(실측) — 20px 이 비었다.
       */
      de.style.setProperty('--panel-w', `${Math.round(Math.min(420, window.innerWidth) / zoom)}px`)
    }
    set()
    // 글꼴·주소창이 자리 잡은 뒤 한 번 더 — 첫 계산이 어긋나는 경우가 있다
    const timer = setTimeout(set, 120)
    const off = onVisibleHeightChange(set)
    return () => { off(); clearTimeout(timer) }
  }, [])
}

/**
 * **두 손가락 확대는 휴대폰·태블릿에서만 된다.** 마우스 기기(맥 사파리 트랙패드)는 막는다.
 *
 * 예전에는 모든 기기에서 막았다 — 확대하면 앱 높이가 쪼그라들어 화면이 무너졌기 때문이다.
 * 그 원인은 `useAppHeight` 가 확대 중에 재지 않게 해서 없앴다. 이제 손가락 기기에서는
 * 글씨가 작아 읽기 힘든 분이 **직접 벌려서** 키울 수 있다.
 *
 * ⚠️ **손가락으로 벌리지 않았는데 확대되는 일은 없어야 한다.** 그 경로는 따로 막혀 있다.
 *    - 두 번 탭 확대 → `touch-action: manipulation`(globals.css)
 *    - 입력칸 초점 확대(아이폰) → 입력칸 글꼴 `--fs-input`(globals.css)
 *    - 가로로 돌렸을 때 글자 부풀림(아이폰) → `text-size-adjust: 100%`(globals.css)
 *    `<meta viewport>` 에 `maximum-scale=1` 을 넣어 막지 않는다 — 안드로이드와
 *    카카오톡 안 브라우저(아이폰)에서는 손가락 확대까지 같이 막힌다.
 */
export function useDesktopNoPinchZoom(): void {
  useEffect(() => {
    // 손가락 기기면 아무것도 막지 않는다
    if (window.matchMedia?.('(pointer: coarse)').matches) return
    const stop = (e: Event) => e.preventDefault()
    // 사파리 전용 — 트랙패드 두 손가락 확대
    document.addEventListener('gesturestart', stop)
    document.addEventListener('gesturechange', stop)
    document.addEventListener('gestureend', stop)
    return () => {
      document.removeEventListener('gesturestart', stop)
      document.removeEventListener('gesturechange', stop)
      document.removeEventListener('gestureend', stop)
    }
  }, [])
}
