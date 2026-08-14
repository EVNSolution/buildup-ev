import { useEffect, useState } from 'react'
import { fetchContract, sendContract, contractSignedUrl, type ContractInfo } from '../api/contracts'
import { PdfModal } from './PdfModal'

const LABEL: Record<ContractInfo['status'], string> = {
  DRAFT: '발송 실패', SENT: '발송됨', VIEWED: '열람', SIGNING: '서명중',
  COMPLETED: '완료', REJECTED: '거절', CANCELED: '취소',
}
const COLOR: Record<ContractInfo['status'], React.CSSProperties> = {
  DRAFT: { background: 'var(--card)', color: 'var(--muted)' },
  SENT: { background: 'var(--card)', color: 'var(--dark)' },
  VIEWED: { background: 'var(--card)', color: 'var(--dark)' },
  SIGNING: { background: 'var(--warnbg)', color: 'var(--warn)' },
  COMPLETED: { background: 'var(--lime-bg)', color: 'var(--dark)' },
  REJECTED: { background: 'var(--warnbg)', color: 'var(--warn)' },
  CANCELED: { background: 'var(--card)', color: 'var(--muted)' },
}

/** 견적 기준 전자서명 계약 패널 — 발송(계약서+견적서 동봉)·상태·서명본. 영업/관리자. */
export function ContractPanel({ quoteId, customerName, customerEmail, customerPhone }: {
  quoteId: number
  customerName?: string
  /** 어디로 나가는지 보여주기 위한 값 — 발송은 서버가 견적에 저장된 정보로 한다 */
  customerEmail?: string
  customerPhone?: string
}) {
  const [contract, setContract] = useState<ContractInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [method, setMethod] = useState<'EMAIL' | 'KAKAO'>('EMAIL')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(false)

  // 고른 방식으로 실제 어디에 도착하는지. 비어 있으면 발송 자체를 막는다.
  const dest = method === 'EMAIL' ? (customerEmail ?? '').trim() : (customerPhone ?? '').trim()

  function load() {
    setLoading(true); setErr('')
    fetchContract(quoteId)
      .then(setContract)
      .catch(e => setErr(e instanceof Error ? e.message : '계약 상태 로드 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [quoteId])

  async function handleSend() {
    setSending(true); setErr('')
    try {
      setContract(await sendContract(quoteId, method))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '발송 실패')
    } finally {
      setSending(false)
    }
  }

  if (loading) return <div style={s.muted}>불러오는 중…</div>

  const inProgress = contract && ['SENT', 'VIEWED', 'SIGNING'].includes(contract.status)
  const resendable = !contract || ['REJECTED', 'CANCELED'].includes(contract.status)

  return (
    <div>
      {contract && (
        <div style={s.statusRow}>
          <span style={{ ...s.badge, ...COLOR[contract.status] }}>{LABEL[contract.status]}</span>
          <span style={s.meta}>
            {contract.signing_method === 'EMAIL' ? '이메일' : '카카오'}
            {contract.sent_at ? ` · 발송 ${contract.sent_at.slice(0, 16).replace('T', ' ')}` : ''}
          </span>
        </div>
      )}

      {contract && (
        <div style={s.timeline}>
          <div style={s.tlRow}>
            <span style={s.tlLabel}>서명 요청 발송</span>
            <span style={s.tlVal}>{contract.sent_at ? contract.sent_at.slice(0, 16).replace('T', ' ') : '—'}</span>
          </div>
          <div style={s.tlRow}>
            <span style={s.tlLabel}>서명 완료</span>
            <span style={s.tlVal}>
              {contract.completed_at ? contract.completed_at.slice(0, 16).replace('T', ' ')
                : contract.status === 'COMPLETED' ? '완료' : '대기'}
            </span>
          </div>
          {contract.sent_at && (
            <div style={s.frozen}>
              발송 시점의 견적서·계약서가 고정되었습니다. 이후 단가가 바뀌어도 문서는 바뀌지 않으며, 견적 입력도 수정할 수 없습니다.
            </div>
          )}
        </div>
      )}

      {contract?.status === 'COMPLETED' && contract.has_signed && (
        <button style={s.primary} onClick={() => setPreview(true)}>서명본 보기 / 다운로드</button>
      )}

      {inProgress && <div style={s.muted}>고객이 서명을 진행 중입니다. 완료되면 서명본이 저장됩니다.</div>}

      {resendable && (
        <div style={s.sendBox}>
          {contract && <div style={s.muted}>이전 계약이 {LABEL[contract.status]} 상태입니다. 재발송할 수 있습니다.</div>}
          <div style={s.methodRow}>
            <label style={s.radio}><input type="radio" checked={method === 'EMAIL'} onChange={() => setMethod('EMAIL')} /> 이메일</label>
            <label style={s.radio}><input type="radio" checked={method === 'KAKAO'} onChange={() => setMethod('KAKAO')} /> 카카오 알림톡</label>
          </div>
          {/* 서명 요청은 1건마다 과금된다 — 어디로 나가는지 누르기 전에 보여준다 */}
          <div style={dest ? s.dest : s.destWarn}>
            {dest
              ? <>받는 곳 <b>{dest}</b></>
              : method === 'EMAIL'
                ? '고객 이메일이 없어 보낼 수 없습니다 — 「수정 → 고객정보」에서 입력하세요.'
                : '고객 휴대폰번호가 없어 보낼 수 없습니다 — 「수정 → 고객정보」에서 입력하세요.'}
          </div>
          <button style={s.primary} onClick={handleSend} disabled={sending || !dest}>
            {sending ? '발송 중…' : (contract ? '재발송' : `계약서 발송${customerName ? ` (${customerName})` : ''}`)}
          </button>
          <div style={s.note}>※ 계약서(전자서명)와 견적서를 함께 발송합니다. 고객 연락처는 견적에 저장된 정보를 사용합니다.</div>
        </div>
      )}

      {err && <div style={s.err}>{err}</div>}

      {preview && (
        <PdfModal
          previewUrl={contractSignedUrl(quoteId)}
          downloadUrl={contractSignedUrl(quoteId)}
          title="특장매매계약서 서명본"
          subtitle={customerName}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  muted: { color: 'var(--muted)', fontSize: 13, padding: '6px 0' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  timeline: { background: 'var(--card)', borderRadius: 9, padding: '10px 12px', marginBottom: 12 },
  tlRow: { display: 'flex', justifyContent: 'space-between', fontSize: 14, padding: '3px 0' },
  tlLabel: { color: 'var(--muted)' },
  tlVal: { fontWeight: 700, color: 'var(--dark)' },
  frozen: { marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--line)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 },
  badge: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 },
  meta: { fontSize: 12, color: 'var(--muted)' },
  sendBox: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, maxWidth: 380 },
  methodRow: { display: 'flex', gap: 16 },
  radio: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' },
  primary: { padding: '9px 16px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  note: { fontSize: 11, color: 'var(--muted)' },
  dest: { fontSize: 12.5, color: 'var(--muted)', marginTop: 2 },
  destWarn: { fontSize: 'var(--fs-caption)', color: 'var(--warn)', marginTop: 2, lineHeight: 'var(--lh-body)' },
  err: { marginTop: 10, background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)', fontSize: 12.5, padding: '8px 12px', borderRadius: 8 },
}
