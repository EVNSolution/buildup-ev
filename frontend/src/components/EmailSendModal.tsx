import { useState } from 'react'
import { sendQuoteEmail } from '../api/email'

/** 견적서(+계약서) 이메일 발송 모달. to 비우면 등록된 고객 이메일로 발송. */
export function EmailSendModal({ quoteId, customerName, defaultTo, onClose }: {
  quoteId: number
  customerName?: string
  defaultTo?: string
  onClose: () => void
}) {
  const [to, setTo] = useState(defaultTo ?? '')
  // 기본은 견적서만 — 계약서는 필요할 때만 체크해서 보낸다
  const [includeContract, setIncludeContract] = useState(false)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [err, setErr] = useState('')

  async function handleSend() {
    setSending(true); setErr('')
    try {
      const r = await sendQuoteEmail(quoteId, {
        to: to.trim() || undefined,
        message: message.trim() || undefined,
        include_contract: includeContract,
      })
      setDone(`${r.to} 로 발송됨 (${r.attachments.join(', ')})`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '발송 실패')
    } finally {
      setSending(false)
    }
  }

  // 바깥 클릭으로 닫지 않는다 — 입력 중 실수로 눌러 값이 날아간다. 닫기는 ✕·취소로만.
  return (
    <div style={s.overlay}>
      <div style={s.box}>
        <div style={s.head}>
          <span style={s.title}>이메일 발송{customerName ? ` — ${customerName}` : ''}</span>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        {done ? (
          <div>
            <div style={s.ok}>✓ {done}</div>
            <button style={s.primary} onClick={onClose}>닫기</button>
          </div>
        ) : (
          <div style={s.form}>
            <label style={s.label}>받는 사람</label>
            <input style={s.input} value={to} placeholder="비우면 등록된 고객 이메일로 발송" onChange={(e) => setTo(e.target.value)} />

            <label style={s.check}>
              <input type="checkbox" checked={includeContract} onChange={(e) => setIncludeContract(e.target.checked)} />
              계약서도 함께 첨부 (미체크 시 견적서만)
            </label>

            <label style={s.label}>메시지 (선택)</label>
            <textarea style={s.textarea} rows={4} value={message} placeholder="비우면 기본 안내문으로 발송" onChange={(e) => setMessage(e.target.value)} />

            <div style={s.note}>※ 견적서{includeContract ? '·계약서' : ''} PDF 가 첨부됩니다. 전자서명은 별도(계약발송).</div>
            {err && <div style={s.err}>{err}</div>}
            <button style={s.primary} onClick={handleSend} disabled={sending}>{sending ? '발송 중…' : '발송'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  box: { width: 'min(440px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 13 },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 12, fontWeight: 700, color: '#444', marginTop: 4 },
  input: { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 7, fontSize: 13 },
  textarea: { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 7, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' },
  check: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 6 },
  note: { fontSize: 11, color: 'var(--muted)', marginTop: 4 },
  primary: { marginTop: 10, padding: '9px 16px', border: 'none', borderRadius: 8, background: '#1a1a1a', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  ok: { background: '#e8f5e9', color: '#2e7d32', fontSize: 13, padding: '10px 12px', borderRadius: 8, marginBottom: 12 },
  err: { background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, marginTop: 4 },
}
