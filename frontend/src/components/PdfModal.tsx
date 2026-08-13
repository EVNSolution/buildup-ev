import { useState } from 'react'

interface Props {
  /** iframe 미리보기 URL */
  previewUrl: string
  /** 다운로드 버튼 URL (동일출처면 <a download> 로 서버 파일명 유지) */
  downloadUrl: string
  title: string
  subtitle?: string
  onClose: () => void
}

/** PDF 미리보기 모달 — 견적서·구조변경 서류 공통. 생성이 느릴 수 있어 로딩 표시 포함. */
export function PdfModal({ previewUrl, downloadUrl, title, subtitle, onClose }: Props) {
  const [loading, setLoading] = useState(true)

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div style={s.overlay} onClick={handleOverlayClick}>
      <div style={s.modal}>
        <div style={s.toolbar}>
          <span style={s.title}>
            {title}
            {subtitle ? <span style={s.titleSub}> — {subtitle}</span> : null}
          </span>
          <div style={s.actions}>
            <a href={downloadUrl} download style={s.downloadBtn}>다운로드</a>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>
        <div style={s.frameWrap}>
          {loading && (
            <div style={s.loading}>
              <div style={s.spinner} />
              <div>서류 생성 중…</div>
            </div>
          )}
          <iframe
            src={previewUrl}
            style={s.frame}
            title={`${title} 미리보기`}
            onLoad={() => setLoading(false)}
          />
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'var(--scrim)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    width: 'min(860px, 94vw)',
    height: '90vh',
    background: '#fff',
    borderRadius: 12,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 20px 60px rgba(0,0,0,0.35)',
  },
  toolbar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 16px',
    borderBottom: '1px solid #e0e0e0',
    flexShrink: 0,
    background: '#fafafa',
  },
  title: { fontSize: 14, fontWeight: 700, color: '#1a1a1a' },
  titleSub: { fontWeight: 400, color: '#888' },
  actions: { display: 'flex', gap: 8, alignItems: 'center' },
  downloadBtn: {
    padding: '6px 14px',
    border: '1px solid #c8d200',
    borderRadius: 7,
    background: '#f7f8f3',
    color: '#1a1a1a',
    fontWeight: 700,
    fontSize: 12,
    textDecoration: 'none',
    cursor: 'pointer',
  },
  closeBtn: {
    padding: '6px 12px',
    border: '1px solid #ddd',
    borderRadius: 7,
    background: '#fff',
    cursor: 'pointer',
    fontSize: 13,
    color: '#555',
  },
  frameWrap: { flex: 1, position: 'relative', minHeight: 0 },
  loading: {
    position: 'absolute', inset: 0,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
    background: '#fafafa', color: '#666', fontSize: 13,
  },
  spinner: {
    width: 28, height: 28, borderRadius: '50%',
    border: '3px solid #e0e0e0', borderTopColor: '#9aa832',
    animation: 'wcspin 0.8s linear infinite',
  },
  frame: {
    width: '100%', height: '100%',
    border: 'none',
  },
}
