import { useState } from 'react'
import { useIsMobile } from '../hooks/useIsMobile'

interface Props {
  text: React.ReactNode
  children: React.ReactNode
  placement?: 'below' | 'above'
  maxWidth?: number
}

export function Tooltip({ text, children, placement = 'below', maxWidth = 210 }: Props) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()

  const bubblePos: React.CSSProperties = placement === 'above'
    ? { bottom: 'calc(100% + 5px)', top: 'auto' }
    : { top: 'calc(100% + 5px)', bottom: 'auto' }

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3 }}
      onMouseEnter={() => !isMobile && setOpen(true)}
      onMouseLeave={() => !isMobile && setOpen(false)}
    >
      {children}
      {isMobile && (
        <button
          style={tt.iconBtn}
          onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        >
          ?
        </button>
      )}
      {open && (
        <div style={{ ...tt.bubble, ...bubblePos, maxWidth }}>
          {text}
        </div>
      )}
    </span>
  )
}

const tt: Record<string, React.CSSProperties> = {
  iconBtn: {
    width: 15, height: 15, borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.4)',
    background: 'rgba(255,255,255,0.15)', color: 'inherit',
    fontSize: 9, cursor: 'pointer', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    padding: 0, lineHeight: 1,
  },
  bubble: {
    position: 'absolute',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 200,
    background: '#1a1a1a',
    color: '#fff',
    fontSize: 11.5,
    lineHeight: 1.55,
    padding: '8px 11px',
    borderRadius: 8,
    boxShadow: '0 3px 12px rgba(0,0,0,.3)',
    pointerEvents: 'none',
    whiteSpace: 'pre-wrap' as const,
    textAlign: 'left' as const,
  },
}
