import type { ReactNode } from 'react'
import { BackIcon } from './icons/ChatIcons'
import { useBackClose } from '../lib/backClose'
import { safeTop, safeBottom } from '../styles/safeArea'

/**
 * 사진을 **화면 가득** 본다.
 *
 * 예전에는 새 탭으로 열었다. 탭이 바뀌면 대화 맥락이 끊기고, 휴대폰에서는 되돌아오는 길이
 * 브라우저 탭 목록을 거쳐야 해서 멀다(제보). 같은 화면 위에 덮어 보여 주고,
 * **뒤로가기 한 번으로** 대화로 돌아온다.
 *
 * 보내기 전 미리보기로도 쓴다 — 찍은 사진을 크게 확인하고 오른쪽 위에서 보낸다.
 */
export function PhotoViewer({ src, alt = '사진', onClose, action }: {
  src: string
  alt?: string
  onClose: () => void
  /** 오른쪽 위 자리 — 보내기 전 미리보기에서 「보내기」가 들어간다 */
  action?: ReactNode
}) {
  // 뒤로가기 한 번이면 사진이 닫히고 보던 대화로 돌아온다
  useBackClose(true, onClose)

  return (
    <div style={s.wrap} role="dialog" aria-modal="true" aria-label={alt}>
      <div style={s.bar}>
        <button style={s.back} onClick={onClose} aria-label="뒤로">
          <BackIcon />
        </button>
        {action}
      </div>
      {/*
        사진은 **잘리지 않게** 담는다(`contain`). 증빙으로도 쓰는 사진이라
        가장자리가 잘리면 확인해야 할 것이 사라진다.
      */}
      <div style={s.body} onClick={onClose}>
        <img src={src} alt={alt} style={s.img} onClick={e => e.stopPropagation()} />
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    position: 'fixed', inset: 0, zIndex: 60,
    background: '#000',
    display: 'flex', flexDirection: 'column',
  },
  /** 위 줄 — 왼쪽 뒤로, 오른쪽 동작. 노치를 피한다 */
  bar: {
    flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: 'var(--sp-2) var(--sp-3)', paddingTop: safeTop('var(--sp-2)'),
    gap: 'var(--sp-2)',
  },
  back: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    width: 40, height: 40, padding: 0,
    border: 'none', background: 'transparent', color: '#fff',
    cursor: 'pointer', borderRadius: 8,
  },
  body: {
    flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 'var(--sp-3)', paddingBottom: safeBottom('var(--sp-3)'),
  },
  img: { maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' as const },
}
