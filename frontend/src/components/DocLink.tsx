import { useState } from 'react'
import { FileViewer } from './FileViewer'

/**
 * 서류·사진을 여는 링크 — **목록에서 쓰는 「열기」.**
 *
 * 누르면 **그 자리에 덮어** 보여 준다(`FileViewer`). 예전에는 새 탭으로 열었는데,
 * 탭이 바뀌면 보던 주문이 뒤로 밀리고 휴대폰에서 돌아오는 길이 멀다
 * (제보 — 「카톡처럼 넘기지 말고 바로 띄워 달라」).
 *
 * ⚠️ 홈 화면에 추가한 앱(PWA)에서는 **새 탭이라는 것이 아예 없어** 눌러도 아무 일도
 *    일어나지 않았다(실제 제보). 예전에는 그때만 내려받기로 갈랐는데, 화면 위에 덮으면
 *    그 갈림 자체가 사라진다 — 어디서 열든 같은 것을 본다.
 *
 * 링크(`<a href>`)로 두는 이유: 마우스 오른쪽 눌러 주소 복사·새 창 열기가 되고,
 * 상태표시줄에 주소가 보인다. 새 탭으로 열고 싶은 사람은 Ctrl/Cmd 클릭을 쓴다.
 */
export function DocLink({ href, name, children, style }: {
  href: string
  /** 파일 이름 — 무엇으로 그릴지 정하고 내려받을 때도 쓴다 */
  name?: string
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={style}
        onClick={e => {
          // 가운데 클릭·Ctrl/Cmd 클릭은 브라우저에 맡긴다 — 새 탭으로 여는 사람이 있다
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
          e.preventDefault()
          setOpen(true)
        }}
      >{children}</a>
      {open && (
        <FileViewer url={href} name={name ?? '서류'} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
