import { useEffect, useMemo, useState } from 'react'
import type { ApiPricingBundle, ApiQuote } from '@shared/types/index'
import { fetchPricingBundle } from '../api/models'
import {
  saveQuoteInputs, saveQuoteSelections, saveQuoteCustomer, fetchInstallmentRates,
  fetchQuoteHistory, type InstallmentRateOption, type QuoteChange,
} from '../api/quotes'
import { DEFAULT_TAX_EXEMPT_TYPE } from '@shared/pricing/core'
import { computeDisabledGroups, computeHidden, sanitizeSelections, groupsByCategory, OPTION_CATEGORY } from '../lib/optionRules'
import { VehicleOptionsTab } from './tabs/VehicleOptionsTab'
import { BodyOptionsTab } from './tabs/BodyOptionsTab'
import { InteriorOptionsTab } from './tabs/InteriorOptionsTab'
import { QuoteCustomerForm, missingRequired, type QuoteSaveValues } from './QuoteSaveModal'
import { customerEditValues, mapBizType } from '../lib/quoteCustomer'
import { fetchRegions } from '../api/quotes'
import { BTN } from '../styles/buttons'

/**
 * 견적 수정 — 옵션 · 고객정보 · 할부 를 **탭으로 나눠** 고친다.
 *
 * 예전엔 「수정」이 캐피탈 입력만, 「고객정보」가 고객만 여는 식으로 갈라져 있어
 * 무엇을 어디서 고치는지 외워야 했다. 이제 수정은 이 팝업 하나로 들어오고,
 * 「고객정보」 버튼은 **조회 전용**이 된다.
 *
 * 탭을 나눈 이유: 세 가지가 성격이 다르고 저장 대상(엔드포인트)도 다르다.
 * 한 화면에 전부 펼치면 무엇을 건드렸는지 알기 어렵고, 실수로 딴 값이 함께 나간다.
 * **탭마다 따로 저장**하며, 저장하면 그 탭에서 바뀐 값만 이력에 남는다.
 */
type TabKey = 'options' | 'customer' | 'inputs' | 'history'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'options', label: '옵션' },
  { key: 'customer', label: '고객정보' },
  { key: 'inputs', label: '할부' },
  { key: 'history', label: '이력' },
]

const TAX_EXEMPT_OPTIONS = ['일반인', '면세사업자', '기타']

/** 이력에 남는 필드 코드 → 사람이 읽는 이름 */
const FIELD_KO: Record<string, string> = {
  // 고객정보
  name: '성명(상호)', ceo_name: '대표이사', email: '이메일', phone: '휴대폰',
  tel: '유선번호', address: '주소', address_detail: '세부주소', reg_no: '생년월일/사업자번호',
  // 할부·입력
  down_payment_rate: '선수금 비율', installment_months: '할부 개월수',
  tax_exempt_type: '면세구분', has_biz_plate: '영업용 번호판',
  biz_type: '사업자 구분', is_sosang: '소상공인', region: '지역',
  has_transport_license: '화물운송 허가', diesel_status: '경유차 폐차여부',
  memo: '메모', local_subsidy_off: '지방보조금 미적용', promotion_zeroed: '프로모션',
  contract_party: '계약처', buyer_agent: '대리인', buyer_relation: '관계',
  buyer_regno: '생년월일/사업자번호(계약서)', buyer_tel: '유선번호(계약서)',
  // 옵션 그룹 코드
  TRIM: '차량 트림', BODYTYPE: '특장형태', TOP: '탑크기', DOORTYPE: '도어종류',
  DOORADD: '도어추가', PARTITION: '격벽', TEMP: '온도기록계',
}
const SECTION_KO: Record<string, string> = { options: '옵션', customer: '고객정보', inputs: '할부' }

interface Props {
  quote: ApiQuote
  onClose: () => void
  /** 저장으로 목록 금액·상태가 달라졌을 때 — 목록을 다시 읽게 한다 */
  onSaved: () => void
}

export function QuoteEditModal({ quote, onClose, onSaved }: Props) {
  // 고정된 견적은 고칠 수 없다 — 열자마자 볼 수 있는 것(이력)을 띄운다
  const [tab, setTab] = useState<TabKey>(() => (quote.docs_frozen_at ? 'history' : 'options'))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  // 서류가 고정되면(전자서명 발송) 어떤 탭도 저장할 수 없다 — 서명한 문서와 어긋나면 안 된다
  const frozen = !!quote.docs_frozen_at

  function done(text: string) { setMsg(text); setErr(''); onSaved() }
  function fail(e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패'); setMsg('') }

  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.head}>
          <span style={s.title}>견적 수정 — {quote.quote_no ?? `#${quote.id}`} · {quote.customer?.name ?? '고객 미지정'}</span>
          <button style={BTN.bar} onClick={onClose}>닫기</button>
        </div>

        {frozen && (
          <div style={s.frozen}>
            전자서명 발송으로 서류가 고정되어 수정할 수 없습니다 — 고객이 받은 문서와 어긋나면 안 되기 때문입니다.
            조건을 바꿔 다시 내려면 목록의 「복제」로 같은 고객·같은 옵션의 새 견적을 만드세요.
          </div>
        )}

        <div style={s.tabs}>
          {TABS.map(t => (
            <button key={t.key} style={tab === t.key ? s.tabOn : s.tab} onClick={() => { setTab(t.key); setMsg(''); setErr('') }}>
              {t.label}
            </button>
          ))}
        </div>

        {msg && <div style={s.ok}>✓ {msg}</div>}
        {err && <div style={s.err}>{err}</div>}

        <div style={s.body}>
          {tab === 'options'  && <OptionsTab quote={quote} frozen={frozen} busy={busy} setBusy={setBusy} onDone={done} onFail={fail} />}
          {tab === 'customer' && <CustomerTab quote={quote} frozen={frozen} busy={busy} setBusy={setBusy} onDone={done} onFail={fail} />}
          {tab === 'inputs'   && <InputsTab   quote={quote} frozen={frozen} busy={busy} setBusy={setBusy} onDone={done} onFail={fail} />}
          {tab === 'history'  && <HistoryTab  quoteId={quote.id} />}
        </div>
      </div>
    </div>
  )
}

// ── 옵션 탭 ────────────────────────────────────────────────────────────────
// 컨피규레이터와 **같은 화면 조각**(차량 트림·특장·옵션)을 그대로 쓴다.
// 규칙(감춤·잠금)도 같은 함수를 쓰므로, 여기서 고른 조합은 컨피규레이터에서도 유효하다.
function OptionsTab({ quote, frozen, busy, setBusy, onDone, onFail }: SubProps) {
  const [bundle, setBundle] = useState<ApiPricingBundle | null>(null)
  const [sel, setSel] = useState<Record<string, string>>({})
  const [loadErr, setLoadErr] = useState('')

  useEffect(() => {
    fetchPricingBundle(quote.model_code)
      .then(b => {
        setBundle(b)
        setSel(sanitizeSelections((quote.selections ?? {}) as Record<string, string>, b))
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : '옵션 목록 로드 실패'))
  }, [quote.model_code])

  const hidden = useMemo(
    () => (bundle ? computeHidden(sel, bundle) : { groups: new Set<string>(), values: new Set<string>() }),
    [bundle, sel],
  )
  const disabled = useMemo(
    () => (bundle ? computeDisabledGroups(sel, bundle) : new Set<string>()),
    [bundle, sel],
  )

  function pick(group: string, value: string) {
    if (!bundle) return
    setSel(prev => sanitizeSelections({ ...prev, [group]: value }, bundle))
  }

  async function save() {
    setBusy(true)
    try {
      const r = await saveQuoteSelections(quote.id, sel)
      onDone(r.changed ? `옵션 ${r.changed}건 변경 · 실구매가 ₩${r.final_price.toLocaleString('ko-KR')}` : '바뀐 옵션이 없습니다')
    } catch (e) { onFail(e) } finally { setBusy(false) }
  }

  if (loadErr) return <div style={s.err}>{loadErr}</div>
  if (!bundle) return <div style={s.loading}>옵션 목록을 불러오는 중…</div>

  const byCat = (cat: string) => groupsByCategory(bundle, cat, hidden.groups)

  return (
    <>
      <div style={s.scroll}>
        <div style={s.section}>차량 트림</div>
        <VehicleOptionsTab
          groups={byCat(OPTION_CATEGORY.vehicle)} selections={sel} onSelect={pick}
          hiddenValueCodes={hidden.values} optionPrices={bundle.option_prices}
        />
        <div style={s.section}>특장</div>
        <BodyOptionsTab
          groups={byCat(OPTION_CATEGORY.body)} selections={sel} onSelect={pick}
          disabledGroupCodes={disabled} hiddenValueCodes={hidden.values} optionPrices={bundle.option_prices}
        />
        <div style={s.section}>옵션</div>
        <InteriorOptionsTab
          groups={byCat(OPTION_CATEGORY.interior)} selections={sel} onSelect={pick}
          disabledGroupCodes={disabled} hiddenValueCodes={hidden.values} optionPrices={bundle.option_prices}
        />
      </div>
      <SaveBar frozen={frozen} busy={busy} onSave={save} note="옵션을 바꾸면 실구매가가 다시 계산됩니다." />
    </>
  )
}

// ── 고객정보 탭 ────────────────────────────────────────────────────────────
// 견적 저장 팝업과 **같은 폼**을 쓴다(QuoteCustomerForm). 한쪽에만 칸을 더하면
// 다른 쪽에서 고칠 수 없는 값이 생긴다 — 예전에 실제로 그랬다.
function CustomerTab({ quote, frozen, busy, setBusy, onDone, onFail }: SubProps) {
  const [v, setV] = useState<QuoteSaveValues>(() => customerEditValues(quote))
  const [regions, setRegions] = useState<string[]>([])
  useEffect(() => { fetchRegions().then(setRegions).catch(() => setRegions([])) }, [])

  const missing = missingRequired(v)

  async function save() {
    setBusy(true)
    try {
      // 고객 마스터도 함께 갱신한다 — 다음 견적에서 이 값들이 자동 기입된다.
      await saveQuoteCustomer(quote.id, {
        name: v.name.trim(),
        phone: v.phone,
        email: v.email.trim(),
        address: v.address.trim(),
        address_detail: v.address_detail.trim(),
        reg_no: v.buyer_regno.trim(),
        ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : '',
        tel: v.buyer_tel,
      })
      await saveQuoteInputs(quote.id, {
        biz_type: mapBizType(v.subsidy.business_type),
        is_sosang: v.subsidy.is_small_business ?? false,
        region: v.subsidy.region_code,
        has_transport_license: v.subsidy.has_transport_license ?? false,
        diesel_status: v.subsidy.diesel_status || 'none',
        // 개인으로 되돌리면 대표이사를 비운다 — 계약서 법인 줄이 남아 있으면 안 된다.
        ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : '',
        contract_party: v.contract_party.trim(),
        buyer_agent: v.buyer_agent.trim(),
        buyer_relation: v.buyer_relation.trim(),
        buyer_regno: v.buyer_regno.trim(),
        buyer_tel: v.buyer_tel,
      })
      onDone('고객정보를 저장했습니다')
    } catch (e) { onFail(e) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={s.scroll}>
        <QuoteCustomerForm v={v} setV={setV} regions={regions} />
      </div>
      <SaveBar
        frozen={frozen} busy={busy || missing.length > 0} onSave={save}
        note={missing.length ? `아직 ${missing.join(', ')} 을(를) 입력하지 않았습니다.` : '고친 값은 견적서·계약서에 즉시 반영됩니다.'}
      />
    </>
  )
}

// ── 할부 탭 ────────────────────────────────────────────────────────────────
function InputsTab({ quote, frozen, busy, setBusy, onDone, onFail }: SubProps) {
  const inp = (quote.inputs ?? {}) as Record<string, unknown>
  const [downPct, setDownPct] = useState(String(((inp['down_payment_rate'] as number) ?? 0.3) * 100))
  const [months, setMonths] = useState<number>((inp['installment_months'] as number) ?? 0)
  const [taxExempt, setTaxExempt] = useState((inp['tax_exempt_type'] as string) ?? DEFAULT_TAX_EXEMPT_TYPE)
  const [bizPlate, setBizPlate] = useState<boolean>((inp['has_biz_plate'] as boolean) ?? false)
  const [rates, setRates] = useState<InstallmentRateOption[]>([])

  useEffect(() => { fetchInstallmentRates().then(setRates).catch(() => {}) }, [])

  async function save() {
    setBusy(true)
    try {
      await saveQuoteInputs(quote.id, {
        down_payment_rate: (Number(downPct) || 0) / 100,
        installment_months: months,
        tax_exempt_type: taxExempt,
        has_biz_plate: bizPlate,
      })
      onDone('할부 조건을 저장했습니다')
    } catch (e) { onFail(e) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={s.scroll}>
        <div style={s.grid}>
          <Field label="선수금 비율 (%)">
            <input style={s.field} inputMode="numeric" value={downPct} onChange={e => setDownPct(e.target.value)} />
          </Field>
          <Field label="할부 개월수">
            <select style={s.field} value={months} onChange={e => setMonths(Number(e.target.value))}>
              <option value={0}>일시불</option>
              {rates.map(r => <option key={r.months} value={r.months}>{r.label ?? `${r.months}개월`}</option>)}
            </select>
          </Field>
          <Field label="면세구분">
            <select style={s.field} value={taxExempt} onChange={e => setTaxExempt(e.target.value)}>
              {TAX_EXEMPT_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="영업용 번호판">
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" style={bizPlate ? s.ynOn : s.ynOff} onClick={() => setBizPlate(true)}>예</button>
              <button type="button" style={!bizPlate ? s.ynOn : s.ynOff} onClick={() => setBizPlate(false)}>아니오</button>
            </div>
          </Field>
        </div>
      </div>
      <SaveBar frozen={frozen} busy={busy} onSave={save} note="선수금·할부를 바꾸면 실구매가가 다시 계산됩니다." />
    </>
  )
}

// ── 이력 탭 ────────────────────────────────────────────────────────────────
function HistoryTab({ quoteId }: { quoteId: number }) {
  const [rows, setRows] = useState<QuoteChange[] | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    fetchQuoteHistory(quoteId).then(setRows).catch(e => setErr(e instanceof Error ? e.message : '이력 조회 실패'))
  }, [quoteId])

  if (err) return <div style={s.err}>{err}</div>
  if (!rows) return <div style={s.loading}>이력을 불러오는 중…</div>
  if (!rows.length) return <div style={s.loading}>아직 수정한 기록이 없습니다.</div>

  return (
    <div style={s.scroll}>
      <table style={s.table}>
        <thead>
          <tr>
            <th style={s.th}>일시</th><th style={s.th}>구분</th><th style={s.th}>항목</th>
            <th style={s.th}>이전</th><th style={s.th}>변경</th><th style={s.th}>수정자</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={s.td}>{r.changed_at.replace('T', ' ').slice(0, 16)}</td>
              <td style={s.td}>{SECTION_KO[r.section] ?? r.section}</td>
              <td style={s.td}>{FIELD_KO[r.field] ?? r.field}</td>
              <td style={{ ...s.td, color: '#a12d2d' }}>{r.old_value ?? '—'}</td>
              <td style={{ ...s.td, color: '#2e7d32', fontWeight: 700 }}>{r.new_value ?? '—'}</td>
              <td style={s.td}>{r.changed_by}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── 공용 조각 ──────────────────────────────────────────────────────────────
interface SubProps {
  quote: ApiQuote
  frozen: boolean
  busy: boolean
  setBusy: (v: boolean) => void
  onDone: (msg: string) => void
  onFail: (e: unknown) => void
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ ...s.row, ...(full ? s.gridFull : null) }}>
      <label style={s.label}>{label}</label>
      {children}
    </div>
  )
}

function SaveBar({ frozen, busy, onSave, note }: { frozen: boolean; busy: boolean; onSave: () => void; note: string }) {
  return (
    <div style={s.saveBar}>
      <span style={s.note}>{note}</span>
      <button style={frozen || busy ? BTN.barDisabled : BTN.barPrimary} disabled={frozen || busy} onClick={onSave}>
        {busy ? '저장 중…' : '저장'}
      </button>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(20,20,20,.5)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60,
  },
  modal: {
    background: '#fff', borderRadius: 16, width: 760, maxWidth: '94vw', height: 'min(88vh, 760px)',
    padding: '18px 22px', boxShadow: '0 10px 40px rgba(0,0,0,.25)',
    display: 'flex', flexDirection: 'column', minHeight: 0,
  },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12 },
  title: { fontSize: 16, fontWeight: 700, color: 'var(--dark)' },
  frozen: {
    background: '#fdf1ee', border: '1px solid #f2c9be', color: '#8a3a2f',
    fontSize: 13, padding: '8px 11px', borderRadius: 8, marginBottom: 10,
  },
  tabs: { display: 'flex', gap: 4, borderBottom: '1px solid var(--line)', flexShrink: 0 },
  tab: {
    padding: '9px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 14, color: 'var(--muted)', borderBottom: '2px solid transparent',
  },
  tabOn: {
    padding: '9px 18px', border: 'none', background: 'transparent', cursor: 'pointer',
    fontSize: 14, color: 'var(--dark)', fontWeight: 700, borderBottom: '2px solid var(--lime)',
  },
  body: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 2px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 },
  gridFull: { gridColumn: '1 / -1' },
  section: {
    fontSize: 14, fontWeight: 700, color: 'var(--dark)',
    margin: '14px 0 8px', paddingBottom: 5, borderBottom: '1px solid var(--line)',
  },
  row: { marginBottom: 10 },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 4 },
  field: {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--dark)', border: '1px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  ynOff: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    border: '1px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--muted)',
  },
  ynOn: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
    border: '1px solid var(--lime)', borderRadius: 8, background: '#f7fadf', color: 'var(--dark)',
  },
  saveBar: {
    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, borderTop: '1px solid var(--line)', paddingTop: 12, marginTop: 4,
  },
  note: { fontSize: 13, color: 'var(--muted)' },
  ok: { background: '#e8f5e9', color: '#2e7d32', fontSize: 13, padding: '8px 11px', borderRadius: 8, marginTop: 10 },
  err: { background: '#fdecec', border: '1px solid #f0b8b8', color: '#a12d2d', fontSize: 13, padding: '8px 11px', borderRadius: 8, marginTop: 10 },
  loading: { padding: 24, color: 'var(--muted)', fontSize: 14 },
  table: { width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '7px 10px', borderBottom: '1px solid var(--line)', color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap' },
  td: { padding: '7px 10px', borderBottom: '1px solid #f0f2f4', whiteSpace: 'nowrap' },
}
