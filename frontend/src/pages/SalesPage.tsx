import { useEffect, useMemo, useState } from 'react'
import type { CustomerInfo, ApiPricingBundle, ApiQuote, ApiOrder } from '@shared/types/index'
import type { PricingResult, PricingOk } from '@shared/pricing/core'
import { calcPrice } from '@shared/pricing/core'
import { fetchPricingBundle } from '../api/models'
import { saveQuote, fetchLocalSubsidy, fetchQuotes } from '../api/quotes'
import type { SaveQuoteRequest } from '../api/quotes'
import { fetchOrders } from '../api/orders'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { CustomerModal } from '../components/CustomerModal'
import { PdfModal } from '../components/PdfModal'
import { Tooltip } from '../components/Tooltip'
import { usePermission } from '../components/PermGate'
import { useAuth } from '../contexts/AuthContext'

function mapBizType(bt: CustomerInfo['business_type'] | undefined): 'individual' | 'corporation' | 'simplified' {
  if (bt === 'corporate') return 'corporation'
  if (bt === 'simplified') return 'simplified'
  return 'individual'
}

// ── 내 견적·주문 뷰 ────────────────────────────────────────────────────────
const QUOTE_STATUS_KO: Record<string, string> = {
  draft: '임시저장', confirmed: '확정', ordered: '주문', expired: '만료',
}

const QUOTE_STATUS_FLOW = [
  { key: 'draft',     label: '임시저장', desc: '작성 중인 견적' },
  { key: 'confirmed', label: '확정',     desc: '특장사 배정 · 주문 생성' },
  { key: 'ordered',   label: '주문',     desc: '특장사 제작 진행 중' },
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

function fmtPrice(n: number) { return n ? `₩${n.toLocaleString()}` : '—' }
function fmtDate(s: string)  { return s ? s.slice(0, 10) : '—' }

function MyListView() {
  const [quotes, setQuotes]   = useState<ApiQuote[]>([])
  const [orders, setOrders]   = useState<ApiOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState('')
  const [pdfQuote, setPdfQuote] = useState<{ id: number; customerName?: string } | null>(null)

  useEffect(() => {
    setLoading(true); setErr('')
    Promise.all([fetchQuotes({}), fetchOrders({})])
      .then(([q, o]) => { setQuotes(q); setOrders(o) })
      .catch(e => setErr(e instanceof Error ? e.message : '로드 실패'))
      .finally(() => setLoading(false))
  }, [])

  // order_id 빠른 조회용 (quote_id → order)
  const orderByQuote = new Map(orders.map(o => [o.quote_id, o]))

  if (loading) return <div style={lv.empty}>로딩 중…</div>
  if (err)     return <div style={{ ...lv.empty, color: 'var(--warn)' }}>{err}</div>

  return (
    <>
    {pdfQuote && (
      <PdfModal
        quoteId={pdfQuote.id}
        customerName={pdfQuote.customerName}
        onClose={() => setPdfQuote(null)}
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
                          <span style={q.status === 'draft' ? lv.badgeDraft : q.status === 'confirmed' || q.status === 'ordered' ? lv.badgeActive : lv.badgeMuted}>
                            {QUOTE_STATUS_KO[q.status] ?? q.status}
                          </span>
                        </Tooltip>
                      </td>
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
                          <button
                            style={lv.pdfBtn}
                            onClick={() => setPdfQuote({ id: q.id, customerName: q.customer?.name ?? undefined })}
                          >견적서</button>
                          <button
                            style={lv.sendBtn}
                            onClick={() => alert('발송 기능 준비 중 (메일/문자 연동 예정)')}
                          >발송</button>
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

  const [showModal, setShowModal] = useState(true)
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [skipped, setSkipped] = useState(false)

  const [subsidyLocal, setSubsidyLocal] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [savedQuote, setSavedQuote] = useState<{ quote_id: number; pricing: PricingOk } | null>(null)
  const [saveError, setSaveError] = useState('')

  // 번들 1회 로드
  useEffect(() => {
    if (!session) return
    setBundleLoading(true)
    fetchPricingBundle('PV5_OPENBED')
      .then(data => {
        setBundle(data)
        const defaults: Record<string, string> = {}
        for (const g of data.groups) {
          if (g.values.length > 0) defaults[g.code] = g.values[0]!.code
        }
        setSelections(defaults)
      })
      .catch(e => console.error('pricing-bundle 로드 실패', e))
      .finally(() => setBundleLoading(false))
  }, [session])

  // 지역 변경 시 지방보조금 fetch
  useEffect(() => {
    if (!customer?.region_code || skipped) {
      setSubsidyLocal(0)
      return
    }
    fetchLocalSubsidy(customer.region_code, new Date().getFullYear())
      .then(setSubsidyLocal)
      .catch(() => setSubsidyLocal(0))
  }, [customer?.region_code, skipped])

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

  // 실시간 계산
  const liveCalc = useMemo<PricingResult | null>(() => {
    if (!bundle || Object.keys(selections).length === 0) return null

    const topCode = selections['TOP'] ?? ''
    const doorTypeCode = selections['DOORTYPE'] ?? ''
    const topName = bundle.groups.find(g => g.code === 'TOP')?.values.find(v => v.code === topCode)?.name ?? ''
    const doorTypeName = bundle.groups.find(g => g.code === 'DOORTYPE')?.values.find(v => v.code === doorTypeCode)?.name ?? ''
    const baseSwing = bundle.door_unit_prices.find(d => d.top === topName && d.doortype === '여닫이')?.unit_price ?? 0
    const selectedDoor = bundle.door_unit_prices.find(d => d.top === topName && d.doortype === doorTypeName)?.unit_price ?? 0

    return calcPrice({
      bodytype_code: selections['BODYTYPE'] ?? '',
      trim_code: selections['TRIM'] ?? '',
      selected_value_codes: Object.values(selections),
      door: {
        base_swing_price: baseSwing,
        selected_price: selectedDoor,
        has_extra: selections['DOORADD'] === 'ADD_DRIVER',
      },
      option_prices: bundle.option_prices,
      subsidy_national: bundle.subsidy_national?.amount ?? 0,
      subsidy_sosang_rate: bundle.subsidy_national?.sosang_rate ?? 0,
      subsidy_local: !skipped && customer ? subsidyLocal : 0,
      tax: bundle.tax,
      customer: {
        biz_type: mapBizType(customer?.business_type),
        is_sosang: !skipped && (customer?.is_small_business ?? false),
      },
    })
  }, [bundle, selections, subsidyLocal, customer, skipped])

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
      return next
    })
    setSavedQuote(null)
    setSaveError('')
  }

  function handleCustomerComplete(info: CustomerInfo) {
    setCustomer(info)
    setSkipped(false)
    setShowModal(false)
    setSavedQuote(null)
    setSaveError('')
  }

  function handleSkip() {
    setCustomer(null)
    setSkipped(true)
    setSubsidyLocal(0)
    setShowModal(false)
    setSavedQuote(null)
    setSaveError('')
  }

  async function handleSave() {
    if (!bundle) return
    if (liveCalc?.status === 'unsupported') return

    setIsSaving(true)
    setSaveError('')
    try {
      const req: SaveQuoteRequest = {
        model_code: 'PV5_OPENBED',
        year: new Date().getFullYear(),
        selections,
        customer: customer && !skipped ? {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          biz_type: mapBizType(customer.business_type),
          is_sosang: customer.is_small_business,
          region: customer.region_code,
          scrap_diesel: customer.is_old_vehicle_scrapped,
        } : undefined,
      }
      const result = await saveQuote(req)
      setSavedQuote(result)
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
      {showModal && (
        <CustomerModal onComplete={handleCustomerComplete} onSkip={handleSkip} />
      )}

      <Header customer={customer} onOpenCustomerModal={() => setShowModal(true)} />

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
            <span style={styles.embedTag}>3D 컨피규레이터 (VIVAR iframe 영역)</span>
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
            <span style={styles.watermark}>Powered by VIVAR</span>
          </div>

          <PriceBar
            calc={displayCalc}
            hasCustomer={!!customer && !skipped}
          />
        </section>

        <OptionPanel
          bundle={bundle}
          selections={selections}
          disabledGroupCodes={disabledGroupCodes}
          onSelect={handleSelect}
          onSave={handleSave}
          isSaving={isSaving}
          savedQuote={savedQuote}
          saveError={saveError}
          isUnsupported={isUnsupported}
          canConvert={canConvert}
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
    minHeight: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative' as const,
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
  watermark: { position: 'absolute' as const, bottom: 10, right: 18, fontSize: 11, color: '#b9bdc4' },
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
}
