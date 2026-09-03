import { useState } from 'react'
import { cancelOrder } from '../api/orders'
import { BTN } from '../styles/buttons'

/**
 * 주문 삭제 — **목록에서 뺀다. 행은 지워지지 않는다.**
 *
 * 「삭제」라고 부르지만 상태로 남긴다. 누가 언제 왜 지웠는지가 사라지면 나중에 아무도
 * 설명하지 못한다(견적 삭제가 서명된 계약까지 연쇄로 지운 사고가 있었다).
 *
 * ⚠️ **바로 지워지지 않는다.** 버튼을 눌러도 이 창이 먼저 뜨고, 사유를 적어야 눌린다 —
 *    되돌리기 어려운 조작은 한 번 더 물어야 한다.
 */
export function OrderRemoveModal({ orderId, onClose, onDone }: {
  orderId: number
  onClose: () => void
  onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function go() {
    setBusy(true); setErr('')
    try { await cancelOrder(orderId, reason.trim()); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : '주문 삭제에 실패했습니다') }
    finally { setBusy(false) }
  }

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.box} onClick={e => e.stopPropagation()}>
        <div style={s.title}>주문 #{orderId} 을(를) 삭제합니다</div>
        <div style={s.desc}>
          목록에서 빠집니다. 견적은 <b>계약완료</b>로 돌아가 다시 배정할 수 있고,
          주문 기록과 그동안의 서류는 <b>지워지지 않습니다.</b>
        </div>
        <label style={s.label}>삭제 사유<span style={s.req}> · 필수</span></label>
        <textarea
          style={s.input} rows={2} value={reason} maxLength={500}
          placeholder="예) 중복 배정 / 고객 요청으로 제작 보류"
          onChange={e => setReason(e.target.value)}
        />
        {err && <div style={s.err}>{err}</div>}
        <div style={s.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>취소</button>
          <button
            style={reason.trim() && !busy ? s.goBtn : BTN.disabled}
            disabled={!reason.trim() || busy}
            onClick={() => void go()}
          >{busy ? '처리 중…' : '삭제'}</button>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 70,
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
  req: { color: 'var(--req)', fontWeight: 400, fontSize: 'var(--fs-caption)' },
  input: {
    width: '100%', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit',
    fontSize: 'var(--fs-body)', padding: 'var(--sp-2)', borderRadius: 8, border: 'var(--hairline)',
  },
  err: { color: 'var(--warn)', fontSize: 'var(--fs-caption)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
  goBtn: { ...BTN.primary, background: 'var(--warn)', borderColor: 'var(--warn)' },
}
