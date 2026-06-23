interface Props {
  quoteId: number
  customerName?: string
  onClose: () => void
}

export function PdfModal({ quoteId, customerName, onClose }: Props) {
  const previewUrl  = `/api/v1/quotes/${quoteId}/pdf`
  const downloadUrl = `/api/v1/quotes/${quoteId}/pdf?download=1`

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div style={s.overlay} onClick={handleOverlayClick}>
      <div style={s.modal}>
        <div style={s.toolbar}>
          <span style={s.title}>
            견적서
            {customerName ? <span style={s.titleSub}> — {customerName}</span> : null}
          </span>
          <div style={s.actions}>
            <a href={downloadUrl} download style={s.downloadBtn}>다운로드</a>
            <button style={s.closeBtn} onClick={onClose}>✕</button>
          </div>
        </div>
        <iframe
          src={previewUrl}
          style={s.frame}
          title="견적서 미리보기"
        />
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0,
    background: 'rgba(0,0,0,0.55)',
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
  frame: {
    flex: 1,
    border: 'none',
    width: '100%',
  },
}
