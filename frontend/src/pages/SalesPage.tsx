import { useEffect, useMemo, useState } from 'react'
import { openPdf } from '../lib/openPdf'
import { computeHidden, computeDisabledGroups, sanitizeSelections } from '../lib/optionRules'
import { mapBizType } from '../lib/quoteCustomer'
import type { CustomerInfo, ApiPricingBundle, ApiQuote, ApiOrder } from '@shared/types/index'
import type { PricingResult, PricingOk } from '@shared/pricing/core'
import { calcPrice, calcQuote, assembleOptionSum, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY, DEFAULT_TAX_EXEMPT_TYPE } from '@shared/pricing/core'
import type { QuoteResult } from '@shared/pricing/core'
import { fetchPricingBundle } from '../api/models'
import { saveQuote, fetchLocalSubsidy, fetchQuotes, fetchRegions } from '../api/quotes'
import type { SaveQuoteRequest } from '../api/quotes'
import { fetchOrders } from '../api/orders'
import { BTN } from '../styles/buttons'
import stegoSide from '../assets/stego-k-side.jpg'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { offValueCode } from '../components/OptionToggle'
import { QuoteSaveModal, valuesFromCustomer, type QuoteSaveValues } from '../components/QuoteSaveModal'
import { DEFAULT_SUBSIDY_INPUTS, type SubsidyInputs } from '../components/SubsidyInputs'
import { ContractPanel } from '../components/ContractPanel'
import { QuoteEditModal } from '../components/QuoteEditModal'
import { CustomerViewModal } from '../components/CustomerViewModal'
import { EmailSendModal } from '../components/EmailSendModal'
import { ConfirmQuoteModal } from '../components/ConfirmQuoteModal'
import { Tooltip } from '../components/Tooltip'
import { usePermission } from '../components/PermGate'
import { useAuth } from '../contexts/AuthContext'


// option_rule 해석(감춤·잠금·정리)은 lib/optionRules.ts 로 옮겼다 — 수정 팝업과 공용.

// ── 내 견적·주문 뷰 ────────────────────────────────────────────────────────
const QUOTE_STATUS_KO: Record<string, string> = {
  draft: '임시저장', confirmed: '견적확정', contracted: '계약완료',
  assigned: '배정완료', ordered: '주문진행', completed: '완료', expired: '만료',
}

const QUOTE_STATUS_FLOW = [
  { key: 'draft',      label: '임시저장', desc: '작성 중인 견적' },
  { key: 'confirmed',  label: '견적확정', desc: '견적서 생성 완료' },
  { key: 'contracted', label: '계약완료', desc: '전자서명 완료' },
  { key: 'assigned',   label: '배정완료', desc: '관리자가 특장사 배정' },
  { key: 'ordered',    label: '주문진행', desc: '특장사 수락 · 제작 진행' },
  { key: 'completed',  label: '완료',     desc: '특장사 전 공정 완료' },
] as const

function quoteStatusTip(status: string): React.ReactNode {
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 5, fontSize: 10.5, letterSpacing: 0.3 }}>견적 상태</div>
      {QUOTE_STATUS_FLOW.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 0', fontWeight: s.key === status ? 700 : 400, color: s.key === status ? '#c8d200' : '#ccc', fontSize: 11 }}>
          <span style={{ width: 16, textAlign: 'center', flexShrink: 0 }}>{i + 1}</span>
          <span>{s.label}</span>
          <span style={{ fontSize: 9.5, color: s.key === status ? '#b0b8c0' : '#666', marginLeft: 2 }}>({s.desc})</span>
          {s.key === status && <span style={{ fontSize: 9, color: '#c8d200', marginLeft: 2 }}>← 현재</span>}
        </div>
      ))}
      {status === 'expired' && <div style={{ fontSize: 10, color: '#e57373', marginTop: 5 }}>만료/취소된 견적입니다</div>}
    </div>
  )
}
const ORDER_STATUS_BADGE: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8,
  background: 'var(--lime)', color: 'var(--dark)',
}

// 전자서명 진행 상태 — 팝업을 열지 않아도 목록에서 바로 보이게 한다.
const CONTRACT_LABEL: Record<string, string> = {
  DRAFT: '발송 실패', SENT: '서명 대기', VIEWED: '열람', SIGNING: '서명 중',
  COMPLETED: '서명 완료', REJECTED: '거절', CANCELED: '취소',
}
const CONTRACT_TONE: Record<string, React.CSSProperties> = {
  COMPLETED: { background: '#eef7e9', borderColor: '#cfe4c2', color: '#3d6b28' },
  REJECTED:  { background: '#fdecec', borderColor: '#f0b8b8', color: '#a12d2d' },
  CANCELED:  { background: '#fdecec', borderColor: '#f0b8b8', color: '#a12d2d' },
}

function ContractBadge({ c }: { c?: { status: string; sent_at: string | null; completed_at: string | null } | null }) {
  if (!c) return <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
  const when = c.completed_at ?? c.sent_at
  return (
    <Tooltip text={`${CONTRACT_LABEL[c.status] ?? c.status}${when ? ` · ${when.slice(0, 10)}` : ''}`} placement="below">
      <span style={{
        display: 'inline-block', whiteSpace: 'nowrap', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
        border: '1px solid var(--line)', background: '#f6f7f8', color: '#6b7280',
        ...(CONTRACT_TONE[c.status] ?? {}),
      }}>{CONTRACT_LABEL[c.status] ?? c.status}</span>
    </Tooltip>
  )
}

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string)  { return s ? s.slice(0, 10) : '—' }



function MyListView() {
  const [quotes, setQuotes]   = useState<ApiQuote[]>([])
  const [orders, setOrders]   = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [contractQuote, setContractQuote] = useState<{ id: number; customerName?: string } | null>(null)
  const [emailQuote, setEmailQuote] = useState<{ id: number; customerName?: string } | null>(null)
  const [confirmQuoteModal, setConfirmQuoteModal] = useState<
    { id: number; customerName?: string; status: string; inputs?: Record<string, unknown>; customer?: ApiQuote['customer'] } | null
  >(null)
  /** 고객정보 수정 — 저장 모달을 수정 모드로 재사용한다(입력 구성이 같다). */
  // 「수정」 = 옵션·고객정보·할부 3탭 팝업 / 「고객정보」 = 조회 전용
  const [editQuote, setEditQuote] = useState<ApiQuote | null>(null)
  const [viewQuote, setViewQuote] = useState<ApiQuote | null>(null)

  function load() {
    setLoading(true); setErr('')
    Promise.all([fetchQuotes({}), fetchOrders({})])
      .then(([q, o]) => { setQuotes(q); setOrders(o) })
      .catch(e => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  // order_id 빠른 조회용 (quote_id → order)
  const orderByQuote = new Map(orders.map(o => [o.quote_id, o]))

  if (loading) return <div style={lv.empty}>로딩 중…</div>
  if (err)     return <div style={{ ...lv.empty, color: 'var(--warn)' }}>{err}</div>

  return (
    <>
    
    
    {contractQuote && (
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
      >
        <div style={{ width: 'min(460px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>계약 · 전자서명{contractQuote.customerName ? ` — ${contractQuote.customerName}` : ''}</span>
            {/* 팝업 안에서 서명을 요청하면 목록의 상태·발송현황이 달라진다 — 닫을 때 다시 읽는다 */}
            <button style={{ border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 13 }} onClick={() => { setContractQuote(null); load() }}>✕</button>
          </div>
          <ContractPanel quoteId={contractQuote.id} customerName={contractQuote.customerName} />
        </div>
      </div>
    )}
    {emailQuote && (
      <EmailSendModal
        quoteId={emailQuote.id}
        customerName={emailQuote.customerName}
        onClose={() => setEmailQuote(null)}
      />
    )}
    {editQuote && (
      <QuoteEditModal
        quote={editQuote}
        onClose={() => setEditQuote(null)}
        onSaved={load}
      />
    )}
    {viewQuote && (
      <CustomerViewModal quote={viewQuote} onClose={() => setViewQuote(null)} />
    )}
    {confirmQuoteModal && (
      <ConfirmQuoteModal
        quoteId={confirmQuoteModal.id}
        customerName={confirmQuoteModal.customerName}
        status={confirmQuoteModal.status}
        initialInputs={confirmQuoteModal.inputs}
        onClose={() => setConfirmQuoteModal(null)}
        onDone={load}
      />
    )}
    <div style={lv.root}>
      <div style={lv.section}>
        <div style={lv.sectionTitle}>내 견적 ({quotes.length})</div>
        {quotes.length === 0 ? (
          <div style={lv.empty}>저장된 견적이 없습니다.</div>
        ) : (
          <div style={lv.tableWrap}>
            <table style={lv.table}>
              <thead>
                <tr>
                  <th style={lv.th}>#</th>
                  <th style={lv.th}>고객</th>
                  <th style={lv.th}>실구매가</th>
                  <th style={lv.th}>상태</th>
                  <th style={lv.th}>전자서명</th>
                  <th style={lv.th}>주문 현황</th>
                  <th style={lv.th}>특장사</th>
                  <th style={lv.th}>날짜</th>
                  <th style={lv.th}></th>
                </tr>
              </thead>
              <tbody>
                {quotes.map(q => {
                  const order = orderByQuote.get(q.id)
                  return (
                    <tr key={q.id}>
                      <td style={lv.td}>{q.quote_no ?? `#${q.id}`}</td>
                      <td style={lv.td}>{q.customer?.name ?? '—'}</td>
                      <td style={{ ...lv.td, fontVariantNumeric: 'tabular-nums', textAlign: 'right' as const }}>{fmtPrice(q.final_price)}</td>
                      <td style={lv.td}>
                        <Tooltip text={quoteStatusTip(q.status)} placement="below">
                          <span style={q.status === 'draft' ? lv.badgeDraft : (q.status === 'confirmed' || q.status === 'assigned' || q.status === 'ordered') ? lv.badgeActive : lv.badgeMuted}>
                            {QUOTE_STATUS_KO[q.status] ?? q.status}
                          </span>
                        </Tooltip>
                      </td>
                      <td style={lv.td}><ContractBadge c={q.contract} /></td>
                      <td style={lv.td}>
                        {order
                          ? <span style={ORDER_STATUS_BADGE}>{order.status}</span>
                          : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>
                        }
                      </td>
                      <td style={{ ...lv.td, color: 'var(--muted)', fontSize: 12 }}>{q.order?.maker_org?.name ?? '—'}</td>
                      <td style={{ ...lv.td, color: 'var(--muted)', fontSize: 12 }}>{fmtDate(q.created_at)}</td>
                      <td style={lv.td}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                          {/* 「수정」 하나로 옵션·고객정보·할부를 전부 고친다(팝업 안에서 탭으로 나뉜다) */}
                          <button
                            style={q.docs_frozen_at ? { ...lv.pdfBtn, opacity: 0.45 } : lv.pdfBtn}
                            title={q.docs_frozen_at
                              ? `전자서명 발송으로 서류가 고정되었습니다 — 이력만 볼 수 있습니다 (${fmtDate(q.docs_frozen_at)})`
                              : '옵션 · 고객정보 · 할부 수정 및 수정 이력'}
                            onClick={() => setEditQuote(q)}
                          >수정</button>
                          {/* 「고객정보」는 조회 전용 — 고치는 곳은 「수정」 한 군데로 모았다 */}
                          <button
                            style={lv.pdfBtn}
                            title="고객·계약 정보 조회 (수정 불가)"
                            onClick={() => setViewQuote(q)}
                          >고객정보</button>
                          <button
                            style={q.status === 'draft' ? lv.confirmBtn : lv.pdfBtn}
                            title={q.status === 'draft' ? '선수금·할부·면세 등 입력 후 견적서 생성' : '견적서 열람·다운로드'}
                            onClick={() => q.status === 'draft'
                              ? setConfirmQuoteModal({ id: q.id, customerName: q.customer?.name ?? undefined, status: q.status, inputs: q.inputs ?? undefined, customer: q.customer ?? undefined })
                              : openPdf(`/api/v1/quotes/${q.id}/pdf`)}
                          >{q.status === 'draft' ? '견적 생성' : '견적서'}</button>
                          {/* 계약서 = 견적서와 같은 입력(팝업)으로 함께 만들어진다. 생성 전엔 같은 팝업으로 유도 */}
                          <button
                            style={q.status === 'draft' ? { ...lv.pdfBtn, opacity: 0.45 } : lv.pdfBtn}
                            title={q.status === 'draft' ? '견적서 생성 시 계약서도 함께 만들어집니다' : '특장 매매계약서 열람·다운로드'}
                            onClick={() => q.status === 'draft'
                              ? setConfirmQuoteModal({ id: q.id, customerName: q.customer?.name ?? undefined, status: q.status, inputs: q.inputs ?? undefined, customer: q.customer ?? undefined })
                              : openPdf(`/api/v1/quotes/${q.id}/contract-pdf`)}
                          >계약서</button>
                          {/* 발송 채널 둘의 성격이 다르다 — 참고용 전달 vs 법적 서명 요청. 이름으로 구분되게 둔다 */}
                          <button
                            style={lv.pdfBtn}
                            title="참고용 — 견적서·계약서 PDF 를 고객 메일로 전달합니다 (서명 요청 아님)"
                            onClick={() => setEmailQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                          >메일 전달</button>
                          <button
                            style={q.status === 'draft' ? { ...lv.sendBtn, opacity: 0.4, cursor: 'not-allowed' } : lv.sendBtn}
                            disabled={q.status === 'draft'}
                            title={q.status === 'draft' ? '견적서 생성 후 서명을 요청할 수 있습니다' : '고객에게 전자서명을 요청합니다 — 진행상태가 기록됩니다'}
                            onClick={() => setContractQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                          >서명 요청</button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
    </>
  )
}

// ── SalesPage ───────────────────────────────────────────────────────────────
export function SalesPage() {
  const { session } = useAuth()
  const canConvert = usePermission('quote.create')
  const [salesTab, setSalesTab] = useState<'config' | 'list'>('config')

  const [bundle, setBundle] = useState<ApiPricingBundle | null>(null)
  const [bundleLoading, setBundleLoading] = useState(true)
  const [selections, setSelections] = useState<Record<string, string>>({})

  /**
   * 보조금 산정 입력 — **화면 금액을 즉시 바꾸는 값**이라 저장 모달이 아니라
   * 가격바 「보조금」 팝업에서 그 자리에서 고친다. 진입 시 팝업으로 막지 않는다.
   */
  const [subsidyInputs, setSubsidyInputs] = useState<SubsidyInputs>(DEFAULT_SUBSIDY_INPUTS)
  /** 지역 목록(161개) — 보조금 팝업·저장 모달이 함께 쓴다. */
  const [regions, setRegions] = useState<string[]>([])
  /** 저장 단계에서 받은 고객·계약 정보(저장 후 다시 열 때 유지) */
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [showSaveModal, setShowSaveModal] = useState(false)
  /** 지방보조금은 지역을 골라야 계산된다 — 그 전까지 보조금 금액을 흐리게 보여준다. */
  // 법인은 지방보조금이 없어 지역을 묻지 않는다 — 지역 없이도 국고보조금은 계산된다
  const subsidyReady = subsidyInputs.business_type === 'corporate' || !!subsidyInputs.region_code

  const [subsidyLocal, setSubsidyLocal] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState<{ quote_id: number; pricing: PricingOk } | null>(null)
  const [saveError, setSaveError] = useState('')

  // 메모/안내문 + 재량할인(0원 처리 특장옵션 그룹)
  const [memo, setMemo] = useState('')
  const [promotionZeroed, setPromotionZeroed] = useState<Set<string>>(new Set())
  const [localSubsidyOff, setLocalSubsidyOff] = useState(false)  // 지방보조금 소진 시 견적별 미적용
  const togglePromotion = (group: string) => setPromotionZeroed(prev => {
    const next = new Set(prev)
    next.has(group) ? next.delete(group) : next.add(group)
    return next
  })



  // 번들 1회 로드
  useEffect(() => {
    if (!session) return
    setBundleLoading(true)
    fetchPricingBundle('PV5_OPENBED')
      .then(data => {
        setBundle(data)
        const defaults: Record<string, string> = {}
        for (const g of data.groups) {
          if (g.values.length === 0) continue
          // 토글형 옵션(온도기록계·스포일러·격벽·도어추가)은 기본 '없음'
          defaults[g.code] = offValueCode(g) ?? g.values[0]!.code
        }
        // 트림 기본값 = 플러스 (있으면)
        if (data.groups.some(g => g.code === 'TRIM' && g.values.some(v => v.code === 'TRIM_PLUS'))) {
          defaults['TRIM'] = 'TRIM_PLUS'
        }
        setSelections(sanitizeSelections(defaults, data))
      })
      .catch(e => console.error('pricing-bundle 로드 실패', e))
      .finally(() => setBundleLoading(false))
  }, [session])

  useEffect(() => {
    fetchRegions().then(setRegions).catch(() => setRegions([]))
  }, [])

  // 지역 변경 시 지방보조금 fetch
  useEffect(() => {
    if (!subsidyInputs.region_code) {
      setSubsidyLocal(0)
      return
    }
    fetchLocalSubsidy(subsidyInputs.region_code, new Date().getFullYear())
      .then(setSubsidyLocal)
      .catch(() => setSubsidyLocal(0))
  }, [subsidyInputs.region_code])

  // option_rule 기준 비활성 그룹 코드
  const disabledGroupCodes = useMemo<Set<string>>(
    () => (bundle ? computeDisabledGroups(selections, bundle) : new Set<string>()),
    [bundle, selections],
  )

  // option_rule(effect=hide) 기준 숨김 그룹/값 + 옵션별 증감액
  const { hiddenGroupCodes, hiddenValueCodes } = useMemo(() => {
    if (!bundle) return { hiddenGroupCodes: new Set<string>(), hiddenValueCodes: new Set<string>() }
    const { groups, values } = computeHidden(selections, bundle)
    return { hiddenGroupCodes: groups, hiddenValueCodes: values }
  }, [bundle, selections])


  // 실시간 계산 (조립 로직은 백엔드 라우트와 shared 공용)
  const liveCalc = useMemo<PricingResult | null>(() => {
    if (!bundle || Object.keys(selections).length === 0) return null

    const price = (code: string) => bundle.option_prices[code] ?? 0
    // 재량할인(프로모션) 0원 처리를 조립 단계에 반영 → 화면 가격이 실제 견적과 일치
    const { trim_price, option_sum } = assembleOptionSum(selections, price, [...promotionZeroed])
    return calcPrice({
      trim_price,
      option_sum,
      subsidy: {
        national:          bundle.subsidy_national?.amount ?? 0,
        local:             subsidyReady && !localSubsidyOff ? subsidyLocal : 0,
        sosang_rate:       bundle.subsidy_national?.sosang_rate ?? 0.3,
        takbae_rate:       TAKBAE_RATE,
        diesel_conversion: DIESEL_CONVERSION_SUBSIDY,
      },
      tax: bundle.tax,
      customer: {
        biz_type:  mapBizType(subsidyInputs.business_type),
        is_sosang: subsidyInputs.is_small_business ?? false,
        has_transport_license: subsidyInputs.has_transport_license ?? false,
        // Ver1.21 엔진은 '유지'만 감액 대상으로 본다(총견적서와 동일 기준)
        diesel_conversion:     subsidyInputs.diesel_status === 'keep',
      },
    })
  }, [bundle, selections, subsidyLocal, subsidyInputs, subsidyReady, customer, promotionZeroed, localSubsidyOff])

  /**
   * 화면 표시 금액의 단일 소스 — **총견적서 기준**(견적서 PDF 와 동일 규칙).
   * 취득세 base·특장취득세 기준액·공채할인·의무보험이 Ver1.21(calcPrice)과 달라
   * 화면과 견적서가 어긋나던 문제를 이걸로 통일한다.
   */
  const liveTotal = useMemo<QuoteResult | null>(() => {
    if (!bundle || Object.keys(selections).length === 0) return null
    const price = (code: string) => bundle.option_prices[code] ?? 0
    const { trim_price, option_sum } = assembleOptionSum(selections, price, [...promotionZeroed])
    const t = bundle.tax_all ?? {}
    const biz = mapBizType(subsidyInputs.business_type)
    return calcQuote({
      car_price: Math.round(trim_price * 1.1),
      delivery_fee: t['delivery_fee'] ?? bundle.tax.delivery_fee,
      commercial_discount: t['commercial_discount'] ?? 0,
      partnership_rate: t['partnership_rate'] ?? 0.01,
      subsidy_national: bundle.subsidy_national?.amount ?? 0,
      diesel_conversion: subsidyInputs.diesel_status === 'keep',   // 엑셀 D15 — 「유지」만 −50만
      diesel_deduction: t['diesel_deduction'] ?? 500_000,
      subsidy_local: subsidyReady ? subsidyLocal : 0,
      is_corporation: biz === 'corporation',
      local_subsidy_off: localSubsidyOff,
      no_vat_refund: biz === 'consumer',
      is_sosang: subsidyInputs.is_small_business ?? false,
      sosang_rate: bundle.subsidy_national?.sosang_rate ?? 0.3,
      is_individual: biz === 'individual',
      has_transport_license: subsidyInputs.has_transport_license ?? false,
      takbae_rate: TAKBAE_RATE,
      body_price: Math.round(option_sum * 1.1),
      promotion: 0,
      car_deposit: t['car_deposit'] ?? 100_000,
      body_deposit: t['body_deposit'] ?? 400_000,
      down_payment_rate: 0,     // 선수금·할부는 견적서 생성 단계 입력
      installment_months: 0,
      installment_rate: 0,
      has_biz_plate: !!customer?.has_biz_plate,
      acq_tax_rate_biz: t['acq_tax_rate_biz'] ?? 0.04,
      acq_tax_rate_normal: t['acq_tax_rate'] ?? bundle.tax.acq_tax_rate,
      acq_tax_relief: t['acq_tax_relief_cap'] ?? bundle.tax.acq_tax_relief_cap,
      special_acq_tax_rate: t['special_acq_tax_rate'] ?? bundle.tax.special_acq_tax_rate,
      is_seoul_normal: (customer?.tax_exempt_type ?? DEFAULT_TAX_EXEMPT_TYPE) === '일반인' && subsidyInputs.region_code === '서울특별시',
      bond_discount: t['bond_discount'] ?? 0,
      plate: t['plate'] ?? bundle.tax.plate,
      stamp: t['stamp'] ?? bundle.tax.stamp,
      insurance: t['insurance'] ?? 2_800,
      reg_agency: t['reg_agency'] ?? bundle.tax.reg_agency,
      etc_fee: t['etc_fee'] ?? bundle.tax.etc_fee,
      // 구조변경 비용 — tax_config 값. 백엔드(buildQuoteParams)와 같은 기본값을 써야
      // 화면 가격과 견적서 PDF 가 어긋나지 않는다.
      structure_change_fee: t['structure_change_fee'] ?? 400_000,
    })
  }, [bundle, selections, subsidyLocal, subsidyInputs, subsidyReady, customer, promotionZeroed, localSubsidyOff])

  function handleSelect(groupCode: string, valueCode: string) {
    setSelections(prev => {
      const next = { ...prev, [groupCode]: valueCode }
      if (!bundle) return next
      // 규칙 적용: 비활성화된 그룹의 기존 선택 해제
      for (const rule of bundle.rules) {
        if (rule.effect === 'disable' && rule.target_type === 'group') {
          if (Object.values(next).includes(rule.when_value)) {
            delete next[rule.target_code]
          }
        }
      }
      // 숨김 규칙: 숨겨진 그룹/값 선택 정리 (예: 냉동↔내장 전환 시 도어·온도·격벽)
      return sanitizeSelections(next, bundle)
    })
    setSavedQuote(null)
    setSaveError('')
  }

  /** 「견적 저장」 → 고객·계약 정보를 받는 모달을 먼저 연다(진입 시 팝업은 없앴다). */
  /**
   * 저장 완료 후 새 견적 시작 — **화면을 새로고침한다.**
   *
   * 상태를 하나씩 되돌리는 방식은 빠뜨리기 쉽다(실제로 탭 방문기록 `visited` 가 남아
   * '특장·옵션 확인' 강제가 풀린 채로 저장할 수 있었다). 옵션 선택·고객 입력·보조금 조건·
   * 메모·프로모션·탭 방문기록이 여러 컴포넌트에 흩어져 있어, 새 견적은 처음 상태에서
   * 시작하는 게 안전하다.
   */
  function handleStartNew() {
    window.location.reload()
  }

  function handleOpenSave() {
    if (!bundle || liveCalc?.status === 'unsupported') return
    setSaveError('')
    setShowSaveModal(true)
  }

  async function handleSave(v: QuoteSaveValues) {
    if (!bundle) return
    if (liveCalc?.status === 'unsupported') return

    setIsSaving(true)
    setSaveError('')
    try {
      const req: SaveQuoteRequest = {
        model_code: 'PV5_OPENBED',
        year: new Date().getFullYear(),
        selections,
        memo: memo || undefined,
        promotion_zeroed: promotionZeroed.size ? [...promotionZeroed] : undefined,
        local_subsidy_off: localSubsidyOff || undefined,
        customer: {
          name: v.name.trim(),
          // 법인만 값이 있다 → 계약서 {{ceo_name}}. 개인이면 보내지 않는다.
          ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : undefined,
          email: v.email.trim() || undefined,
          phone: v.phone || undefined,
          biz_type: mapBizType(v.subsidy.business_type),
          is_sosang: v.subsidy.is_small_business ?? false,
          region: v.subsidy.region_code,
          address: v.address.trim() || undefined,
          address_detail: v.address_detail.trim() || undefined,
          has_transport_license: v.subsidy.has_transport_license ?? false,
          diesel_status: v.subsidy.diesel_status || 'none',
          // 계약서 전용 입력 — 비우면 계약서에 공란으로 나간다
          contract_party: v.contract_party.trim() || undefined,
          buyer_agent: v.buyer_agent.trim() || undefined,
          buyer_relation: v.buyer_relation.trim() || undefined,
          buyer_regno: v.buyer_regno.trim() || undefined,
          buyer_tel: v.buyer_tel || undefined,
        },
      }
      const result = await saveQuote(req)
      setSavedQuote(result)
      // 저장에 쓴 값을 화면 상태로 되돌려 둔다(헤더 표시·다시 열기).
      setSubsidyInputs(v.subsidy)
      setCustomer({
        name: v.name.trim(), ceo_name: v.ceo_name.trim() || undefined,
        email: v.email.trim() || undefined, phone: v.phone || undefined,
        business_type: v.subsidy.business_type,
        region_code: v.subsidy.region_code, address: v.address.trim() || undefined,
        address_detail: v.address_detail.trim() || undefined,
        is_small_business: v.subsidy.is_small_business ?? false,
        has_transport_license: v.subsidy.has_transport_license ?? false,
        diesel_status: v.subsidy.diesel_status || 'none',
        is_diesel_conversion: v.subsidy.diesel_status === 'keep',
        contract_party: v.contract_party.trim() || undefined,
        buyer_agent: v.buyer_agent.trim() || undefined,
        buyer_relation: v.buyer_relation.trim() || undefined,
        buyer_regno: v.buyer_regno.trim() || undefined,
        buyer_tel: v.buyer_tel || undefined,
      })
      setShowSaveModal(false)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setIsSaving(false)
    }
  }

  const isUnsupported = liveCalc?.status === 'unsupported'
  const displayCalc = savedQuote ? { ...savedQuote.pricing, status: 'ok' as const } : liveCalc

  if (bundleLoading) return <div style={styles.loading}>로딩 중…</div>
  if (!bundle) return <div style={styles.loading}>옵션 데이터 로드 실패</div>

  return (
    <div style={styles.root}>
      {/* 견적 저장 단계에서만 고객·계약 정보를 받는다 — 진입 시 팝업은 없앴다 */}
      {showSaveModal && (
        <QuoteSaveModal
          initial={valuesFromCustomer(customer, subsidyInputs)}
          regions={regions}
          saving={isSaving}
          error={saveError}
          onSave={handleSave}
          onClose={() => setShowSaveModal(false)}
        />
      )}

      <Header customer={customer} />

      <div style={styles.tabBar}>
        <button style={salesTab === 'config' ? styles.tabOn : styles.tab} onClick={() => setSalesTab('config')}>컨피규레이터</button>
        <button style={salesTab === 'list'   ? styles.tabOn : styles.tab} onClick={() => setSalesTab('list')}>내 견적·주문</button>
      </div>

      {salesTab === 'list' && <MyListView />}

      <div style={{ ...styles.body, display: salesTab === 'list' ? 'none' : 'flex' }}>
        <section style={styles.viewer}>
          <div style={styles.vtabs}>
            {['FREE', 'TOP', 'SIDE', 'REAR', 'FRONT'].map(v => (
              <span key={v} style={v === 'FREE' ? styles.vtabOn : styles.vtab}>{v}</span>
            ))}
          </div>

          <div style={styles.stage}>
           {/*
             지금은 VIVAR 3D 대신 정지 이미지를 띄운다(임시). 이미지 자체가 16:9(1672x941)라
             프레임에 딱 맞는다. 3D 연동이 붙으면 이 자리에 iframe 이 들어간다.
           */}
           <div style={styles.frame}>
             <img src={stegoSide} alt="STEGO-K 측면" style={styles.stageImg} />
           </div>
           <div style={styles.stageNote}>3D 미리보기 연동 예정</div>
          </div>

          <PriceBar
            calc={displayCalc}
            total={liveTotal}
            hasCustomer={subsidyReady}
            breakdown={bundle ? assembleOptionSum(selections, c => bundle.option_prices[c] ?? 0, [...promotionZeroed]) : null}
            subsidy={subsidyInputs}
            onSubsidyChange={setSubsidyInputs}
            regions={regions}
          />
        </section>

        <OptionPanel
          bundle={bundle}
          selections={selections}
          disabledGroupCodes={disabledGroupCodes}
          hiddenGroupCodes={hiddenGroupCodes}
          hiddenValueCodes={hiddenValueCodes}
          optionPrices={bundle.option_prices}
          onSelect={handleSelect}
          onSave={handleOpenSave}
          onStartNew={handleStartNew}
          isSaving={isSaving}
          savedQuote={savedQuote}
          saveError={saveError}
          isUnsupported={isUnsupported}
          canConvert={canConvert}
          memo={memo}
          onMemoChange={setMemo}
          promotionZeroed={promotionZeroed}
          onTogglePromotion={togglePromotion}
          localSubsidyOff={localSubsidyOff}
          onToggleLocalSubsidy={setLocalSubsidyOff}
        />
      </div>
    </div>
  )
}

const styles = {
  loading: { padding: 24, color: 'var(--muted)' },
  root: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  tabBar: {
    flexShrink: 0,
    display: 'flex',
    gap: 4,
    padding: '8px 16px',
    borderBottom: '1px solid var(--line)',
    background: '#fff',
  },
  tab: {
    padding: '6px 14px', border: '1px solid var(--line)', borderRadius: 8,
    background: '#fff', cursor: 'pointer', fontSize: 13, color: 'var(--muted)',
  },
  tabOn: {
    padding: '6px 14px', border: '1px solid var(--dark)', borderRadius: 8,
    background: 'var(--dark)', cursor: 'pointer', fontSize: 13, color: '#fff', fontWeight: 600,
  },
  body: {
    flex: 1,
    minHeight: 0,
    display: 'flex',
    overflow: 'hidden',
  },
  viewer: {
    // 폭은 옵션 패널과 2:1 로 나눈다. 3D 는 이 폭 안에서 16:9 로 맞춰지고(styles.frame),
    // 남는 자리는 위아래 여백이 된다 — 패널은 고정폭이 아니라 남은 폭을 전부 채운다.
    flex: 2,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    borderRight: '1px solid var(--line)',
    background: '#fafbfb',
    overflow: 'hidden',
  },
  vtabs: {
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '11px 16px',
    borderBottom: '1px solid var(--line)',
  },
  vtab: { fontSize: 12, color: 'var(--muted)', padding: '5px 10px', borderRadius: 6, cursor: 'pointer' },
  vtabOn: {
    fontSize: 12, padding: '5px 10px', borderRadius: 6, cursor: 'pointer',
    background: 'var(--dark)', color: '#fff', fontWeight: 600,
  },
  vtabR: {
    marginLeft: 'auto',
    fontSize: 12,
    border: '1px solid var(--line)',
    padding: '5px 11px',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#fff',
  },
  stage: {
    flex: 1,
    minHeight: 260,
    display: 'flex',
    flexDirection: 'column' as const,   // 3D 칸 아래에 안내 문구가 온다
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    boxSizing: 'border-box' as const,
    overflow: 'hidden' as const,
    // 안쪽 16:9 박스가 이 영역을 기준으로 크기를 잡는다(아래 frame 의 cqw/cqh)
    containerType: 'size' as const,
  },
  /**
   * 3D 가 실제로 그려지는 곳 — **항상 정확히 16:9**.
   *
   * `aspect-ratio` 만 쓰면 가로가 좁아질 때 브라우저가 비율을 깨뜨린다(실측 확인).
   * 그래서 남는 가로·세로 중 작은 쪽에 맞춰 폭을 직접 계산한다:
   *   폭 = min(가용 가로, 가용 세로 × 16/9)
   * 화면이 어떤 크기든 3D 는 16:9 를 유지하고, 남는 자리는 위아래(또는 좌우) 여백이 된다.
   */
  frame: {
    position: 'relative' as const,
    // 26px = 아래 안내 문구가 차지하는 높이(글자 15 + 여백 8 + 여유). 이만큼 빼야
    // 문구까지 넣고도 16:9 가 정확히 유지된다.
    width: 'min(100cqw, (100cqh - 26px) * 16 / 9)',
    aspectRatio: '16 / 9',
    overflow: 'hidden' as const,
    borderRadius: 10,
    border: '1px solid var(--line)',
    background: '#fff',
  },
  embedTag: {
    position: 'absolute' as const,
    top: 14,
    left: 16,
    fontSize: 11,
    color: '#9aa0a8',
    background: '#fff',
    border: '1px solid var(--line)',
    padding: '4px 8px',
    borderRadius: 6,
  },
  // 이미지가 프레임과 같은 16:9 라 그대로 채운다
  stageImg: { position: 'absolute' as const, inset: 0, width: '100%', height: '100%', objectFit: 'cover' as const, display: 'block' },
  stageNote: { marginTop: 8, fontSize: 12, color: 'var(--muted)', textAlign: 'center' as const },
}

const lv: Record<string, React.CSSProperties> = {
  root: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--dark)', marginBottom: 12 },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  tableWrap: { overflowX: 'auto' },
  // 폭이 모자라면 칸을 **줄여서 글자를 접지 말고** 가로로 넘겨 스크롤한다.
  // (예전엔 고객명이 한 글자씩 세로로 접히고 배지·버튼이 눌려 찌그러졌다)
  table: { width: '100%', minWidth: 'max-content', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px',
    borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle', whiteSpace: 'nowrap' },
  badgeDraft:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#f0f2f4', color: 'var(--muted)', display: 'inline-block', whiteSpace: 'nowrap' },
  badgeActive: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'var(--lime)', color: 'var(--dark)', display: 'inline-block', whiteSpace: 'nowrap' },
  badgeMuted:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#e3f2fd', color: '#1565c0', display: 'inline-block', whiteSpace: 'nowrap' },
  // 버튼 크기·모양은 styles/buttons.ts 한 곳에서 관리한다(영업·관리자 동일)
  pdfBtn: BTN.row,
  sendBtn: BTN.rowSend,
  confirmBtn: BTN.rowPrimary,
}
