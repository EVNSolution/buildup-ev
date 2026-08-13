import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useIsTouch } from '../hooks/useIsTouch'

interface Props {
  text: React.ReactNode
  children: React.ReactNode
  placement?: 'below' | 'above'
  maxWidth?: number
  minWidth?: number
  /**
   * 감싸는 span 에 얹을 스타일. 이 span 이 부모의 flex 항목이 되므로,
   * 카드처럼 `flex: 1` 로 늘어나야 하는 요소를 감쌀 땐 여기로 넘겨줘야 한다.
   */
  wrapperStyle?: React.CSSProperties
}

interface Pos {
  top?: number
  bottom?: number
  left: number
}

/**
 * 지금 열려 있는 설명창을 닫는 함수 — **화면에 하나만** 떠 있게 한다.
 *
 * 툴팁마다 자기 상태만 갖고 있으면 서로의 존재를 모른다. 손가락 기기에서는 「?」 를
 * 눌러 열고 다시 눌러야만 닫혔기 때문에, 칸반 열 제목처럼 나란히 놓인 「?」 를 차례로
 * 누르면 설명창이 세 개씩 겹쳐 떴다(실제로 그렇게 됐다).
 */
let closeOpenTooltip: (() => void) | null = null

export function Tooltip({ text, children, placement = 'below', maxWidth = 220, minWidth = 150, wrapperStyle }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos>({ left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  // 커서가 없는 기기(태블릿·휴대폰)는 hover 가 아예 없다 — 눌러서 여는 「?」 로 바꾼다.
  // 예전엔 화면 폭 768px 로 판단해, 1024px 태블릿에서는 hover 도 「?」 도 없어 볼 방법이 없었다.
  const isTouch = useIsTouch()

  const close = useCallback(() => {
    setOpen(false)
    if (closeOpenTooltip === close) closeOpenTooltip = null
  }, [])

  const calcAndOpen = useCallback(() => {
    if (!triggerRef.current) return
    // 다른 설명창이 떠 있으면 먼저 닫는다 — 한 번에 하나만 본다
    if (closeOpenTooltip && closeOpenTooltip !== close) closeOpenTooltip()
    const r = triggerRef.current.getBoundingClientRect()
    const cx = r.left + r.width / 2
    // left edge of tooltip, clamped to stay inside viewport
    const left = Math.max(8, Math.min(cx - maxWidth / 2, window.innerWidth - maxWidth - 8))
    if (placement === 'above') {
      setPos({ bottom: window.innerHeight - r.top + 6, left })
    } else {
      setPos({ top: r.bottom + 6, left })
    }
    setOpen(true)
    closeOpenTooltip = close
  }, [placement, maxWidth, close])

  /**
   * 열려 있는 동안에는 **다음 동작 아무거나** 하면 닫힌다.
   * 닫는 방법이 「?」 하나뿐이면, 설명을 본 뒤 하려던 일을 하기 전에 한 번 더 눌러야 한다.
   * 스크롤·회전에서도 닫는 이유는 말풍선이 고정 좌표라 기준 위치를 잃기 때문이다.
   */
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      // 「?」 자신을 누른 경우는 토글 동작이 처리한다
      if (triggerRef.current?.contains(e.target as Node)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, true)   // 안쪽 스크롤 영역까지 잡으려면 capture
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open, close])

  // 화면에서 사라질 때(탭 전환 등) 남은 말풍선을 정리한다
  useEffect(() => close, [close])

  const bubble = open ? createPortal(
    <div style={{
      position: 'fixed',
      top: pos.top,
      bottom: pos.bottom,
      left: pos.left,
      minWidth,
      maxWidth,
      zIndex: 9999,
      background: '#1a1a1a',
      color: '#fff',
      fontSize: 11.5,
      lineHeight: 1.55,
      padding: '8px 11px',
      borderRadius: 8,
      boxShadow: '0 3px 14px rgba(0,0,0,.4)',
      pointerEvents: 'none',
      whiteSpace: typeof text === 'string' ? 'pre-wrap' : 'normal',
      textAlign: 'left',
      wordBreak: 'keep-all',
    }}>
      {text}
    </div>,
    document.body
  ) : null

  return (
    <span
      ref={triggerRef}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3, ...wrapperStyle }}
      onMouseEnter={() => !isTouch && calcAndOpen()}
      onMouseLeave={() => !isTouch && close()}
    >
      {children}
      {isTouch && (
        <button
          type="button"
          aria-expanded={open}
          style={tt.iconBtn}
          onClick={e => { e.stopPropagation(); open ? close() : calcAndOpen() }}
        >
          ?
        </button>
      )}
      {bubble}
    </span>
  )
}

const tt: Record<string, React.CSSProperties> = {
  iconBtn: {
    // 손가락으로 누르는 자리 — 보이는 크기는 그대로 두고 눌리는 범위만 넓힌다
    width: 15, height: 15, borderRadius: '50%',
    border: '1px solid rgba(0,0,0,0.2)',
    background: 'rgba(0,0,0,0.08)', color: 'inherit',
    fontSize: 9, cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
  },
}
