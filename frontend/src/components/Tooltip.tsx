import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobile } from '../hooks/useIsMobile'

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

export function Tooltip({ text, children, placement = 'below', maxWidth = 220, minWidth = 150, wrapperStyle }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Pos>({ left: 0 })
  const triggerRef = useRef<HTMLSpanElement>(null)
  const isMobile = useIsMobile()

  const calcAndOpen = useCallback(() => {
    if (!triggerRef.current) return
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
  }, [placement, maxWidth])

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
      onMouseEnter={() => !isMobile && calcAndOpen()}
      onMouseLeave={() => !isMobile && setOpen(false)}
    >
      {children}
      {isMobile && (
        <button
          style={tt.iconBtn}
          onClick={e => { e.stopPropagation(); open ? setOpen(false) : calcAndOpen() }}
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
    width: 15, height: 15, borderRadius: '50%',
    border: '1px solid rgba(0,0,0,0.2)',
    background: 'rgba(0,0,0,0.08)', color: 'inherit',
    fontSize: 9, cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
  },
}
