import { useState } from 'react'
import { t, tf } from '../i18n'
import { unassignOrder } from '../api/orders'
import { BTN } from '../styles/buttons'
import { useEscapeClose } from '../lib/escClose'

/**
 * 배정 취소 — **수락 대기 주문을 배정 대기로 되돌린다**(2026-09-15).
 *
 * 특장사가 아직 받지 않은 발주를 관리자가 거둔다. 거둔 특장사에게는 목록에서 사라지고 알림이 간다.
 * 영업의 배정 요청은 살아 있어 바로 다른 곳에 배정할 수 있다. 되돌리기 어려운 조작이라 한 번 묻는다 — 사유는 선택.
 */
export function OrderUnassignModal({ orderId, makerName, onClose, onDone }: {
  orderId: number
  makerName: string
  onClose: () => void
  onDone: () => void
}) {
  useEscapeClose(onClose)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true); setErr('')
    try { await unassignOrder(orderId, reason.trim()); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : t('배정 취소에 실패했습니다')) }
    finally { setBusy(false) }
  }

  return (
    <div style={s.overlay} onClick={ev => { if (ev.target === ev.currentTarget) onClose() }}>
      <div style={s.box} role="dialog" aria-modal="true">
        <div style={s.title}>{tf('주문 #{0} 배정을 취소합니다', orderId)}</div>
        <div style={s.desc}>{tf('{0}에 맡긴 발주를 거두고 배정 대기로 되돌립니다. 특장사 목록에서 사라지고 알림이 가며, 바로 다시 배정할 수 있습니다.', makerName)}</div>
        <label style={s.label}>{t('사유 (선택)')}</label>
        <textarea
          style={s.input} rows={2} value={reason} maxLength={500}
          placeholder={t('예) 특장사 변경 / 사양 재확인')}
          onChange={e => setReason(e.target.value)}
        />
        {err && <div style={s.err}>{err}</div>}
        <div style={s.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>{t('닫기')}</button>
          <button style={busy ? BTN.disabled : s.goBtn} disabled={busy} onClick={() => void go()}>
            {busy ? t('처리 중…') : t('배정 취소')}
          </button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    // ⚠️ 발주서 조회 창(AcceptOrderModal, 1000) **위에서** 열린다 — 80 이었을 때 발주서에 가려 안 보였다(제보)
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
  },
  box: {
    background: '#fff', borderRadius: 12, padding: 'var(--sp-5)',
    width: 'min(440px, 94vw)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
    boxShadow: '0 10px 40px rgba(22,24,15,.22)',
  },
  title: { fontSize: 'var(--fs-title)', fontWeight: 700, color: 'var(--dark)' },
  desc: { fontSize: 'var(--fs-caption)', color: 'var(--body)', lineHeight: 1.6 },
  label: { fontSize: 'var(--fs-label)', fontWeight: 600, color: 'var(--dark)' },
  input: {
    width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit',
    fontSize: 'var(--fs-body)', padding: 'var(--sp-2)', borderRadius: 8, border: 'var(--hairline)',
  },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
  goBtn: { ...BTN.primary, background: 'var(--warn)', borderColor: 'var(--warn)' },
}
