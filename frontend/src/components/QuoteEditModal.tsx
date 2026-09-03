import { useEffect, useMemo, useState } from 'react'
import { DownPaymentFields } from './DownPaymentFields'
import type { ApiPricingBundle, ApiQuote } from '@shared/types/index'
import { fetchPricingBundle } from '../api/models'
import {
  saveQuoteInputs, saveQuoteSelections, saveQuoteCustomer, fetchInstallmentRates, fetchTotalQuote,
  fetchQuoteHistory, type InstallmentRateOption, type QuoteChange,
} from '../api/quotes'
import { computeDisabledGroups, computeHidden, sanitizeSelections, groupsByCategory, OPTION_CATEGORY } from '../lib/optionRules'
import { VehicleOptionsTab } from './tabs/VehicleOptionsTab'
import { BodyOptionsTab } from './tabs/BodyOptionsTab'
import { InteriorOptionsTab } from './tabs/InteriorOptionsTab'
import { QuoteCustomerForm, missingRequired, type QuoteSaveValues } from './QuoteSaveModal'
import { QuoteExtras } from './QuoteExtras'
import { CarPriceOverrideBlock } from './BodyOnlyPanel'
import { assembleOptionSum, trimPriceVatIncluded, checkCustomOptions, readCustomOptions } from '@shared/pricing/core'
import type { CustomOptionDraft } from '@shared/pricing/core'
import { customerEditValues, mapBizType, isBodyOnly } from '../lib/quoteCustomer'
import { fetchRegions } from '../api/quotes'
import { BTN } from '../styles/buttons'
import { usePermission } from './PermGate'

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

  // 서류가 고정되면(전자서명 발송) 어떤 탭도 저장할 수 없다 — 서명한 문서와 어긋나면 안 된다.
  // 수정 권한이 없어도 마찬가지 — 이력은 볼 수 있게 두고 저장만 막는다.
  const canEdit = usePermission('quote.edit')
  const frozen = !!quote.docs_frozen_at || !canEdit

  function done(text: string) { setMsg(text); setErr(''); onSaved() }
  function fail(e: unknown) { setErr(e instanceof Error ? e.message : '저장 실패'); setMsg('') }

  return (
    <div style={s.overlay}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <div style={s.head}>
          <span style={s.title}>
            {canEdit ? '견적 수정' : '견적 조회'} — {quote.quote_no ?? `#${quote.id}`} · {quote.customer?.name ?? '고객 미지정'}
          </span>
          <button style={BTN.bar} onClick={onClose}>닫기</button>
        </div>

        {frozen && (
          <div style={s.frozen}>
            {!canEdit
              ? '견적 수정 권한이 없습니다. 이력만 조회할 수 있습니다.'
              : '전자서명 발송으로 서류가 고정되어 수정할 수 없습니다 — 고객이 받은 문서와 어긋나면 안 되기 때문입니다. 조건을 바꿔 다시 내려면 목록의 「복제」로 같은 고객·같은 옵션의 새 견적을 만드세요.'}
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

  /*
   * 메모·지방보조금 소진·프로모션도 여기서 고친다.
   * 컨피규레이터에서 옵션 바로 아래에 있던 값들이고, 둘(프로모션·지방보조금)은
   * **금액을 바꾼다** — 저장 후 고칠 방법이 없으면 견적을 새로 만들어야 했다(실제 제보).
   */
  const inp = (quote.inputs ?? {}) as Record<string, unknown>
  const [memo, setMemo] = useState<string>((inp['memo'] as string) ?? '')
  const [localOff, setLocalOff] = useState<boolean>((inp['local_subsidy_off'] as boolean) ?? false)
  const [promoZeroed, setPromoZeroed] = useState<Set<string>>(
    () => new Set(((inp['promotion_zeroed'] as string[]) ?? [])),
  )
  // 프로모션 할인액(원, VAT 포함) — 옛 0원처리와 별개다
  const [promoDiscount, setPromoDiscount] = useState<number>(Number(inp['promotion_discount'] ?? 0))
  /*
   * 차량 가격 직접 입력 — 컨피규레이터에만 칸이 있으면 저장 후 고칠 방법이 없다.
   * 메모·프로모션이 그래서 여기로 옮겨 왔고, 이 값도 같은 이유로 여기 있어야 한다.
   * ⚠️ `!= null` — 저장된 `null` 은 「0원」이 아니라 「직접 입력을 안 씀」이다.
   */
  const [carPrice, setCarPrice] = useState<number | null>(
    inp['car_price_override'] != null ? Number(inp['car_price_override']) : null,
  )
  const [carTrimLabel, setCarTrimLabel] = useState<string>((inp['car_trim_label'] as string) ?? '')

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

  /*
   * 커스텀 특장 옵션 — **컨피규레이터와 같은 칸이 여기에도 있어야 한다.**
   * 한쪽에만 두면 저장 뒤에 고칠 수 없는 값이 생긴다(차량 가격 직접입력이 그랬다).
   */
  const [customOptions, setCustomOptions] = useState<CustomOptionDraft[]>(
    () => readCustomOptions(inp['custom_options']).map(o => ({ name: o.name, price: o.price })),
  )

  function pick(group: string, value: string) {
    if (!bundle) return
    setSel(prev => sanitizeSelections({ ...prev, [group]: value }, bundle))
  }

  async function save() {
    // 반쪽만 적힌 줄은 **여기서도** 막는다 — 서버와 같은 함수로 판정한다
    const custom = checkCustomOptions(customOptions)
    if (!custom.ok) { onFail(new Error(custom.message)); return }
    setBusy(true)
    try {
      /*
       * 순서가 중요하다 — 옵션을 먼저 저장하고 메모·할인을 저장한다.
       * 둘 다 실구매가를 다시 계산하는데, 나중 저장이 **바뀐 옵션까지 반영한** 값을 남긴다.
       * (반대로 하면 옵션 저장이 옛 할인으로 계산한 금액을 덮어쓴다)
       */
      const r = await saveQuoteSelections(quote.id, sel)
      const extrasChanged =
        memo.trim() !== ((inp['memo'] as string) ?? '').trim()
        || localOff !== ((inp['local_subsidy_off'] as boolean) ?? false)
        || promoDiscount !== Number(inp['promotion_discount'] ?? 0)
        || [...promoZeroed].sort().join(',') !== [...((inp['promotion_zeroed'] as string[]) ?? [])].sort().join(',')
        || carPrice !== (inp['car_price_override'] != null ? Number(inp['car_price_override']) : null)
        || carTrimLabel.trim() !== (((inp['car_trim_label'] as string) ?? '').trim())
        || JSON.stringify(custom.options) !== JSON.stringify(readCustomOptions(inp['custom_options']))
      await saveQuoteInputs(quote.id, {
        memo: memo.trim(),
        local_subsidy_off: localOff,
        promotion_discount: promoDiscount,
        promotion_zeroed: [...promoZeroed],
        // 끄면 `null` 을 보내 저장값을 지운다 — 0 을 보내면 차량가가 0원이 된다
        car_price_override: isBodyOnly(quote) ? null : carPrice,
        car_trim_label: isBodyOnly(quote) || carPrice == null ? '' : carTrimLabel.trim(),
        custom_options: custom.options,
      })
      // 할인·보조금을 함께 바꿨으면 여기 금액은 이미 지난 값이다(서버가 뒤에 다시 계산한다).
      // 그럴 땐 금액을 말하지 않는다 — 틀린 숫자를 보여 주느니 목록에서 확인하는 편이 낫다.
      onDone(
        extrasChanged ? '저장했습니다 — 목록에서 실구매가를 확인하세요'
        : r.changed ? `옵션 ${r.changed}건 변경 · 실구매가 ₩${r.final_price.toLocaleString('ko-KR')}`
        : '바뀐 값이 없습니다',
      )
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
          customOptions={customOptions}
          onCustomOptionsChange={frozen ? undefined : setCustomOptions}
        />

        {/* 컨피규레이터와 **같은 조각** — 한쪽에만 칸을 두면 다른 쪽에서 못 고치는 값이 생긴다 */}
        <div style={s.section}>차량 가격</div>
        <div style={s.extras}>
          <CarPriceOverrideBlock
            value={carPrice}
            onChange={setCarPrice}
            trimLabel={carTrimLabel}
            onTrimLabelChange={setCarTrimLabel}
            disabled={frozen || isBodyOnly(quote)}
            trimPrice={trimPriceVatIncluded(
              // 트림가만 쓴다 — 커스텀 옵션은 특장 쪽이라 여기서는 빈 목록으로 충분하다
              assembleOptionSum(sel, c => bundle.option_prices[c] ?? 0, [...promoZeroed], []).trim_price,
            )}
            trimName={bundle.groups.find(g => g.code === 'TRIM')?.values.find(v => v.code === sel['TRIM'])?.name}
          />
        </div>

        <div style={s.section}>메모 · 할인</div>
        <div style={s.extras}>
          <QuoteExtras
            bundle={bundle}
            selections={sel}
            optionPrices={bundle.option_prices}
            memo={memo} onMemoChange={setMemo}
            localSubsidyOff={localOff} onToggleLocalSubsidy={setLocalOff}
            promotionZeroed={promoZeroed}
            onTogglePromotion={g => setPromoZeroed(prev => {
              const next = new Set(prev)
              if (next.has(g)) next.delete(g); else next.add(g)
              return next
            })}
            promotionDiscount={promoDiscount}
            onPromotionDiscountChange={setPromoDiscount}
            disabled={frozen}
          />
        </div>
      </div>
      <SaveBar frozen={frozen} busy={busy} onSave={save} note="옵션·할인을 바꾸면 실구매가가 다시 계산됩니다." />
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

  // 특장만 견적은 보조금 조건을 묻지 않는다 — 화면에 없는 값을 필수로 두면 저장이 막힌다
  const missing = missingRequired(v, isBodyOnly(quote))

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
        {/* 특장만 견적이면 보조금 칸을 감춘다 — 필수 판정과 같은 조건을 봐야 한다 */}
        <QuoteCustomerForm v={v} setV={setV} regions={regions} bodyOnly={isBodyOnly(quote)} />
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
  const [down, setDown] = useState<{ rate: number; amount?: number }>({
    rate: (inp['down_payment_rate'] as number) ?? 0.3,
    // `null` 은 「금액 기준을 푼 것」 — 금액 기준으로 되살리면 안 된다
    ...(inp['down_payment_amount'] != null ? { amount: inp['down_payment_amount'] as number } : {}),
  })
  const [months, setMonths] = useState<number>((inp['installment_months'] as number) ?? 0)
  const [rates, setRates] = useState<InstallmentRateOption[]>([])
  /** 비율↔금액을 서로 바꿔 보여 줄 기준 금액 — 서버 계산이 준 값을 쓴다 */
  const [base, setBase] = useState(0)

  useEffect(() => { fetchInstallmentRates().then(setRates).catch(() => {}) }, [])
  useEffect(() => {
    fetchTotalQuote(quote.id).then(t => setBase(t.total.down_payment_base ?? 0)).catch(() => {})
  }, [quote.id])

  async function save() {
    setBusy(true)
    try {
      await saveQuoteInputs(quote.id, {
        down_payment_rate: down.rate,
        // 금액으로 정했을 때만 실어 보낸다 — 비율로 바꾸면 지워야 기준이 되돌아온다
        down_payment_amount: down.amount ?? null,
        installment_months: months,
        // ⚠️ `tax_exempt_type`·`has_biz_plate` 는 보내지 않는다 — 더 이상 묻지 않는 값이라
        //    기본값을 실어 보내면 저장만 눌러도 예전 견적의 실구매가가 달라진다.
        //    서버의 PATCH inputs 는 받은 키만 덮어쓰므로, 빼 두면 저장된 값이 그대로 남는다.
      })
      onDone('할부 조건을 저장했습니다')
    } catch (e) { onFail(e) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={s.scroll}>
        <div style={s.grid}>
          <DownPaymentFields
            base={base} rate={down.rate} amount={down.amount} disabled={frozen}
            onChange={setDown} Field={Field} inputStyle={s.field}
          />
          <Field label="할부 개월수">
            <select style={s.field} value={months} onChange={e => setMonths(Number(e.target.value))}>
              <option value={0}>일시불</option>
              {rates.map(r => <option key={r.months} value={r.months}>{r.label ?? `${r.months}개월`}</option>)}
            </select>
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
              <td style={{ ...s.td, color: 'var(--warn)' }}>{r.old_value ?? '—'}</td>
              <td style={{ ...s.td, color: 'var(--dark)', fontWeight: 700 }}>{r.new_value ?? '—'}</td>
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
    position: 'fixed', inset: 0, background: 'var(--scrim)',
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
    background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)',
    fontSize: 13, padding: '8px 11px', borderRadius: 8, marginBottom: 10,
  },
  tabs: { display: 'flex', gap: 4, borderBottom: '0.5px solid var(--line)', flexShrink: 0 },
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
  // 메모·할인 묶음 — 옵션 목록과 같은 좌우 여백을 쓰되 세로로 쌓는다
  extras: { display: 'flex', flexDirection: 'column' as const, gap: 8, paddingBottom: 4 },
  section: {
    fontSize: 14, fontWeight: 700, color: 'var(--dark)',
    margin: '14px 0 8px', paddingBottom: 5, borderBottom: '0.5px solid var(--line)',
  },
  row: { marginBottom: 10 },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 4 },
  field: {
    width: '100%', boxSizing: 'border-box', height: 36, padding: '0 10px', fontSize: 14,
    fontFamily: 'inherit', color: 'var(--dark)', border: '0.5px solid var(--line)',
    borderRadius: 8, background: '#fff', outline: 'none',
  },
  ynOff: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer',
    border: '0.5px solid var(--line)', borderRadius: 8, background: '#fff', color: 'var(--muted)',
  },
  ynOn: {
    flex: 1, height: 36, fontSize: 14, fontFamily: 'inherit', cursor: 'pointer', fontWeight: 700,
    border: '0.5px solid var(--lime)', borderRadius: 8, background: 'var(--lime-bg)', color: 'var(--dark)',
  },
  saveBar: {
    flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 12, borderTop: '0.5px solid var(--line)', paddingTop: 12, marginTop: 4,
  },
  note: { fontSize: 13, color: 'var(--muted)' },
  ok: { background: 'var(--lime-bg)', color: 'var(--dark)', fontSize: 13, padding: '8px 11px', borderRadius: 8, marginTop: 10 },
  err: { background: 'var(--warnbg)', border: '0.5px solid var(--warn)', color: 'var(--warn)', fontSize: 13, padding: '8px 11px', borderRadius: 8, marginTop: 10 },
  loading: { padding: 24, color: 'var(--muted)', fontSize: 14 },
  table: { width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontSize: 13 },
  th: { textAlign: 'left', padding: '7px 10px', borderBottom: '0.5px solid var(--line)', color: 'var(--muted)', fontSize: 12.5, whiteSpace: 'nowrap' },
  td: { padding: '7px 10px', borderBottom: '0.5px solid var(--card)', whiteSpace: 'nowrap' },
}
