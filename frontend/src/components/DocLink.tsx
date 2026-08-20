import { openPdf } from '../lib/openPdf'

/**
 * 서류를 여는 링크 — **목록에서 쓰는 「열기」.**
 *
 * ⚠️ 그냥 `<a target="_blank">` 로 두면 **홈 화면에 추가한 앱(PWA)에서는 아무 일도
 *    일어나지 않는다.** 그 창에는 탭이 없기 때문이다(실제 제보 — 「PC 에서는 새 탭으로
 *    열리는데 앱에서는 막힌다」). `openPdf` 가 그 갈림을 한 곳에서 처리하므로
 *    목록도 같은 길로 보낸다.
 *
 * 링크(`<a href>`)로 두는 이유: 마우스 오른쪽 눌러 주소 복사·새 창 열기가 되고,
 * 상태표시줄에 주소가 보인다. 실제 이동은 막고 `openPdf` 에 넘긴다.
 */
export function DocLink({ href, name, children, style }: {
  href: string
  /** 내려받을 때 쓸 파일명 — 서버가 헤더로 주면 그쪽이 이긴다 */
  name?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={style}
      onClick={e => {
        // 가운데 클릭·Ctrl/Cmd 클릭은 브라우저에 맡긴다 — 새 탭으로 여는 사람이 있다
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        openPdf(href, name)
      }}
    >{children}</a>
  )
}
