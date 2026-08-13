import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ApiPricingBundle } from '@shared/types/index'
import { computeHidden, computeDisabledGroups, sanitizeSelections } from '../lib/optionRules'
import { buildLiveTotal } from '../lib/liveQuote'
import { offValueCode } from '../components/OptionToggle'
import { fetchPublicPricingBundle, fetchPublicRegions, fetchPublicLocalSubsidy } from '../api/public'
import { OptionPanel } from '../components/OptionPanel'
import { PriceBar } from '../components/PriceBar'
import { DEFAULT_SUBSIDY_INPUTS, type SubsidyInputs } from '../components/SubsidyInputs'
import { InquiryModal } from '../components/InquiryModal'
import { useIsCompact } from '../hooks/useIsCompact'
import { BTN } from '../styles/buttons'
import logoUrl from '../assets/logo.png'
import truckImg from '../assets/stego-k-side.jpg'

/**
 * 공개 컨피규레이터 — `/` (로그인 없이 누구나)
 *
 * 고객이 스스로 사양을 고르고 실구매가를 확인한 뒤 상담을 신청한다.
 *
 * 영업 화면과 **같은 조각·같은 계산**을 쓴다(OptionPanel · PriceBar · buildLiveTotal).
 * 공개용 화면을 따로 그리면 같은 차의 가격이 화면마다 달라진다.
 *
 * 여기 없는 것 — 전부 로그인 뒤의 일이다:
 *   · 메모 · 프로모션(재량할인) · 지방보조금 소진  → 영업 재량 값
 *   · 견적서·계약서 PDF, 내 견적 목록              → 영업·관리자 기능
 */
const MODEL_CODE = 'PV5_OPENBED'

export function PublicConfiguratorPage() {
  const compact = useIsCompact()
  const [bundle, setBundle] = useState<ApiPricingBundle | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [selections, setSelections] = useState<Record<string, string>>({})
  const [subsidyInputs, setSubsidyInputs] = useState<SubsidyInputs>(DEFAULT_SUBSIDY_INPUTS)
  const [regions, setRegions] = useState<string[]>([])
  const [subsidyLocal, setSubsidyLocal] = useState(0)
  const [showInquiry, setShowInquiry] = useState(false)
  const [doneId, setDoneId] = useState<number | null>(null)

  useEffect(() => {
    fetchPublicPricingBundle(MODEL_CODE)
      .then(data => {
        setBundle(data)
        const defaults: Record<string, string> = {}
        for (const g of data.groups) {
          if (g.values.length === 0) continue
          defaults[g.code] = offValueCode(g) ?? g.values[0]!.code
        }
        if (data.groups.some(g => g.code === 'TRIM' && g.values.some(v => v.code === 'TRIM_PLUS'))) {
          defaults['TRIM'] = 'TRIM_PLUS'
        }
        setSelections(sanitizeSelections(defaults, data))
      })
      .catch(e => setLoadErr(e instanceof Error ? e.message : '차량 정보를 불러오지 못했습니다'))
  }, [])

  useEffect(() => { fetchPublicRegions().then(setRegions).catch(() => setRegions([])) }, [])

  useEffect(() => {
    if (!subsidyInputs.region_code) { setSubsidyLocal(0); return }
    fetchPublicLocalSubsidy(subsidyInputs.region_code, new Date().getFullYear())
      .then(setSubsidyLocal)
      .catch(() => setSubsidyLocal(0))
  }, [subsidyInputs.region_code])

  // 보조금 산정 조건이 갖춰졌는가 — 영업 화면과 같은 기준
  const subsidyReady = subsidyInputs.business_type === 'corporate' || !!subsidyInputs.region_code

  const disabledGroupCodes = useMemo(
    () => (bundle ? computeDisabledGroups(selections, bundle) : new Set<string>()),
    [bundle, selections],
  )
  const { hiddenGroupCodes, hiddenValueCodes } = useMemo(() => {
    if (!bundle) return { hiddenGroupCodes: new Set<string>(), hiddenValueCodes: new Set<string>() }
    const { groups, values } = computeHidden(selections, bundle)
    return { hiddenGroupCodes: groups, hiddenValueCodes: values }
  }, [bundle, selections])

  // 금액 계산 — 영업 화면과 **같은 함수**
  const liveTotal = useMemo(
    () => buildLiveTotal({ bundle, selections, subsidyInputs, subsidyLocal, subsidyReady }),
    [bundle, selections, subsidyInputs, subsidyLocal, subsidyReady],
  )

  function handleSelect(groupCode: string, valueCode: string) {
    setSelections(prev => {
      const next = { ...prev, [groupCode]: valueCode }
      return bundle ? sanitizeSelections(next, bundle) : next
    })
  }

  if (loadErr) return <div style={s.center}>{loadErr}</div>
  if (!bundle) return <div style={s.center}>불러오는 중…</div>

  return (
    <div style={s.root}>
      {/* 최상단바 — 로그인 사용자를 위한 것이 아니라 **누구나 보는 표지**다 */}
      <header style={s.header}>
        <div style={s.brand}>
          <img src={logoUrl} alt="EV&Solution" style={s.logo} />
          <span style={s.brandLine} aria-hidden />
          <span style={s.wordmark}>Buildup-EV</span>
        </div>
        <div style={{ flex: 1 }} />
        <Link to="/login" style={{ ...BTN.secondary, textDecoration: 'none' }}>로그인</Link>
      </header>

      <div style={compact ? s.bodyCompact : s.body}>
        {!compact && (
          <section style={s.viewer}>
            <img src={truckImg} alt="STEGO-K" style={s.truck} />
            <div style={s.viewerNote}>3D 미리보기 연동 예정</div>
          </section>
        )}

        <OptionPanel
          compact={compact}
          bundle={bundle}
          selections={selections}
          disabledGroupCodes={disabledGroupCodes}
          hiddenGroupCodes={hiddenGroupCodes}
          hiddenValueCodes={hiddenValueCodes}
          optionPrices={bundle.option_prices}
          onSelect={handleSelect}
          onSave={() => setShowInquiry(true)}
          onStartNew={() => setDoneId(null)}
          isSaving={false}
          savedQuote={null}
          saveError=""
          isUnsupported={false}
          /* 공개 화면 — 메모·프로모션·지방보조금 소진은 아예 없다(영업 재량 값) */
          publicMode
          saveLabel="상담 신청"
          memo="" onMemoChange={() => {}}
          promotionZeroed={EMPTY} onTogglePromotion={() => {}}
          localSubsidyOff={false} onToggleLocalSubsidy={() => {}}
        />
      </div>

      <PriceBar
        calc={null}
        total={liveTotal}
        hasCustomer={subsidyReady}
        subsidy={subsidyInputs}
        onSubsidyChange={setSubsidyInputs}
        regions={regions}
        compact={compact}
        summary={compact}
      />

      {showInquiry && (
        <InquiryModal
          modelCode={MODEL_CODE}
          selections={selections}
          subsidy={subsidyInputs}
          onSubsidyChange={setSubsidyInputs}
          regions={regions}
          onClose={() => setShowInquiry(false)}
          onDone={id => { setShowInquiry(false); setDoneId(id) }}
        />
      )}

      {doneId !== null && (
        <div style={s.overlay} onClick={() => setDoneId(null)}>
          <div style={s.doneBox} onClick={e => e.stopPropagation()}>
            <div style={s.doneTitle}>상담 신청이 접수되었습니다</div>
            <div style={s.doneNo}>접수번호 {doneId}</div>
            <p style={s.doneDesc}>
              담당 영업사원이 확인 후 연락드립니다. 접수번호는 문의하실 때 알려 주시면 빠르게 확인할 수 있습니다.
            </p>
            <button style={{ ...BTN.primary, width: '100%' }} onClick={() => setDoneId(null)}>확인</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** 매 렌더마다 새 Set 을 만들면 자식이 계속 다시 그려진다 */
const EMPTY: Set<string> = new Set()

const s: Record<string, React.CSSProperties> = {
  root: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff' },
  center: { padding: 40, textAlign: 'center', color: 'var(--muted)' },
  header: {
    flexShrink: 0, display: 'flex', alignItems: 'center', gap: 'var(--sp-4)',
    height: 60, padding: '0 var(--sp-5)', borderBottom: 'var(--hairline)', background: '#fff',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', flexShrink: 0 },
  logo: { height: 28, width: 'auto', display: 'block' },
  brandLine: { width: 1, height: 18, background: 'var(--line)', display: 'block' },
  wordmark: { fontSize: 'var(--fs-section)', fontWeight: 700, letterSpacing: '-0.035em', color: 'var(--dark)' },
  body: { flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' },
  bodyCompact: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  viewer: {
    flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 'var(--sp-2)', padding: 'var(--sp-4)',
  },
  truck: { width: '100%', maxWidth: 900, height: 'auto', objectFit: 'contain' },
  viewerNote: { fontSize: 'var(--fs-caption)', color: 'var(--muted)' },
  overlay: {
    position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--sp-4)',
  },
  doneBox: {
    background: '#fff', borderRadius: 'var(--r-md)', padding: 'var(--sp-5)',
    width: 'min(400px, 94vw)', boxShadow: 'var(--shadow-2)',
  },
  doneTitle: { fontSize: 'var(--fs-section)', fontWeight: 700, color: 'var(--dark)', marginBottom: 'var(--sp-2)' },
  doneNo: {
    display: 'inline-block', fontSize: 'var(--fs-body)', fontWeight: 700, color: 'var(--dark)',
    background: 'var(--lime-bg)', border: '1px solid var(--lime)', borderRadius: 'var(--r-sm)',
    padding: '4px 10px', marginBottom: 'var(--sp-3)',
  },
  doneDesc: { fontSize: 'var(--fs-label)', color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 var(--sp-4)' },
}
