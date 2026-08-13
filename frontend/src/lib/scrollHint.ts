/**
 * 스크롤 그림자 켜고 끄기 — `.scroll-hint` 칸이 **끝에 닿았는지**를 표시한다.
 *
 * 그림자 자체는 CSS(globals.css)가 그린다. 여기서는 위/아래 끝에 닿았는지만 보고
 * data-scroll-top / data-scroll-bottom 을 붙인다 — CSS 만으로는 알 수 없는 값이다.
 *
 * 한 곳에서 **문서 전체**를 맡는다(칸마다 훅을 달지 않는다):
 *  - scroll 은 버블링하지 않으므로 캡처 단계에서 받는다(어느 칸이든 한 번에 잡힌다)
 *  - 새로 열린 팝업·모달은 MutationObserver 로 찾아 첫 상태를 정한다
 *  - 내용이 늘어 스크롤이 생기거나 사라지는 것은 ResizeObserver 로 따라간다
 *
 * 스크립트가 죽어도 그림자는 **보이는 쪽**으로 남는다(CSS 기본값) — 잘린 화면을
 * 고장으로 오해하는 편보다, 그림자가 하나 더 보이는 편이 낫다.
 */
const EPS = 2   // 소수점 스크롤 위치(확대·고DPI)에서 1px 안팎이 남는다

function mark(el: HTMLElement) {
  const vScrollable = el.scrollHeight - el.clientHeight > EPS
  // 스크롤이 없는 칸은 양쪽 다 끝에 닿은 것으로 본다 = 그림자 없음
  el.dataset['scrollTop'] = !vScrollable || el.scrollTop <= EPS ? '1' : '0'
  el.dataset['scrollBottom'] =
    !vScrollable || el.scrollTop + el.clientHeight >= el.scrollHeight - EPS ? '1' : '0'

  const hScrollable = el.scrollWidth - el.clientWidth > EPS
  el.dataset['scrollLeft'] = !hScrollable || el.scrollLeft <= EPS ? '1' : '0'
  el.dataset['scrollRight'] =
    !hScrollable || el.scrollLeft + el.clientWidth >= el.scrollWidth - EPS ? '1' : '0'
}

const SELECTOR = '.scroll-hint, .scroll-hint-x'

export function startScrollHints(): void {
  if (typeof window === 'undefined') return

  const sizeWatcher = new ResizeObserver(entries => {
    for (const e of entries) mark(e.target as HTMLElement)
  })
  const watched = new WeakSet<Element>()

  function scan() {
    for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
      mark(el)
      if (!watched.has(el)) { watched.add(el); sizeWatcher.observe(el) }
    }
  }

  // scroll 은 버블링하지 않는다 — 캡처로 받아야 안쪽 칸의 스크롤까지 들어온다
  document.addEventListener('scroll', e => {
    const t = e.target
    if (t instanceof HTMLElement && t.matches(SELECTOR)) mark(t)
  }, { capture: true, passive: true })

  // 팝업·모달은 열릴 때 DOM 에 새로 생긴다
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
  window.addEventListener('resize', scan, { passive: true })
  scan()
}
