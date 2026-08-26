import { useState } from 'react'
import { BTN } from '../styles/buttons'
import { sendQuoteEmail } from '../api/email'

/** 견적서(+계약서) 이메일 발송 모달. to 비우면 등록된 고객 이메일로 발송. */
export function EmailSendModal({ quoteId, customerName, defaultTo, onClose, noContract}: {
  quoteId: number
  customerName?: string
  defaultTo?: string
  onClose: () => void

  /** 차량만 견적 — 계약서가 없어 첨부 선택칸을 띄우지 않는다 */
  noContract?: boolean
}) {
  const [to, setTo] = useState(defaultTo ?? '')
  // 기본은 견적서만 — 계약서는 필요할 때만 체크해서 보낸다
  const [includeContract, setIncludeContract] = useState(false)
  /*
   * 차량만 견적에는 **계약서가 없다**(「특장 매매 및 구조변경 계약서」라 맞지 않는다).
   * 체크칸을 아예 없앤다 — 체크할 수 없는 칸을 회색으로 남겨 두면
   * 「왜 안 되지」를 묻게 되고, 답은 「원래 없는 서류」다.
   */
  const canAttachContract = !noContract
  const attachContract = canAttachContract && includeContract
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
        include_contract: attachContract,
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

            {canAttachContract && (
            <label style={s.check}>
              <input type="checkbox" checked={includeContract} onChange={(e) => setIncludeContract(e.target.checked)} />
              계약서도 함께 첨부 (미체크 시 견적서만)
            </label>
            )}

            <label style={s.label}>메시지</label>
            <textarea style={s.textarea} rows={4} value={message} placeholder="비우면 기본 안내문으로 발송" onChange={(e) => setMessage(e.target.value)} />

            <div style={s.note}>※ 견적서{attachContract ? '·계약서' : ''} PDF 가 첨부됩니다.{canAttachContract ? ' 전자서명은 별도(계약발송).' : ' 차량만 견적이라 계약서는 없습니다.'}</div>
            {err && <div style={s.err}>{err}</div>}
            <button style={s.primary} onClick={handleSend} disabled={sending}>{sending ? '발송 중…' : '발송'}</button>
          </div>
        )}
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  box: { width: 'min(440px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { ...BTN.secondary },
  form: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--body)', marginTop: 'var(--sp-1)' },
  input: { padding: '8px 10px', border: '0.5px solid var(--line)', borderRadius: 7, fontSize: 13 },
  textarea: { padding: '8px 10px', border: '0.5px solid var(--line)', borderRadius: 7, fontSize: 13, resize: 'vertical', fontFamily: 'inherit' },
  check: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', marginTop: 6 },
  note: { fontSize: 11, color: 'var(--muted)', marginTop: 4 },
  primary: { marginTop: 10, padding: '9px 16px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  ok: { background: 'var(--lime-bg)', color: 'var(--dark)', fontSize: 13, padding: '10px 12px', borderRadius: 8, marginBottom: 12 },
  err: { background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)', fontSize: 12.5, padding: '8px 12px', borderRadius: 8, marginTop: 4 },
}
