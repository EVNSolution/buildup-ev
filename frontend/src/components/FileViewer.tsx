import { BackIcon } from './icons/ChatIcons'
import { useBackClose } from '../lib/backClose'
import { safeTop, safeBottom } from '../styles/safeArea'

/**
 * 올라온 파일을 **그 자리에서** 본다 — 사진이든 서류든.
 *
 * 예전에는 새 탭으로 열었다. 탭이 바뀌면 보던 주문이 뒤로 밀리고, 휴대폰에서 돌아오려면
 * 브라우저 탭 목록을 거쳐야 해서 멀다(제보 — 「카톡처럼 넘기지 말고 바로 띄워 달라」).
 *
 * ⚠️ 홈 화면에 추가한 앱(PWA)에서는 **새 탭이라는 것이 아예 없어** 아무 일도 일어나지
 *    않았다. 그래서 예전에는 그때만 내려받기로 갈랐는데(`openPdf`), 화면 위에 덮으면
 *    그 갈림 자체가 필요 없다 — 어디서 열든 같은 것을 본다.
 *
 * 사진은 `<img>`, 서류는 `<iframe>` 이다. 서버가 `Content-Disposition: inline` 으로
 * 주므로 PDF 는 브라우저 내장 뷰어가 그린다(우리 견적서·계약서와 같은 방식).
 */
export function FileViewer({ url, name, onClose }: {
  url: string
  /** 파일 이름 — 무엇으로 그릴지 정하고, 위 줄에 그대로 보여 준다 */
  name: string
  onClose: () => void
}) {
  // 뒤로가기 한 번이면 파일이 닫히고 보던 화면으로 돌아온다
  useBackClose(true, onClose)

  const isImage = /\.(jpe?g|png|webp|gif|heic|heif|bmp)$/i.test(name)

  return (
    <div style={s.wrap} role="dialog" aria-modal="true" aria-label={name}>
      <div style={s.bar}>
        <button style={s.icon} onClick={onClose} aria-label="뒤로">
          <BackIcon />
        </button>
        {/* 무엇을 보고 있는지 — 파일이 여러 개일 때 이 줄이 유일한 단서다 */}
        <span style={s.name} title={name}>{name}</span>
        {/*
          내려받기 — 브라우저가 못 그리는 형식이거나, 챙겨 가야 할 때.
          `dl=1` 이면 서버가 attachment 로 준다.
        */}
        <a
          style={s.icon}
          href={`${url}${url.includes('?') ? '&' : '?'}dl=1`}
          download={name}
          aria-label="내려받기"
          title="내려받기"
        >
          <DownloadIcon />
        </a>
      </div>

      <div style={isImage ? s.bodyImage : s.bodyDoc}>
        {isImage
          /*
            사진은 **잘리지 않게** 담는다(`contain`). 증빙으로도 쓰는 사진이라
            가장자리가 잘리면 확인해야 할 것이 사라진다.
          */
          ? <img src={url} alt={name} style={s.img} />
          : <iframe src={url} title={name} style={s.frame} />}
      </div>
    </div>
  )
}

/** 아래로 내리는 화살표 — 다른 아이콘들과 같이 `currentColor` 를 쓴다 */
function DownloadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11" />
      <path d="M7 11l5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed', inset: 0, zIndex: 60,
    background: '#000',
    display: 'flex', flexDirection: 'column',
  },
  /** 위 줄 — 왼쪽 뒤로, 가운데 이름, 오른쪽 내려받기. 노치를 피한다 */
  bar: {
    flex: 'none', display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
    padding: 'var(--sp-2) var(--sp-3)', paddingTop: safeTop('var(--sp-2)'),
  },
  name: {
    flex: 1, minWidth: 0, color: '#fff', fontSize: 'var(--fs-label)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  icon: {
    flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 40, padding: 0,
    border: 'none', background: 'transparent', color: '#fff',
    cursor: 'pointer', borderRadius: 8, textDecoration: 'none',
  },
  bodyImage: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'var(--sp-3)', paddingBottom: safeBottom('var(--sp-3)'),
  },
  /* 서류는 흰 바탕이 자연스럽다 — 검은 바탕에 흰 종이는 눈이 아프다 */
  bodyDoc: {
    flex: 1, minHeight: 0, display: 'flex', background: '#fff',
    paddingBottom: safeBottom('0px'),
  },
  img: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const },
  frame: { flex: 1, width: '100%', height: '100%', border: 'none' },
}
