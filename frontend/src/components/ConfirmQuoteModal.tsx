import { useEffect, useState } from 'react'
import { fetchInstallmentRates, saveQuoteInputs, confirmQuote, type InstallmentRateOption } from '../api/quotes'

/**
 * 견적서 확정 팝업 — 총견적서 입력시트의 추가 입력(선수금비율·할부개월수·면세구분·영업용번호판).
 * 임시저장(입력만 저장, 상태 유지) / 확정(입력 저장 + draft→confirmed + 견적서 생성).
 * 확정 이후(수정 모드)엔 '저장'만 노출.
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
  const [taxExempt, setTaxExempt] = useState<string>((init['tax_exempt_type'] as string) ?? '일반인')
  const [bizPlate, setBizPlate] = useState<boolean>((init['has_biz_plate'] as boolean) ?? false)
  const [rates, setRates] = useState<InstallmentRateOption[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
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

  async function handleTempSave() {
    setBusy(true); setErr(''); setMsg('')
    try { await saveQuoteInputs(quoteId, payload()); setMsg('임시저장되었습니다.'); onDone() }
    catch (e) { setErr(e instanceof Error ? e.message : '저장 실패') }
    finally { setBusy(false) }
  }

  async function handleConfirm() {
    setBusy(true); setErr(''); setMsg('')
    try {
      await saveQuoteInputs(quoteId, payload())
      if (!isConfirmed) await confirmQuote(quoteId)
      onDone(); onClose()
    } catch (e) { setErr(e instanceof Error ? e.message : '확정 실패') }
    finally { setBusy(false) }
  }

  return (
    <div style={s.overlay} onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div style={s.box}>
        <div style={s.head}>
          <span style={s.title}>{isConfirmed ? '견적 입력 수정' : '견적서 확정'}{customerName ? ` — ${customerName}` : ''}</span>
          <button style={s.close} onClick={onClose}>✕</button>
        </div>

        <div style={s.form}>
          <label style={s.label}>선수금 비율 <span style={s.unit}>(%)</span></label>
          <input style={s.input} type="number" min={0} max={100} step={1} value={downPct}
            onChange={(e) => setDownPct(e.target.value)} placeholder="예: 30" />

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

          <div style={s.note}>※ 확정 시 견적서가 생성됩니다. 확정 후에도 '수정'으로 값을 변경할 수 있습니다.</div>
          {msg && <div style={s.ok}>✓ {msg}</div>}
          {err && <div style={s.err}>{err}</div>}

          <div style={s.btnRow}>
            {!isConfirmed && (
              <button style={s.secondary} onClick={handleTempSave} disabled={busy}>임시저장</button>
            )}
            <button style={s.primary} onClick={handleConfirm} disabled={busy}>
              {busy ? '처리 중…' : isConfirmed ? '저장' : '확정 (견적서 생성)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 },
  box: { width: 'min(420px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontSize: 15, fontWeight: 700 },
  close: { border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 13 },
  form: { display: 'flex', flexDirection: 'column', gap: 7 },
  label: { fontSize: 12, fontWeight: 700, color: '#444', marginTop: 4 },
  unit: { fontSize: 10.5, color: '#8a929c', fontWeight: 400 },
  input: { padding: '8px 10px', border: '1px solid #ccc', borderRadius: 7, fontSize: 13, fontFamily: 'inherit' },
  check: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', marginTop: 8 },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
  note: { fontSize: 11, color: 'var(--muted)', marginTop: 6 },
  ok: { background: '#e8f5e9', color: '#2e7d32', fontSize: 12.5, padding: '8px 12px', borderRadius: 8 },
  err: { background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 12.5, padding: '8px 12px', borderRadius: 8 },
  btnRow: { display: 'flex', gap: 8, marginTop: 12 },
  secondary: { flex: 1, padding: '10px 14px', border: '1px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--dark)', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
  primary: { flex: 2, padding: '10px 16px', border: 'none', borderRadius: 8, background: 'var(--dark)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' },
}
