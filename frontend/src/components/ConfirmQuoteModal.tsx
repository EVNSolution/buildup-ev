import { useEffect, useState } from 'react'
import { fetchInstallmentRates, saveQuoteInputs, confirmQuote, type InstallmentRateOption } from '../api/quotes'
import { DEFAULT_TAX_EXEMPT_TYPE } from '@shared/pricing/core'

/**
 * 견적서 생성 팝업 — **캐피탈 관련 입력만** 받는다
 * (선수금 비율 · 할부 개월수 · 면세구분 · 영업용 번호판).
 *
 * 고객 정보와 계약서 정보는 **견적 저장 단계**(QuoteSaveModal)로 옮겼다.
 * 한 팝업에 성격이 다른 입력이 섞여 있어 어디서 무엇을 고쳐야 하는지 알기 어려웠다.
 * 저장 후 고객정보를 고치는 것은 견적 목록의 고객정보 수정 경로를 쓴다.
 *
 * '견적서 생성' = 입력 저장 + draft→confirmed → 이후 '견적서' 버튼에서 PDF 조회 가능.
 * 생성 이후(수정 모드)엔 '저장'만 노출.
 */
interface Props {
  quoteId: number
  customerName?: string
  status: string
  initialInputs?: Record<string, unknown>
  onClose: () => void
  onDone: () => void
}

// 면세구분 — 엑셀 수식상 '일반인'+서울만 공채할인. 나머지는 placeholder(내일 수정 예정).
const TAX_EXEMPT_OPTIONS = ['일반인', '면세사업자', '기타']

export function ConfirmQuoteModal({ quoteId, customerName, status, initialInputs, onClose, onDone }: Props) {
  const init = initialInputs ?? {}
  const isConfirmed = status !== 'draft'

  const [downPct, setDownPct] = useState<string>(String(((init['down_payment_rate'] as number) ?? 0.3) * 100))
  const [months, setMonths] = useState<number>((init['installment_months'] as number) ?? 0)
  const [taxExempt, setTaxExempt] = useState<string>((init['tax_exempt_type'] as string) ?? DEFAULT_TAX_EXEMPT_TYPE)
  const [bizPlate, setBizPlate] = useState<boolean>((init['has_biz_plate'] as boolean) ?? false)

  const [rates, setRates] = useState<InstallmentRateOption[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => { fetchInstallmentRates().then(setRates).catch(() => {}) }, [])

  function payload() {
    return {
      down_payment_rate: (Number(downPct) || 0) / 100,
      installment_months: months,
      tax_exempt_type: taxExempt,
      has_biz_plate: bizPlate,
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
      <div className="scroll-hint" style={s.box}>
        <div style={s.head}>
          <span style={s.title}>{isConfirmed ? '견적 입력 수정' : '견적서 생성'}{customerName ? ` — ${customerName}` : ''}</span>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        <div style={s.form}>
          <label style={s.label}>선수금 비율 <span style={s.unit}>(%)</span></label>
          <input style={s.input} type="number" min={0} max={100} step={1} value={downPct}
            onChange={(e) => setDownPct(e.target.value)} />

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

          <label style={s.label}>면세구분</label>
          <select style={s.input} value={taxExempt} onChange={(e) => setTaxExempt(e.target.value)}>
            {TAX_EXEMPT_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>

          <label style={s.check}>
            <input type="checkbox" checked={bizPlate} onChange={(e) => setBizPlate(e.target.checked)} style={s.cbox} />
            영업용 번호판 보유 <span style={s.unit}>(취득세 4% 적용)</span>
          </label>

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
  divider: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--line)' },
  dividerText: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  optional: { fontSize: 14, color: '#8a929c' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 14 },
  form: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: { fontSize: 14, fontWeight: 700, color: '#444', marginTop: 4 },
  unit: { fontSize: 14, color: '#8a929c', fontWeight: 400 },
  input: { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 7, fontSize: 14, fontFamily: 'inherit' },
  check: { fontSize: 14, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 8 },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
  note: { fontSize: 14, color: 'var(--muted)', marginTop: 6 },
  ok: { background: '#e8f5e9', color: '#2e7d32', fontSize: 14, padding: '8px 12px', borderRadius: 8 },
  err: { background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 14, padding: '8px 12px', borderRadius: 8 },
  btnRow: { display: 'flex', gap: 8, marginTop: 12 },
  secondary: { flex: 1, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--dark)', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  primary: { flex: 2, padding: '10px 16px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
}
