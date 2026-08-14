import { useMemo, useState } from 'react'
import {
  checkDeliveryDue, deliveryDueLimit, fromDateInput, toDateInput,
  DELIVERY_DUE_BUSINESS_DAYS,
} from '@shared/schedule/businessDays'
import { BTN } from '../styles/buttons'

/**
 * 주문 수락 — **납기일을 같은 동작으로 받는다.**
 *
 * 수락만 먼저 받고 납기를 나중에 넣게 두면 납기 없는 주문이 생기고, 그 순간
 * 「언제 오냐」를 시스템이 답하지 못한다. 그래서 날짜를 넣기 전에는 수락 버튼이 열리지 않는다.
 *
 * 한도(발주일로부터 15영업일)는 발주서 특이사항이고, **판정 함수는 서버와 같은 것**을 쓴다
 * (`shared/schedule`). 화면에서 고를 수 있는데 서버가 거부하는 상황을 만들지 않기 위해서다.
 */
export function AcceptOrderModal({ orderId, customerName, orderedAt, busy, error, onAccept, onClose }: {
  orderId: number
  customerName: string
  /** 납기 한도의 기산점 = 배정일(발주일) */
  orderedAt: string
  busy: boolean
  error: string
  onAccept: (deliveryDue: string) => void
  onClose: () => void
}) {
  const base = useMemo(() => new Date(orderedAt), [orderedAt])
  const limit = useMemo(() => deliveryDueLimit(base), [base])
  const [due, setDue] = useState('')

  const parsed = fromDateInput(due)
  const check = parsed ? checkDeliveryDue(parsed, base) : null
  const reason = check && !check.ok ? check.reason : ''
  const canAccept = !!parsed && check?.ok === true && !busy

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.box} onClick={e => e.stopPropagation()}>
        <div style={m.title}>주문 #{orderId} 수락</div>
        <div style={m.desc}>
          {customerName} · 수락하면 <b>제작 착수</b> 상태가 되고, 아래 납기일이 약속으로 남습니다.
        </div>

        <div>
          <label style={m.label}>납기일<span style={m.req}> · 필수</span></label>
          <input
            type="date"
            value={due}
            min={toDateInput(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1))}
            max={toDateInput(limit)}
            onChange={e => setDue(e.target.value)}
            style={m.date}
          />
          {/*
            한도를 숫자로만 말하면 "그래서 며칠까지?"를 사람이 세야 한다 — 날짜로 알려준다.
          */}
          <div style={m.hint}>
            발주일 {toDateInput(base)} 기준 {DELIVERY_DUE_BUSINESS_DAYS}영업일 이내
            — <b>{toDateInput(limit)}</b>까지
          </div>
          {reason && <div style={m.warn}>{reason}</div>}
        </div>

        {error && <div style={m.err}>{error}</div>}

        <div style={m.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>취소</button>
          <button
            style={canAccept ? BTN.primary : BTN.disabled}
            disabled={!canAccept}
            onClick={() => parsed && onAccept(due)}
          >
            {busy ? '처리 중…' : '수락 · 제작 착수'}
          </button>
        </div>
      </div>
    </div>
  )
}

const m: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--sp-4)' },
  box: { background: '#fff', borderRadius: 14, padding: 'var(--sp-5)', width: 420, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--sp-4)' },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)', letterSpacing: 'var(--ls-tight)' },
  desc: { fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 'var(--lh-body)' },
  label: { display: 'block', fontSize: 'var(--fs-label)', color: 'var(--muted)', marginBottom: 'var(--sp-2)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  date: { width: '100%' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', marginTop: 'var(--sp-2)', lineHeight: 'var(--lh-body)' },
  warn: { fontSize: 'var(--fs-caption)', color: 'var(--warn)', marginTop: 'var(--sp-2)' },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
}
