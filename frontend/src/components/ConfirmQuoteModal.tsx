import { useEffect, useState } from 'react'
import { DownPaymentFields } from './DownPaymentFields'
import { BTN } from '../styles/buttons'
import { fetchInstallmentRates, saveQuoteInputs, confirmQuote, fetchTotalQuote, type InstallmentRateOption } from '../api/quotes'

/**
 * 견적서 생성 팝업 — **캐피탈 관련 입력만** 받는다 (선수금 비율 · 할부 개월수).
 *
 * ⚠️ 면세구분·영업용 번호판은 **묻지 않는다**(2026-08-21). 영업이 답을 알기 어려운데
 *    금액은 바뀌는 값이라, 아무거나 고른 답이 실구매가로 굳어졌다. 화면에서 뺐을 뿐
 *    계산·DB 는 그대로다 — 이미 저장된 견적의 값은 건드리지 않는다(`payload()` 주석).
 *
 * 고객 정보와 계약서 정보는 **견적 저장 단계**(QuoteSaveModal)로 옮겼다.
 * 한 팝업에 성격이 다른 입력이 섞여 있어 어디서 무엇을 고쳐야 하는지 알기 어려웠다.
 * 저장 후 고객정보를 고치는 것은 견적 목록의 고객정보 수정 경로를 쓴다.
 *
 * '견적서 생성' = 입력 저장 + draft→confirmed → 이후 '견적서' 버튼에서 PDF 조회 가능.
 * 생성 이후(수정 모드)엔 '저장'만 노출.
 *
 * ⚠️ **특장만 견적에는 여기서 받을 것이 하나도 없다.**
 *    선수금·할부 — 캐피탈은 차량과 특장을 묶어 실행한다. 차를 안 사면 실행할 것이 없다.
 *    답이 금액에 아무 영향도 주지 않는 질문이다. 물으면 「뭘 골라야 하나」만 남는다.
 *    그래서 특장만이면 입력 없이 **생성 버튼만** 둔다.
 */
interface Props {
  quoteId: number
  customerName?: string
  status: string
  initialInputs?: Record<string, unknown>
  /** 특장만 견적 — 캐피탈(선수금·할부) 입력을 받지 않는다 */
  bodyOnly?: boolean
  onClose: () => void
  onDone: () => void
}

export function ConfirmQuoteModal({ quoteId, customerName, status, initialInputs, bodyOnly = false, onClose, onDone }: Props) {
  const init = initialInputs ?? {}
  const isConfirmed = status !== 'draft'

  const [down, setDown] = useState<{ rate: number; amount?: number }>({
    rate: (init['down_payment_rate'] as number) ?? 0.3,
    // `null` 은 「금액 기준을 푼 것」 — 금액 기준으로 되살리면 안 된다
    ...(init['down_payment_amount'] != null ? { amount: init['down_payment_amount'] as number } : {}),
  })
  /** 비율↔금액을 서로 바꿔 보여 줄 기준 금액 — 서버 계산이 준 값을 쓴다 */
  const [base, setBase] = useState(0)
  const [months, setMonths] = useState<number>((init['installment_months'] as number) ?? 0)

  const [rates, setRates] = useState<InstallmentRateOption[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { fetchInstallmentRates().then(setRates).catch(() => {}) }, [])
  // 특장만이면 캐피탈이 없어 선수금 자체를 묻지 않는다 — 부를 이유도 없다
  useEffect(() => {
    if (bodyOnly) return
    fetchTotalQuote(quoteId).then(t => setBase(t.total.down_payment_base ?? 0)).catch(() => {})
  }, [quoteId, bodyOnly])

  function payload() {
    return {
      // 특장만이면 캐피탈이 없다 — 0으로 눌러 저장한다(shared 의 bodyOnlyParams 와 같은 값)
      down_payment_rate: bodyOnly ? 0 : down.rate,
      // 금액으로 정했을 때만 실어 보낸다 — 비율로 바꾸면 지워야 기준이 되돌아온다
      down_payment_amount: bodyOnly ? null : (down.amount ?? null),
      installment_months: bodyOnly ? 0 : months,
      /*
       * ⚠️ `tax_exempt_type`·`has_biz_plate` 는 **보내지 않는다.**
       *
       * 더 이상 묻지 않는 값이라 여기서 기본값을 실어 보내면, 이미 저장된 견적을 열어
       * 「저장」만 눌러도 그 값이 기본값으로 덮어써진다. 둘 다 **금액을 바꾸는 값**이라
       * (영업용 번호판=취득세 5%↔4%, 면세구분=서울 공채할인) 예전 견적의 실구매가가
       * 소리 없이 달라진다. 서버는 받은 키만 덮어쓰므로(PATCH inputs 는 merge),
       * 빼 두면 저장된 값이 그대로 남는다.
       */
    }
  }

  async function handleConfirm() {
    setBusy(true); setErr('')
    try {
      await saveQuoteInputs(quoteId, payload())
      if (!isConfirmed) await confirmQuote(quoteId)
      onDone(); onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : '견적서 생성 실패') }
    finally { setBusy(false) }
  }

  // 바깥 클릭으로 닫지 않는다 — 입력 중 실수로 눌러 값이 날아간다. 닫기는 ✕·취소로만.
  return (
    <div style={s.overlay}>
      <div style={s.box}>
        <div style={s.head}>
          <span style={s.title}>{isConfirmed ? '견적 입력 수정' : '견적서 생성'}{customerName ? ` — ${customerName}` : ''}</span>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        <div style={s.form}>
          {bodyOnly ? (
            <div style={s.ok}>
              특장만 견적입니다 — 할부(캐피탈)는 차량에 딸린 값이라 적용되지 않습니다.
              그대로 생성하시면 됩니다.
            </div>
          ) : (
            <>
              <DownPaymentFields
                base={base} rate={down.rate} amount={down.amount}
                onChange={setDown}
                Field={({ label, children }) => (
                  <>
                    <label style={s.label}>{label}</label>
                    {children}
                  </>
                )}
                inputStyle={s.input}
              />

              <label style={s.label}>할부 개월수 <span style={s.unit}>(개월 · 이율)</span></label>
              <select style={s.input} value={months} onChange={(e) => setMonths(Number(e.target.value))}>
                {rates.length === 0
                  ? <option value={0}>일시불</option>
                  : rates.map((r) => (
                    <option key={r.months} value={r.months}>
                      {r.label ?? (r.months === 0 ? '일시불' : `${r.months}개월`)}{r.months > 0 ? ` · ${(r.rate * 100).toFixed(1)}%` : ''}
                    </option>
                  ))
                }
              </select>

            </>
          )}

          <div style={s.note}>
            {isConfirmed
              ? '※ 저장하면 견적서·계약서에 즉시 반영됩니다.'
              : '※ 생성하면 견적서와 매매계약서가 각각 만들어지고, «견적서»·«계약서» 버튼에서 바로 열람할 수 있습니다. 생성 후에도 «수정»으로 값을 변경할 수 있습니다.'}
          </div>
          {err && <div style={s.err}>{err}</div>}

          <div style={s.btnRow}>
            <button style={s.primary} onClick={handleConfirm} disabled={busy}>
              {busy ? '처리 중…' : isConfirmed ? '저장' : '견적서 생성'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'var(--scrim)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  box: { width: 'min(420px, 94vw)', maxHeight: '88vh', overflowY: 'auto', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  divider: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '0.5px solid var(--line)' },
  dividerText: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  optional: { fontSize: 14, color: 'var(--muted)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { ...BTN.secondary },
  form: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: { fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--body)', marginTop: 'var(--sp-1)' },
  unit: { fontSize: 14, color: 'var(--muted)', fontWeight: 400 },
  input: { padding: '8px 10px', border: '0.5px solid var(--line)', borderRadius: 7, fontSize: 14, fontFamily: 'inherit' },
  check: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 8 },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
  note: { fontSize: 14, color: 'var(--muted)', marginTop: 6 },
  ok: { background: 'var(--lime-bg)', color: 'var(--dark)', fontSize: 14, padding: '8px 12px', borderRadius: 8 },
  err: { background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)', fontSize: 14, padding: '8px 12px', borderRadius: 8 },
  btnRow: { display: 'flex', gap: 8, marginTop: 12 },
  secondary: { flex: 1, padding: '10px 14px', border: '0.5px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--dark)', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  primary: { flex: 2, padding: '10px 16px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}
