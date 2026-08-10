import { useEffect, useMemo, useRef, useState } from 'react'
import { openPdf } from '../lib/openPdf'
import type { CustomerInfo, ApiPricingBundle, ApiQuote, ApiOrder } from '@shared/types/index'
import type { PricingResult, PricingOk } from '@shared/pricing/core'
import { calcPrice, calcQuote, assembleOptionSum, TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY, DEFAULT_TAX_EXEMPT_TYPE, toDieselStatus } from '@shared/pricing/core'
import type { QuoteResult } from '@shared/pricing/core'
import { fetchPricingBundle } from '../api/models'
import { saveQuote, fetchLocalSubsidy, fetchQuotes, fetchRegions, saveQuoteCustomer, saveQuoteInputs } from '../api/quotes'
import type { SaveQuoteRequest } from '../api/quotes'
import { fetchOrders } from '../api/orders'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { offValueCode } from '../components/OptionToggle'
import { QuoteSaveModal, valuesFromCustomer, type QuoteSaveValues } from '../components/QuoteSaveModal'
import { DEFAULT_SUBSIDY_INPUTS, type SubsidyInputs } from '../components/SubsidyInputs'
import { ContractPanel } from '../components/ContractPanel'
import { EmailSendModal } from '../components/EmailSendModal'
import { ConfirmQuoteModal } from '../components/ConfirmQuoteModal'
import { Tooltip } from '../components/Tooltip'
import { usePermission } from '../components/PermGate'
import { useAuth } from '../contexts/AuthContext'

function mapBizType(bt: CustomerInfo['business_type'] | undefined): 'individual' | 'corporation' | 'simplified' | 'consumer' {
  if (bt === 'corporate') return 'corporation'
  if (bt === 'simplified') return 'simplified'
  if (bt === 'consumer') return 'consumer'   // 일반구매자(비사업자) — 부가세 환급 불가
  return 'individual'
}

/** option_rule(effect=hide) → 현재 선택 기준 숨길 그룹/값 코드 */
function computeHidden(sel: Record<string, string>, bundle: ApiPricingBundle) {
  const groups = new Set<string>()
  const values = new Set<string>()
  const selected = new Set(Object.values(sel))
  for (const rule of bundle.rules) {
    if (rule.effect !== 'hide' || !selected.has(rule.when_value)) continue
    if (rule.target_type === 'group') groups.add(rule.target_code)
    else if (rule.target_type === 'value') values.add(rule.target_code)
  }
  return { groups, values }
}

/** 숨겨진 그룹 선택 제거 + 숨겨진 값 선택 시 첫 노출값으로 대체 */
function sanitizeSelections(sel: Record<string, string>, bundle: ApiPricingBundle): Record<string, string> {
  const { groups, values } = computeHidden(sel, bundle)
  const out = { ...sel }
  for (const g of bundle.groups) {
    if (groups.has(g.code)) { delete out[g.code]; continue }
    if (out[g.code] && values.has(out[g.code])) {
      const firstVisible = g.values.find(v => !values.has(v.code))
      if (firstVisible) out[g.code] = firstVisible.code
      else delete out[g.code]
    }
  }
  return out
}

// ── 내 견적·주문 뷰 ────────────────────────────────────────────────────────
const QUOTE_STATUS_KO: Record<string, string> = {
  draft: '임시저장', confirmed: '확정', assigned: '배정', ordered: '주문', expired: '만료',
}

const QUOTE_STATUS_FLOW = [
  { key: 'draft',     label: '임시저장', desc: '작성 중인 견적' },
  { key: 'confirmed', label: '확정',     desc: '계약·전자서명 완료' },
  { key: 'assigned',  label: '배정',     desc: '특장사 배정 · 주문 생성' },
  { key: 'ordered',   label: '주문',     desc: '특장사 수락 · 제작 진행' },
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
        display: 'inline-block', padding: '2px 8px', borderRadius: 6, fontSize: 11.5, fontWeight: 700,
        border: '1px solid var(--line)', background: '#f6f7f8', color: '#6b7280',
        ...(CONTRACT_TONE[c.status] ?? {}),
      }}>{CONTRACT_LABEL[c.status] ?? c.status}</span>
    </Tooltip>
  )
}

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string)  { return s ? s.slice(0, 10) : '—' }

/** 프론트 표기('corporate') ← 저장값('corporation') 역매핑. mapBizType 의 반대. */
function unmapBizType(v: unknown): CustomerInfo['business_type'] {
  if (v === 'corporation') return 'corporate'
  if (v === 'simplified') return 'simplified'
  if (v === 'consumer') return 'consumer'
  return 'individual'
}

/**
 * 저장된 견적 → 고객정보 수정 폼 초기값.
 * 고객 행(customer)과 견적 입력 스냅샷(inputs) 두 곳에 나뉘어 있어 여기서 합친다.
 */
function customerEditValues(q: ApiQuote): QuoteSaveValues {
  const inp = (q.inputs ?? {}) as Record<string, unknown>
  const str = (k: string) => String(inp[k] ?? '')
  return {
    subsidy: {
      business_type: unmapBizType(inp['biz_type']),
      region_code: str('region'),
      is_small_business: inp['is_sosang'] === true,
      has_transport_license: inp['has_transport_license'] === true,
      // 옛 견적은 diesel_status 가 없고 boolean 만 있다 — '유지' 여부로 복원한다.
      diesel_status: toDieselStatus(inp['diesel_status'], inp['diesel_conversion']),
    },
    name: q.customer?.name ?? '',
    ceo_name: str('ceo_name'),
    email: q.customer?.email ?? '',
    phone: q.customer?.phone ?? '',
    address: q.customer?.address ?? '',
    contract_party: str('contract_party'),
    buyer_agent: str('buyer_agent'),
    buyer_relation: str('buyer_relation'),
    buyer_regno: str('buyer_regno'),
    buyer_tel: str('buyer_tel'),
  }
}

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
  const [customerEdit, setCustomerEdit] = useState<ApiQuote | null>(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editErr, setEditErr] = useState('')
  const [regions, setRegions] = useState<string[]>([])

  useEffect(() => { fetchRegions().then(setRegions).catch(() => setRegions([])) }, [])

  /** 수정 저장 — 고객 행(PATCH /customer)과 견적 입력(PATCH /inputs)을 함께 갱신한다. */
  async function handleCustomerEditSave(v: QuoteSaveValues) {
    if (!customerEdit) return
    setEditSaving(true); setEditErr('')
    try {
      // 고객 마스터도 함께 갱신한다 — 다음 견적에서 이 값들이 자동 기입된다.
      await saveQuoteCustomer(customerEdit.id, {
        name: v.name.trim(),
        phone: v.phone,
        email: v.email.trim(),
        address: v.address.trim(),
        reg_no: v.buyer_regno.trim(),
        ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : '',
        tel: v.buyer_tel,
      })
      await saveQuoteInputs(customerEdit.id, {
        biz_type: mapBizType(v.subsidy.business_type),
        is_sosang: v.subsidy.is_small_business,
        region: v.subsidy.region_code,
        has_transport_license: v.subsidy.has_transport_license,
        diesel_status: v.subsidy.diesel_status,
        // 개인으로 되돌리면 대표이사를 비운다 — 계약서 법인 줄이 남아 있으면 안 된다.
        ceo_name: v.subsidy.business_type === 'corporate' ? v.ceo_name.trim() : '',
        contract_party: v.contract_party.trim(),
        buyer_agent: v.buyer_agent.trim(),
        buyer_relation: v.buyer_relation.trim(),
        buyer_regno: v.buyer_regno.trim(),
        buyer_tel: v.buyer_tel,
      })
      setCustomerEdit(null)
      load()
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : '고객정보 저장 실패')
    } finally { setEditSaving(false) }
  }

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
        onClick={(e) => { if (e.target === e.currentTarget) setContractQuote(null) }}
      >
        <div style={{ width: 'min(460px, 94vw)', background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>계약 · 전자서명{contractQuote.customerName ? ` — ${contractQuote.customerName}` : ''}</span>
            <button style={{ border: '1px solid #ddd', borderRadius: 7, background: '#fff', cursor: 'pointer', padding: '4px 10px', fontSize: 13 }} onClick={() => setContractQuote(null)}>✕</button>
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
    {customerEdit && (
      <QuoteSaveModal
        mode="edit"
        initial={customerEditValues(customerEdit)}
        regions={regions}
        saving={editSaving}
        error={editErr}
        onSave={handleCustomerEditSave}
        onClose={() => setCustomerEdit(null)}
      />
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
                        <div style={{ display: 'flex', gap: 6 }}>
                          {/* 견적서 생성 전(draft) = 견적서 버튼 → 입력 팝업 / 생성 후 = PDF 열람 + 수정 버튼 */}
                          {q.status !== 'draft' && (
                            <button
                              style={lv.pdfBtn}
                              title="견적서 입력값(선수금·할부·면세 등) 수정"
                              onClick={() => setConfirmQuoteModal({ id: q.id, customerName: q.customer?.name ?? undefined, status: q.status, inputs: q.inputs ?? undefined, customer: q.customer ?? undefined })}
                            >수정</button>
                          )}
                          {/*
                            고객정보 수정 — 캐피탈 입력(«수정»)과 성격이 달라 버튼을 나눴다.
                            서류가 고정된 뒤엔 백엔드가 409 로 막으므로, 누르기 전에 비활성으로 알린다.
                          */}
                          <button
                            style={q.docs_frozen_at ? { ...lv.pdfBtn, opacity: 0.45, cursor: 'not-allowed' } : lv.pdfBtn}
                            disabled={!!q.docs_frozen_at}
                            title={q.docs_frozen_at
                              ? `전자서명 발송으로 서류가 고정되어 수정할 수 없습니다 (${fmtDate(q.docs_frozen_at)})`
                              : '성명·상호·대표이사·연락처·주소·사업자구분·계약서 정보 수정'}
                            onClick={() => { setEditErr(''); setCustomerEdit(q) }}
                          >고객정보</button>
                          <button
                            style={q.status === 'draft' ? lv.confirmBtn : lv.pdfBtn}
                            title={q.status === 'draft' ? '선수금·할부·면세 등 입력 후 견적서 생성' : '견적서 열람·다운로드'}
                            onClick={() => q.status === 'draft'
                              ? setConfirmQuoteModal({ id: q.id, customerName: q.customer?.name ?? undefined, status: q.status, inputs: q.inputs ?? undefined, customer: q.customer ?? undefined })
                              : openPdf(`/api/v1/quotes/${q.id}/pdf`)}
                          >견적서</button>
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
  const subsidyReady = !!subsidyInputs.region_code

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

  const vivarTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [vivarState, setVivarState] = useState<'loading' | 'ok' | 'fail'>('loading')

  useEffect(() => {
    vivarTimer.current = setTimeout(() => setVivarState('fail'), 10000)
    return () => { if (vivarTimer.current) clearTimeout(vivarTimer.current) }
  }, [])

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
  const disabledGroupCodes = useMemo<Set<string>>(() => {
    if (!bundle) return new Set()
    const disabled = new Set<string>()
    for (const rule of bundle.rules) {
      if (rule.effect === 'disable' && rule.target_type === 'group') {
        if (Object.values(selections).includes(rule.when_value)) {
          disabled.add(rule.target_code)
        }
      }
    }
    return disabled
  }, [bundle, selections])

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
        is_sosang: subsidyInputs.is_small_business,
        has_transport_license: subsidyInputs.has_transport_license,
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
      is_sosang: subsidyInputs.is_small_business,
      sosang_rate: bundle.subsidy_national?.sosang_rate ?? 0.3,
      is_individual: biz === 'individual',
      has_transport_license: subsidyInputs.has_transport_license,
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
          is_sosang: v.subsidy.is_small_business,
          region: v.subsidy.region_code,
          address: v.address.trim() || undefined,
          has_transport_license: v.subsidy.has_transport_license,
          diesel_status: v.subsidy.diesel_status,
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
        is_small_business: v.subsidy.is_small_business,
        has_transport_license: v.subsidy.has_transport_license,
        diesel_status: v.subsidy.diesel_status,
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
            <span style={styles.vtabR}>차종 변경</span>
          </div>

          <div style={styles.stage}>
            {/* iframe: 성공 전까지 hidden 상태로 백그라운드 로드 */}
            <iframe
              src="https://evnsolution.vivar.im/"
              style={{ ...styles.vivarFrame, visibility: vivarState === 'ok' ? 'visible' : 'hidden' }}
              allow="fullscreen; xr-spatial-tracking"
              title="VIVAR 3D 컨피규레이터"
              onLoad={() => {
                if (vivarTimer.current) { clearTimeout(vivarTimer.current); vivarTimer.current = null }
                setVivarState('ok')
              }}
              onError={() => setVivarState('fail')}
            />
            {/* 로딩 중 or 실패 시 fallback placeholder */}
            {vivarState !== 'ok' && (
              <div style={styles.fallback}>
                <svg viewBox="0 0 520 230" style={styles.placeholderSvg} xmlns="http://www.w3.org/2000/svg">
                  <g fill="none" stroke="#c4c9d0" strokeWidth="3">
                    <path d="M30 170 L30 120 Q30 108 42 108 L120 108 L150 70 L210 70 L210 170 Z" fill="#f0f2f4"/>
                    <rect x="210" y="55" width="270" height="115" rx="4" fill="#f7f8fa"/>
                    <line x1="150" y1="70" x2="150" y2="108"/>
                    <circle cx="95" cy="178" r="22" fill="#e9ecef"/><circle cx="400" cy="178" r="22" fill="#e9ecef"/>
                    <circle cx="95" cy="178" r="9" fill="#fff"/><circle cx="400" cy="178" r="9" fill="#fff"/>
                  </g>
                  <text x="345" y="118" textAnchor="middle" fill="#aeb4bc" fontSize="13">특장 (탑)</text>
                  <text x="120" y="95" textAnchor="middle" fill="#aeb4bc" fontSize="11">PV5</text>
                </svg>
                {vivarState === 'fail' && (
                  <span style={styles.fallbackMsg}>3D 로드 불가 (도메인 frame 허용 필요)</span>
                )}
              </div>
            )}
            <span style={styles.caption}>3D 미리보기 · 옵션 연동 예정</span>
            <span style={styles.watermark}>Powered by VIVAR</span>
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
    flex: 1,
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
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
    overflow: 'hidden' as const,
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
  placeholderSvg: { width: '55%', maxWidth: 520 },
  vivarFrame: { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', border: 'none', transformOrigin: 'top left', transform: 'scale(1.7) translate(-90px, -68px)' },
  fallback: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 8 },
  fallbackMsg: { fontSize: 11, color: '#b71c1c', background: '#fff8f8', border: '1px solid #ffcdd2', padding: '4px 10px', borderRadius: 6 },
  caption: { position: 'absolute' as const, bottom: 10, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: '#9aa0a8', background: 'rgba(255,255,255,0.82)', border: '1px solid var(--line)', padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' as const, pointerEvents: 'none' as const, zIndex: 10 },
  watermark: { position: 'absolute' as const, bottom: 10, right: 18, fontSize: 11, color: '#b9bdc4', zIndex: 10, pointerEvents: 'none' as const },
}

const lv: Record<string, React.CSSProperties> = {
  root: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' },
  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 13, fontWeight: 700, color: 'var(--dark)', marginBottom: 12 },
  empty: { color: 'var(--muted)', fontSize: 13, padding: '24px 0', textAlign: 'center' },
  tableWrap: { overflowX: 'auto' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '8px 12px',
    borderBottom: '2px solid var(--line)', color: 'var(--muted)', fontWeight: 600, fontSize: 12,
    whiteSpace: 'nowrap',
  },
  td: { padding: '10px 12px', borderBottom: '1px solid var(--line)', verticalAlign: 'middle' },
  badgeDraft:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#f0f2f4', color: 'var(--muted)' },
  badgeActive: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: 'var(--lime)', color: 'var(--dark)' },
  badgeMuted:  { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#e3f2fd', color: '#1565c0' },
  pdfBtn: { padding: '4px 10px', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', background: '#f7f8f3', color: 'var(--dark)', fontWeight: 700, fontSize: 11 },
  sendBtn: { padding: '4px 10px', border: '1px solid #b8c9e0', borderRadius: 6, cursor: 'pointer', background: '#eaf2ff', color: '#1565c0', fontWeight: 700, fontSize: 11 },
  confirmBtn: { padding: '4px 10px', border: '1px solid #1a1a1a', borderRadius: 6, cursor: 'pointer', background: '#1a1a1a', color: '#fff', fontWeight: 700, fontSize: 11 },
}
