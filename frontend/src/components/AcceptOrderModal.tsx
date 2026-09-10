import { useEffect, useMemo, useState } from 'react'
import { t, tc, tf } from '../i18n'
import type { ApiOrderOption } from '@shared/types/index'
import { checkDeliveryDue, deliveryDueLimit, fromDateInput, toDateInput, DELIVERY_DUE_BUSINESS_DAYS } from '@shared/schedule/businessDays'
import { loadHolidays } from '../lib/holidays'
import { fetchOrderDetail } from '../api/orders'
import { PurchaseOrderSheet } from './PurchaseOrderSheet'
import { hasAppendix } from '@shared/docs/appendix'
import type { PoLine } from '@shared/docs/po-lines'
import { DueDatePicker } from './DueDatePicker'
import { BTN } from '../styles/buttons'
import { useEscapeClose } from '../lib/escClose'
import { CarArrivalRow } from './CarArrivalRow'
import { rolesOf } from '@shared/types/index'
import { useAuth } from '../contexts/AuthContext'
import { usePermission } from './PermGate'

/**
 * 주문 수락 — **발주서 확인 · 납기 지정 · 수락을 한 자리에서.**
 *
 * 예전에는 「내용 보기」와 「수락」이 따로 있었다. 그러면 내용을 안 보고 수락하는 길이
 * 남고, 본 사람도 수락하려면 목록으로 되돌아가야 했다. 받는 행위는 하나다 —
 * 발주서를 읽고, 언제까지 만들지 정하고, 받는다. 위에서 아래로 그 순서로 놓는다.
 *
 * 특장사가 보는 서류는 발주서뿐이다(계약서·견적서는 서버에서 막았다).
 */
export function AcceptOrderModal({ orderId, makerOrgName, orderedAt, busy, error, onAccept, onClose, onReject, readOnly = false }: {
  orderId: number
  makerOrgName: string
  /** 납기 한도의 기산점 = 배정일(발주일) */
  orderedAt: string
  busy: boolean
  error: string
  /** 수락 — 납기일과 **커스텀 요청사항 확인 표시**를 함께 넘긴다(요청 하나로 끝낸다) */
  onAccept?: (deliveryDue: string, appendixAck: boolean) => void
  onClose: () => void
  /** 거부 — 사유를 받아 넘긴다. 없으면 거부 버튼이 뜨지 않는다. */
  onReject?: (reason: string) => void
  /**
   * **읽기 전용** — 발주서만 보여 주고 납기·수락·거부는 두지 않는다.
   *
   * 관리자가 쓰는 자리다. 관리자도 「특장사가 무엇을 받았는지」는 봐야 한다 —
   * 그 발주서를 쓴 사람이 관리자이기도 하다. 하지만 **받는 것은 특장사의 행위**다.
   * 관리자가 대신 수락하면 「누가 받기로 했는지」가 흐려지고, 특장사는 자기가 수락하지
   * 않은 주문의 납기를 지게 된다(대행 수락은 하지 않기로 정했다).
   */
  readOnly?: boolean
}) {
  // Esc 로도 닫힌다 — 바깥 클릭과 닫기 버튼은 둘 다 마우스가 필요한 길이다
  useEscapeClose(onClose)
  /*
   * 차량 도착 예정일 — **수락 대기에서도** 정할 수 있어야 한다.
   *
   * 관리자가 「주문 진행」에서 수락 대기 카드를 누르면 열리는 곳이 여기다(주문 상세가
   * 아니다). 도착 예정일이 상세에만 있으면 **아직 수락 안 된 건에는 손댈 자리가 없다**
   * — 정작 그때가 「차가 언제 갈지」를 알려 줘야 하는 때다(제보).
   *
   * 특장사에게는 읽기 전용으로 보인다. 납기를 고르는 자리에서 차가 언제 오는지는
   * 알아야 하는 값이다.
   */
  const { session } = useAuth()
  const isAdmin = rolesOf(session!.user).includes('ADMIN')
  const canControl = usePermission('order.control')
  const base = useMemo(() => {
    const d = new Date(orderedAt)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
  }, [orderedAt])
  /*
   * 이 발주의 한도(영업일). 배정할 때 얼려 둔 값을 받아 쓴다 —
   * 상수를 20으로 늘려도 15일 시절에 나간 발주서의 달력은 그대로다.
   */
  const [limitDays, setLimitDays] = useState(DELIVERY_DUE_BUSINESS_DAYS)
  /*
   * 공휴일 달력이 도착하면 한도를 **다시 센다.** 달력이 늦게 오면 연휴가 빠지지 않은
   * 짧은 한도가 잠깐 그려지고, 그 사이에 고른 날짜가 서버에서 거절된다.
   */
  const [calReady, setCalReady] = useState(false)
  useEffect(() => { void loadHolidays().then(() => setCalReady(true)) }, [])
  const limit = useMemo(() => deliveryDueLimit(base, limitDays), [base, limitDays, calReady])

  const [rejecting, setRejecting] = useState(false)

  const [reason, setReason] = useState('')

  const [due, setDue] = useState('')
  const [modelCode, setModelCode] = useState('')
  const [options, setOptions] = useState<ApiOrderOption[]>([])
  const [loadErr, setLoadErr] = useState('')
  /*
   * 커스텀 요청사항 — 서류 맨 아래 칸.
   * **읽었다는 표시 없이는 수락할 수 없다.** 「읽었다」를 기계가 알 방법이 없어
   * 그 칸 아래에서 **명시적으로** 체크하게 한다 — 스크롤이 지나갔다고 읽은 것은 아니다.
   */
  const [appendix, setAppendix] = useState('')
  /*
   * 비고 — **여기서 받아 온다.** 예전엔 부모가 넘기는 값이었는데 **두 호출부 어디도 넘기지 않아**,
   * 특장사가 보는 발주서의 비고 칸이 언제나 「특별 요청사항 없음」이었다(빈 값의 대체 문구).
   * 커스텀 건에서는 그 칸이 「아래 커스텀 요청사항을 확인하세요」라고 가리키는 자리라,
   * 비어 있으면 **그리로 가는 유일한 안내가 사라진다.**
   * 사양·요청사항과 같은 응답에서 함께 꺼내 쓴다 — 받아 오는 곳이 하나면 어긋날 일이 없다.
   */
  const [remark, setRemark] = useState('')
  /*
   * 발주서 **공급가 표** — 배정 때 얼려 둔 그대로 받아 그린다.
   * 여기서 다시 계산하지 않는다: 특장사가 받은 종이와 화면이 어긋나면 안 된다.
   */
  const [poLines, setPoLines] = useState<PoLine[]>([])
  const [acked, setAcked] = useState(false)
  const [carArrival, setCarArrival] = useState<string | null>(null)

  // 발주 내용(사양)은 목록 응답에 없다 — 팝업을 열 때 받아온다
  useEffect(() => {
    let alive = true
    fetchOrderDetail(orderId)
      .then(d => {
        if (!alive) return
        setModelCode(d.model_code); setOptions(d.options)
        setRemark(d.remark ?? '')
        setAppendix(d.appendix ?? '')
        setPoLines(Array.isArray(d.po_lines) ? d.po_lines as PoLine[] : [])
        // 이미 확인한 주문이면 다시 묻지 않는다 — 확인은 한 번이면 된다
        if (d.appendix_ack_at) setAcked(true)
        if (typeof d.due_limit_days === 'number') setLimitDays(d.due_limit_days)
        setCarArrival(d.car_arrival_planned_at ?? null)
      })
      .catch(e => { if (alive) setLoadErr(e instanceof Error ? e.message : t('발주 내용을 불러오지 못했습니다')) })
    return () => { alive = false }
  }, [orderId])

  const parsed = fromDateInput(due)
  const check = parsed ? checkDeliveryDue(parsed, base, limitDays) : null
  /*
   * 한도가 **이미 지난** 발주 — 고를 수 있는 날짜가 하나도 없다.
   * 이때 화면에 빈 달력만 두면 「왜 아무것도 안 눌리지」로 끝나고 주문이 멈춘다.
   * 서버 규칙(발주일 기준 15영업일)은 그대로 두고, 막힌 이유와 푸는 길을 말해 준다 —
   * 관리자가 다시 배정하면 발주일이 새로 찍혀 창이 열린다.
   */
  const windowClosed = limit < new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1)
  /*
   * 커스텀 요청사항이 있으면 **확인 체크 없이는 수락할 수 없다.** 비어 있으면 막지 않는다 —
   * 이 기능 전에 배정된 커스텀 주문은 그 칸이 없어서, 소급 적용하면 영영 못 받는다.
   */
  const appendixOk = !hasAppendix(appendix) || acked
  const canAccept = !!parsed && check?.ok === true && !busy && appendixOk

  return (
    <div style={m.overlay} onClick={onClose}>
      <div style={m.box} onClick={e => e.stopPropagation()}>
        {/* 제목은 「수락」이 아니라 주문 번호만 — 이 팝업은 보고 나서 수락·거부를 고르는 자리다 */}
        <div style={m.title}>
          {tf('주문 #{0}', orderId)}
          {readOnly && <span style={m.viewTag}> {t('· 조회 전용')}</span>}
        </div>

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
                remark={remark}
                appendix={appendix}
                poLines={poLines}
                dueLimitDays={limitDays}
                /*
                 * 커스텀 요청사항을 **읽었다는 표시** — 서류 안, 그 칸 바로 아래에 둔다.
                 * 예전엔 이게 2페이지(별지)라 「그 장을 열어야 체크가 나온다」로 강제했는데,
                 * 이제 서류가 한 장으로 이어져 그 칸이 눈앞에 있다. 체크는 그 자리에 붙인다.
                 */
                appendixFooter={!readOnly && hasAppendix(appendix) && (
                  <label style={m.ackRow}>
                    <input type="checkbox" checked={acked} disabled={busy}
                      onChange={e => setAcked(e.target.checked)} />
                    <span>{t('커스텀 요청사항을 확인했습니다')}</span>
                  </label>
                )}
              />
            )}

          {/* 차가 언제 오는지 — 납기를 고르기 전에 알아야 하는 값이다 */}
          <div style={m.arrivalBlock}>
            <CarArrivalRow
              orderId={orderId}
              value={carArrival}
              canEdit={isAdmin && canControl}
              onSaved={setCarArrival}
            />
          </div>

          <div style={m.dueBlock}>
            <div style={m.dueHead}>
              <span style={m.dueLabel}>{t('납기일')}{!readOnly && <span style={m.req}> {t('· 필수')}</span>}</span>
              {/*
                날짜는 **굵게** 둔다 — 여기서 눈이 멈추는 값이다. 그래서 한 문장으로 옮기지 못하고
                앞뒤로 나눈다. 영어는 「by」가 날짜 **앞**에 오므로 그 말을 앞조각에 넣고,
                뒷조각은 비운다(한국어의 「까지」가 갈 자리다).
              */}
              <span style={m.dueHint}>
                {tf('{0}영업일 · ', limitDays)}<b>{toDateInput(limit)}</b>{tc('까지', 'due')}
              </span>
            </div>
            {/*
              조회 전용에서는 **고르는 칸을 두지 않는다.** 고를 수 있게 두고 서버가 막으면
              「눌러 봤는데 안 된다」로 끝난다 — 할 수 없는 일은 애초에 보이지 않아야 한다.
            */}
            {readOnly && (
              <div style={m.viewNote}>
                {t('납기일은 배정된 특장사가 수락하면서 정합니다.')}
              </div>
            )}
            {readOnly ? null : windowClosed ? (
              <div style={m.closed}>
                <b>{tf('납기 한도({0})가 이미 지났습니다.', toDateInput(limit))}</b><br />
                {tf('이 발주서로는 납기일을 지정할 수 없습니다. 관리자에게 {0}을 요청하시면 발주일이 새로 지정되어 수락할 수 있습니다.', t('재배정'))}
              </div>
            ) : (
              <>
                {/* 고를 수 있는 날짜만 그린다 — 눌러 보고 나서 안 된다는 걸 알게 하지 않는다 */}
                <DueDatePicker orderedAt={base} value={due} onChange={setDue} limitDays={limitDays} holidaysReady={calReady} />
                <div style={m.picked}>
                  {due ? <>{t('납기일')} <b>{due}</b></> : t('납기일을 선택하십시오')}
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
            <div style={m.rejectTitle}>{t('이 주문을 거부합니다')}</div>
            <label style={m.rejectLabel}>{t('거부 사유')}<span style={m.req}> {t('· 필수')}</span></label>
            <textarea
              style={m.rejectInput} rows={3} value={reason} maxLength={500}
              placeholder={t('예) 요청 납기 내 제작이 어렵습니다 / 해당 사양은 제작 불가합니다')}
              onChange={e => setReason(e.target.value)}
            />
          </div>
        )}

        {error && <div style={m.err}>{error}</div>}

        <div style={m.actions}>
          <button style={BTN.secondary} onClick={onClose} disabled={busy}>{readOnly ? t('닫기') : t('취소')}</button>
          {readOnly ? null : !rejecting ? (
            <>
              <button style={m.rejectBtn} onClick={() => setRejecting(true)} disabled={busy}>{t('거부')}</button>
              <button
                style={canAccept ? BTN.primary : BTN.disabled}
                disabled={!canAccept}
                title={!appendixOk ? t('커스텀 요청사항을 확인해야 수락할 수 있습니다') : undefined}
                /*
                  ⚠️ 확인 표시를 **따로 쏘지 않는다.** 예전엔 `void ackAppendix(orderId)` 로
                     쏘고 기다리지 않은 채 곧바로 수락을 불러, 수락이 먼저 읽고 409 로
                     튕겼다 — 체크를 했는데 「확인해야 수락할 수 있습니다」가 떴다(제보).
                     확인은 수락 요청에 실어 보낸다.
                */
                onClick={() => { if (parsed) onAccept?.(due, acked) }}
              >
                {busy ? t('처리 중') : t('수락')}
              </button>
            </>
          ) : (
            <button
              style={reason.trim() && !busy ? m.rejectBtnOn : BTN.disabled}
              disabled={!reason.trim() || busy}
              onClick={() => onReject?.(reason.trim())}
            >
              {busy ? t('처리 중') : t('거부하기')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const m: Record<string, React.CSSProperties> = {
  /** 제목 줄 오른쪽의 장 넘기기 — 제목보다 커지지 않게 */
  pages: { marginLeft: 'var(--sp-3)', verticalAlign: 'middle' },
  /** 커스텀 요청사항 확인 — 그 칸 바로 아래. 읽고 나서 누르는 순서가 자리로 드러난다 */
  ackRow: {
    display: 'flex', alignItems: 'center', gap: 'var(--sp-2)',
    marginTop: 'var(--sp-3)', fontSize: 'var(--fs-label)', cursor: 'pointer',
  },
  /** 조회 전용 표시 — 제목 옆에 작게. 무엇을 할 수 없는 자리인지 먼저 말한다 */
  viewTag: { fontSize: 'var(--fs-label)', fontWeight: 400, color: 'var(--muted)' },
  viewNote: { fontSize: 'var(--fs-label)', color: 'var(--muted)', padding: 'var(--sp-2) 0' },
  rejectBtn: { ...BTN.secondary, color: 'var(--warn)', borderColor: 'var(--warn)' },
  rejectBtnOn: { ...BTN.primary, background: 'var(--warn)', borderColor: 'var(--warn)' },
  rejectBox: {
    border: '0.5px solid var(--warn)', background: 'var(--warnbg)', borderRadius: 8,
    padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
  },
  rejectTitle: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
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
  arrivalBlock: { borderTop: 'var(--hairline)', paddingTop: 'var(--sp-2)', marginTop: 'var(--sp-3)' },
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
