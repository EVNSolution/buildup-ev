import { useState } from 'react'
import { t, tf } from '../i18n'
import { rejectAssignRequest } from '../api/quotes'
import { BTN } from '../styles/buttons'
import { useEscapeClose } from '../lib/escClose'

/**
 * 배정 거부 — 영업의 **배정 요청을 사유와 함께 돌려보낸다**(2026-09-15).
 *
 * 견적은 영업에게 돌아가 「견적·주문」 목록 맨 위에 빨간 줄로 뜨고, 담당 영업에게 알림이 간다.
 * 사유는 필수 — 영업이 무엇을 고쳐 다시 요청할지 알아야 한다.
 *
 * ⚠️ 다른 창(발주서 등) 위에서 열릴 수 있어 맨 위 층에 둔다(배정 취소 확인창이 발주서에 가려졌던 일).
 */
export function AssignRejectModal({ quoteId, label, onClose, onDone }: {
  quoteId: number
  /** 견적번호·고객 — 무엇을 거부하는지 */
  label: string
  onClose: () => void
  onDone: () => void
}) {
  useEscapeClose(onClose)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true); setErr('')
    try { await rejectAssignRequest(quoteId, reason.trim()); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : t('배정 거부에 실패했습니다')) }
    finally { setBusy(false) }
  }

  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.box} role="dialog" aria-modal="true">
        <div style={s.title}>{tf('{0} 배정 요청을 거부합니다', label)}</div>
        <div style={s.desc}>{t('견적이 담당 영업에게 돌아가 목록 맨 위에 표시되고 알림이 갑니다. 영업이 다시 배정 요청하면 배정 대기로 돌아옵니다.')}</div>
        <label style={s.label}>{t('거부 사유')}<span style={s.req}> {t('· 필수')}</span></label>
        <textarea
          style={s.input} rows={3} value={reason} maxLength={500} autoFocus
          placeholder={t('예) 서명본에 고객 서명 누락 / 사양 확인 필요')}
          onChange={e => setReason(e.target.value)}
        />
        {err && <div style={s.err}>{err}</div>}
        <div style={s.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>{t('닫기')}</button>
          <button
            style={reason.trim() && !busy ? s.goBtn : BTN.disabled}
            disabled={!reason.trim() || busy}
            onClick={() => void go()}
          >{busy ? t('처리 중…') : t('배정 거부')}</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  // 발주서·목록 모달(1000) 위 — 어디에서 열어도 가리지 않는다
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
  },
  box: {
    background: '#fff', borderRadius: 12, padding: 'var(--sp-5)',
    width: 'min(440px, 94vw)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
    boxShadow: '0 10px 40px rgba(22,24,15,.22)',
  },
  title: { fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 'var(--fs-caption)', color: 'var(--body)', lineHeight: 1.6 },
  label: { fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--dark)' },
  req: { color: 'var(--req)', fontWeight: 400, fontSize: 'var(--fs-caption)' },
  input: {
    width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit',
    fontSize: 'var(--fs-input)', padding: 'var(--sp-2)', borderRadius: 8, border: 'var(--hairline)',
  },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
  goBtn: { ...BTN.primary, background: 'var(--warn)', borderColor: 'var(--warn)' },
}
