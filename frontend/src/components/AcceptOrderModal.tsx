import { useEffect, useMemo, useState } from 'react'
import type { ApiOrderOption } from '@shared/types/index'
import { checkDeliveryDue, deliveryDueLimit, fromDateInput, toDateInput, DELIVERY_DUE_BUSINESS_DAYS } from '@shared/schedule/businessDays'
import { fetchOrderDetail } from '../api/orders'
import { PurchaseOrderSheet } from './PurchaseOrderSheet'
import { DueDatePicker } from './DueDatePicker'
import { BTN } from '../styles/buttons'

/**
 * 주문 수락 — **발주서 확인 · 납기 지정 · 수락을 한 자리에서.**
 *
 * 예전에는 「내용 보기」와 「수락」이 따로 있었다. 그러면 내용을 안 보고 수락하는 길이
 * 남고, 본 사람도 수락하려면 목록으로 되돌아가야 했다. 받는 행위는 하나다 —
 * 발주서를 읽고, 언제까지 만들지 정하고, 받는다. 위에서 아래로 그 순서로 놓는다.
 *
 * 특장사가 보는 서류는 발주서뿐이다(계약서·견적서는 서버에서 막았다).
 */
export function AcceptOrderModal({ orderId, makerOrgName, orderedAt, busy, error, onAccept, onClose , onReject}: {
  orderId: number
  makerOrgName: string
  /** 납기 한도의 기산점 = 배정일(발주일) */
  orderedAt: string
  busy: boolean
  error: string
  onAccept: (deliveryDue: string) => void
  onClose: () => void
  /** 거부 — 사유를 받아 넘긴다. 없으면 거부 버튼이 뜨지 않는다. */
  onReject?: (reason: string) => void
}) {
  const base = useMemo(() => {
    const d = new Date(orderedAt)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }, [orderedAt])
  const limit = useMemo(() => deliveryDueLimit(base), [base])

  const [rejecting, setRejecting] = useState(false)

  const [reason, setReason] = useState('')

  const [due, setDue] = useState('')
  const [modelCode, setModelCode] = useState('')
  const [options, setOptions] = useState<ApiOrderOption[]>([])
  const [loadErr, setLoadErr] = useState('')

  // 발주 내용(사양)은 목록 응답에 없다 — 팝업을 열 때 받아온다
  useEffect(() => {
    let alive = true
    fetchOrderDetail(orderId)
      .then(d => { if (alive) { setModelCode(d.model_code); setOptions(d.options) } })
      .catch(e => { if (alive) setLoadErr(e instanceof Error ? e.message : '발주 내용을 불러오지 못했습니다') })
    return () => { alive = false }
  }, [orderId])

  const parsed = fromDateInput(due)
  const check = parsed ? checkDeliveryDue(parsed, base) : null
  /*
   * 한도가 **이미 지난** 발주 — 고를 수 있는 날짜가 하나도 없다.
   * 이때 화면에 빈 달력만 두면 「왜 아무것도 안 눌리지」로 끝나고 주문이 멈춘다.
   * 서버 규칙(발주일 기준 15영업일)은 그대로 두고, 막힌 이유와 푸는 길을 말해 준다 —
   * 관리자가 다시 배정하면 발주일이 새로 찍혀 창이 열린다.
   */
  const windowClosed = limit < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1)
  const canAccept = !!parsed && check?.ok === true && !busy

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.box} onClick={e => e.stopPropagation()}>
        <div style={m.title}>주문 #{orderId} 수락</div>

        <div style={m.scroll}>
          {loadErr
            ? <div style={m.err}>{loadErr}</div>
            : (
              <PurchaseOrderSheet
                orderId={orderId}
                orderedAt={base}
                makerOrgName={makerOrgName}
                modelCode={modelCode}
                options={options}
                deliveryDue={due}
              />
            )}

          <div style={m.dueBlock}>
            <div style={m.dueHead}>
              <span style={m.dueLabel}>납기일<span style={m.req}> · 필수</span></span>
              <span style={m.dueHint}>
                {DELIVERY_DUE_BUSINESS_DAYS}영업일 · <b>{toDateInput(limit)}</b>까지
              </span>
            </div>
            {windowClosed ? (
              <div style={m.closed}>
                <b>납기 한도({toDateInput(limit)})가 이미 지났습니다.</b><br />
                이 발주서로는 납기일을 지정할 수 없습니다. 관리자에게 <b>재배정</b>을 요청하시면
                발주일이 새로 지정되어 수락할 수 있습니다.
              </div>
            ) : (
              <>
                {/* 고를 수 있는 날짜만 그린다 — 눌러 보고 나서 안 된다는 걸 알게 하지 않는다 */}
                <DueDatePicker orderedAt={base} value={due} onChange={setDue} />
                <div style={m.picked}>
                  {due ? <>납기일 <b>{due}</b></> : '납기일을 선택하십시오'}
                </div>
              </>
            )}
          </div>
        </div>

        {/*
          거부 — **못 받겠다고 알리는 문.**
          예전에는 수락밖에 없어서, 못 받는 주문을 붙들고 있거나 전화로 알려야 했다.
          그 사이 그 주문은 배정된 것처럼 보인다.

          사유를 적어야 눌린다 — 「왜 안 받았는지」가 없으면 다시 배정할 수도, 고칠 수도 없다.
        */}
        {rejecting && (
          <div style={m.rejectBox}>
            <div style={m.rejectTitle}>이 주문을 거부합니다</div>
            <div style={m.rejectDesc}>
              배정이 풀려 <b>다른 특장사에 다시 맡길 수 있게</b> 됩니다. 계약은 그대로입니다.
            </div>
            <label style={m.rejectLabel}>거부 사유<span style={m.req}> · 필수</span></label>
            <textarea
              style={m.rejectInput} rows={3} value={reason} maxLength={500}
              placeholder="예) 요청 납기 내 제작이 어렵습니다 / 해당 사양은 제작 불가합니다"
              onChange={e => setReason(e.target.value)}
            />
          </div>
        )}

        {error && <div style={m.err}>{error}</div>}

        <div style={m.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>취소</button>
          {!rejecting ? (
            <>
              <button style={m.rejectBtn} onClick={() => setRejecting(true)} disabled={busy}>거부</button>
              <button
                style={canAccept ? BTN.primary : BTN.disabled}
                disabled={!canAccept}
                onClick={() => parsed && onAccept(due)}
              >
                {busy ? '처리 중' : '수락'}
              </button>
            </>
          ) : (
            <button
              style={reason.trim() && !busy ? m.rejectBtnOn : BTN.disabled}
              disabled={!reason.trim() || busy}
              onClick={() => onReject?.(reason.trim())}
            >
              {busy ? '처리 중' : '거부하기'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const m: Record<string, React.CSSProperties> = {
  rejectBtn: { ...BTN.secondary, color: 'var(--warn)', borderColor: 'var(--warn)' },
  rejectBtnOn: { ...BTN.primary, background: 'var(--warn)', borderColor: 'var(--warn)' },
  rejectBox: {
    border: '0.5px solid var(--warn)', background: 'var(--warnbg)', borderRadius: 8,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
  },
  rejectTitle: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  rejectDesc: { fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 },
  rejectLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  rejectInput: {
    width: '100%', fontSize: 13, padding: '8px 10px', borderRadius: 7,
    border: '0.5px solid var(--line)', background: '#fff', resize: 'vertical', fontFamily: 'inherit',
  },
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 'var(--sp-4)' },
  box: {
    background: '#fff', borderRadius: 14, padding: 'var(--sp-5)', width: 520, maxWidth: '100%',
    maxHeight: '88vh', display: 'flex', flexDirection: 'column', gap: 'var(--sp-3)',
  },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)', letterSpacing: 'var(--ls-tight)' },
  // 발주서가 길어도 버튼줄은 늘 보인다
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' },
  dueBlock: { marginTop: 'var(--sp-4)' },
  dueHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--sp-2)', marginBottom: 'var(--sp-2)' },
  dueLabel: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  req: { color: 'var(--req)', fontWeight: 700 },
  dueHint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  picked: { marginTop: 'var(--sp-2)', fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  closed: {
    fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)',
    border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)',
    padding: 'var(--sp-3)', lineHeight: 'var(--lh-body)',
  },
  err: { fontSize: 'var(--fs-label)', color: 'var(--warn)', background: 'var(--warnbg)', border: '0.5px solid var(--warn)', borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)' },
  actions: { display: 'flex', gap: 'var(--sp-2)', justifyContent: 'flex-end' },
}
