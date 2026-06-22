import { useEffect, useMemo, useState } from 'react'
import type { CustomerInfo, ApiPricingBundle } from '@shared/types/index'
import type { PricingResult, PricingOk } from '@shared/pricing/core'
import { calcPrice } from '@shared/pricing/core'
import { fetchPricingBundle } from '../api/models'
import { saveQuote, fetchLocalSubsidy } from '../api/quotes'
import type { SaveQuoteRequest } from '../api/quotes'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { CustomerModal } from '../components/CustomerModal'
import { usePermission } from '../components/PermGate'
import { useAuth } from '../contexts/AuthContext'

function mapBizType(bt: CustomerInfo['business_type'] | undefined): 'individual' | 'corporation' | 'simplified' {
  if (bt === 'corporate') return 'corporation'
  if (bt === 'simplified') return 'simplified'
  return 'individual'
}

export function SalesPage() {
  const { session } = useAuth()
  const canConvert = usePermission('order.convert')

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
    const email = session?.user.email
    if (!email) return
    setBundleLoading(true)
    fetchPricingBundle('PV5_OPENBED', email)
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
  }, [session?.user.email])

  // 지역 변경 시 지방보조금 fetch
  useEffect(() => {
    const email = session?.user.email
    if (!customer?.region_code || !email || skipped) {
      setSubsidyLocal(0)
      return
    }
    fetchLocalSubsidy(customer.region_code, new Date().getFullYear(), email)
      .then(setSubsidyLocal)
      .catch(() => setSubsidyLocal(0))
  }, [customer?.region_code, session?.user.email, skipped])

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
    const email = session?.user.email
    if (!email || !bundle) return
    if (liveCalc?.status === 'unsupported') return

    setIsSaving(true)
    setSaveError('')
    try {
      const req: SaveQuoteRequest = {
        model_code: 'PV5_OPENBED',
        year: new Date().getFullYear(),
        selections,
        customer: customer && !skipped ? {
          biz_type: mapBizType(customer.business_type),
          is_sosang: customer.is_small_business,
          region: customer.region_code,
          scrap_diesel: customer.is_old_vehicle_scrapped,
        } : undefined,
      }
      const result = await saveQuote(req, email)
      setSavedQuote(result)
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : '저장 실패')
    } finally {
      setIsSaving(false)
    }
  }

  const isUnsupported = liveCalc?.status === 'unsupported'
  const displayCalc = savedQuote ? { status: 'ok' as const, ...savedQuote.pricing } : liveCalc

  if (bundleLoading) return <div style={styles.loading}>로딩 중…</div>
  if (!bundle) return <div style={styles.loading}>옵션 데이터 로드 실패</div>

  return (
    <div style={styles.root}>
      {showModal && (
        <CustomerModal onComplete={handleCustomerComplete} onSkip={handleSkip} />
      )}

      <Header customer={customer} onOpenCustomerModal={() => setShowModal(true)} />

      <div style={styles.body}>
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
