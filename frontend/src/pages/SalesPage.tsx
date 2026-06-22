import { useEffect, useState } from 'react'
import type { CustomerInfo, QuoteResult, VehicleModel } from '@shared/types/index'
import { fetchModelOptions } from '../api/models'
import { calculateQuote } from '../api/quotes'
import { Header } from '../components/Header'
import { PriceBar } from '../components/PriceBar'
import { OptionPanel } from '../components/OptionPanel'
import { CustomerModal } from '../components/CustomerModal'


export function SalesPage() {
  const [showModal, setShowModal] = useState(true)
  const [customer, setCustomer] = useState<CustomerInfo | null>(null)
  const [skipped, setSkipped] = useState(false)

  const [model, setModel] = useState<VehicleModel | null>(null)
  const [selectedTrim, setSelectedTrim] = useState('basic')
  const [selections, setSelections] = useState<Record<string, string>>({})

  const [quoteResult, setQuoteResult] = useState<QuoteResult | null>(null)
  const [isCalculating, setIsCalculating] = useState(false)
  const [confirmed, setConfirmed] = useState(false)

  useEffect(() => {
    fetchModelOptions('PV5').then(res => {
      setModel(res.model)
      const defaults: Record<string, string> = {}
      res.model.option_groups.forEach(g => { defaults[g.key] = g.default_key })
      setSelections(defaults)
    })
  }, [])

  function handleCustomerComplete(info: CustomerInfo) {
    setCustomer(info)
    setSkipped(false)
    setShowModal(false)
    setQuoteResult(null)
  }

  function handleSkip() {
    setCustomer(null)
    setSkipped(true)
    setShowModal(false)
    setQuoteResult(null)
  }

  function handleSelect(groupKey: string, valueKey: string) {
    setSelections(prev => ({ ...prev, [groupKey]: valueKey }))
    setQuoteResult(null)
  }

  async function handleGenerateQuote() {
    if (!model) return
    if (!customer && !skipped) {
      setShowModal(true)
      return
    }
    setIsCalculating(true)
    try {
      const result = await calculateQuote({
        model_code: model.code,
        trim_key: selectedTrim,
        options: selections,
        customer: customer ?? undefined,
      })
      setQuoteResult(result)
      setConfirmed(false)
    } finally {
      setIsCalculating(false)
    }
  }

  function handleConfirmQuote() {
    if (!quoteResult) {
      alert('먼저 [견적 생성]을 눌러주세요.')
      return
    }
    if (!customer) {
      alert('견적 확정을 위해 고객정보를 입력해 주세요.')
      setShowModal(true)
      return
    }
    setConfirmed(true)
    alert('견적이 확정되어 주문으로 전환됩니다. (mockup)')
  }

  if (!model) return <div style={{ padding: 24, color: 'var(--muted)' }}>로딩 중…</div>

  return (
    <div style={styles.root}>
      {showModal && (
        <CustomerModal onComplete={handleCustomerComplete} onSkip={handleSkip} />
      )}

      <Header customer={customer} onOpenCustomerModal={() => setShowModal(true)} />

      <div style={styles.body}>
        {/* 좌측: 3D + 가격바 */}
        <section style={styles.viewer}>
          <div style={styles.vtabs}>
            {['FREE', 'TOP', 'SIDE', 'REAR', 'FRONT'].map(v => (
              <span key={v} style={v === 'FREE' ? styles.vtabOn : styles.vtab}>{v}</span>
            ))}
            <span style={styles.vtabR}>차종 변경</span>
          </div>

          <div style={styles.stage}>
            <span style={styles.embedTag}>3D 컨피규레이터 (VIVAR iframe 영역)</span>
            {/* TODO: 옵션→3D 반영 연동 후 실제 iframe 활성화
            <iframe src="https://evnsolution.vivar.im" style={styles.iframe} title="VIVAR 3D" /> */}
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

          <PriceBar result={quoteResult} hasSubsidy={!!customer && !skipped} />
        </section>

        {/* 우측: 옵션 패널 */}
        <OptionPanel
          model={model}
          selections={selections}
          selectedTrim={selectedTrim}
          onSelectTrim={key => { setSelectedTrim(key); setQuoteResult(null) }}
          onSelect={handleSelect}
          onGenerateQuote={handleGenerateQuote}
          onConfirmQuote={handleConfirmQuote}
          quoteResult={quoteResult}
          isCalculating={isCalculating}
        />
      </div>

      {confirmed && (
        <div style={styles.confirmedBanner}>
          견적 확정 완료 — 주문 전환 처리 중 (mockup)
        </div>
      )}
    </div>
  )
}

const styles = {
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
  iframe: { width: '100%', height: '100%', border: 'none' },
  watermark: { position: 'absolute' as const, bottom: 10, right: 18, fontSize: 11, color: '#b9bdc4' },
  confirmedBanner: {
    position: 'fixed' as const,
    bottom: 20,
    left: '50%',
    transform: 'translateX(-50%)',
    background: 'var(--dark)',
    color: '#fff',
    padding: '10px 24px',
    borderRadius: 8,
    fontSize: 13,
    zIndex: 100,
  },
}
