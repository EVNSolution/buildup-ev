import { useEffect, useState } from 'react'
import { fetchContract, sendContract, contractSignedUrl, type ContractInfo } from '../api/contracts'
import { PdfModal } from './PdfModal'

const LABEL: Record<ContractInfo['status'], string> = {
  DRAFT: '초안', SENT: '발송됨', VIEWED: '열람', SIGNING: '서명중',
  COMPLETED: '완료', REJECTED: '거절', CANCELED: '취소',
}
const COLOR: Record<ContractInfo['status'], React.CSSProperties> = {
  DRAFT: { background: '#eee', color: '#555' },
  SENT: { background: '#e3f2fd', color: '#1565c0' },
  VIEWED: { background: '#e3f2fd', color: '#1565c0' },
  SIGNING: { background: '#fff3e0', color: '#e65100' },
  COMPLETED: { background: '#e8f5e9', color: '#2e7d32' },
  REJECTED: { background: '#fdecec', color: '#c0392b' },
  CANCELED: { background: '#f5f5f5', color: '#888' },
}

/** 견적 기준 전자서명 계약 패널 — 발송(계약서+견적서 동봉)·상태·서명본. 영업/관리자. */
export function ContractPanel({ quoteId, customerName }: { quoteId: number; customerName?: string }) {
  const [contract, setContract] = useState<ContractInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [method, setMethod] = useState<'EMAIL' | 'KAKAO'>('EMAIL')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(false)

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
          <button style={s.primary} onClick={handleSend} disabled={sending}>
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
  badge: { fontSize: 12, fontWeight: 700, padding: '3px 10px', borderRadius: 20 },
  meta: { fontSize: 12, color: 'var(--muted)' },
  sendBox: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8, maxWidth: 380 },
  methodRow: { display: 'flex', gap: 16 },
  radio: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' },
  primary: { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#1a1a1a', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', alignSelf: 'flex-start' },
  note: { fontSize: 11, color: 'var(--muted)' },
  err: { marginTop: 10, background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 12.5, padding: '8px 12px', borderRadius: 8 },
}
