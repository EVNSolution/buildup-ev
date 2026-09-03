import { useEffect, useState } from 'react'
import type { ApiPricingBundle } from '@shared/types/index'
import type { PricingOk } from '@shared/pricing/core'
import { VehicleOptionsTab } from './tabs/VehicleOptionsTab'
import { BodyOptionsTab } from './tabs/BodyOptionsTab'
import { BodyOnlyToggle, BodyOnlyNotice, VehicleOnlyToggle, CarPriceOverrideBlock } from './BodyOnlyPanel'
import { safeBottom } from '../styles/safeArea'
import { InteriorOptionsTab } from './tabs/InteriorOptionsTab'
import { groupsByCategory, OPTION_CATEGORY } from '../lib/optionRules'
import { QuoteExtras } from './QuoteExtras'

type TabKey = 'vehicle' | 'body' | 'interior'

interface Props {
  bundle: ApiPricingBundle
  selections: Record<string, string>
  disabledGroupCodes: Set<string>
  hiddenGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
  onSelect: (groupCode: string, valueCode: string) => void
  onSave: () => void
  /** 저장 완료 후 새 견적을 시작한다(저장 상태 해제). */
  onStartNew: () => void
  isSaving: boolean
  /** 좁거나 짧은 창 — 폭을 전부 쓰고, 메모·프로모션은 더 접는다 */
  compact?: boolean
  /**
   * 공개 화면(비로그인) — 메모·프로모션·지방보조금 소진을 **감춘다**.
   * 셋 다 영업 재량 값이라 고객이 만질 자리가 아니다.
   */
  publicMode?: boolean
  /** 주 버튼 문구를 갈아끼운다(공개 화면 = 「상담 신청」). 미지정이면 기존 문구. */
  saveLabel?: string
  /**
   * 특장만 견적 — 차를 이미 가진 고객. 트림을 고르지 않고 보유 차량을 직접 적는다.
   * 공개 화면에는 주지 않는다(영업이 판단할 성격의 견적이다).
   */
  bodyOnly?: boolean
  /** 차량만 견적 — 특장을 장착하지 않는다. 특장·옵션 탭이 잠긴다. */
  vehicleOnly?: boolean
  onToggleVehicleOnly?: (v: boolean) => void
  /** 영업이 적어 넣은 차량 가격(VAT 포함). 안 쓰면 `null` — 없으면 칸 자체를 띄우지 않는다(공개 화면) */
  carPriceOverride?: number | null
  onCarPriceOverrideChange?: (v: number | null) => void
  /** 영업이 적어 넣은 트림명. 비면 고른 트림명이 서류에 나간다 */
  carTrimLabel?: string
  onCarTrimLabelChange?: (v: string) => void
  /** 지금 고른 트림의 가격(VAT 포함) — 직접 입력을 켤 때 채워 넣는 초기값 */
  trimPrice?: number
  /** 지금 고른 트림명 — 트림명을 안 적으면 이것이 나간다 */
  trimName?: string
  onToggleBodyOnly?: (v: boolean) => void
  /** 보유 차종 — 특장만 견적의 전제라 여기서 받는다 */
  ownedModel?: string
  onOwnedModelChange?: (v: string) => void
  /** 냉동 + 특장만일 때 필요한 V2L 확인 — 실제 체크는 특장 탭의 냉동 블럭에서 받는다 */
  v2lConfirmed?: boolean
  onV2lConfirmedChange?: (v: boolean) => void
  savedQuote: { quote_id: number; pricing: PricingOk } | null
  saveError: string
  isUnsupported: boolean
  canConvert?: boolean
  // 메모 + 재량할인(프로모션)
  memo: string
  onMemoChange: (v: string) => void
  promotionZeroed: Set<string>
  onTogglePromotion: (groupCode: string) => void
  promotionDiscount: number
  onPromotionDiscountChange: (v: number) => void
  // 지방보조금 소진 시 이 견적에만 미적용(영업 재량)
  localSubsidyOff: boolean
  onToggleLocalSubsidy: (v: boolean) => void
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vehicle', label: '차량 트림' },
  { key: 'body', label: '특장' },
  { key: 'interior', label: '옵션' },
]

// 분류·필터는 lib/optionRules.ts 로 옮겼다 — 견적 수정 팝업과 공용.

export function OptionPanel({
  bundle,
  selections,
  disabledGroupCodes,
  hiddenGroupCodes,
  hiddenValueCodes,
  optionPrices,
  onSelect,
  onSave,
  onStartNew,
  isSaving,
  compact = false,
  publicMode = false,
  saveLabel,
  bodyOnly,
  vehicleOnly,
  onToggleVehicleOnly,
  carPriceOverride,
  onCarPriceOverrideChange,
  carTrimLabel,
  onCarTrimLabelChange,
  trimPrice,
  trimName,
  onToggleBodyOnly,
  ownedModel,
  onOwnedModelChange,
  v2lConfirmed,
  onV2lConfirmedChange,
  savedQuote,
  saveError,
  isUnsupported,
  canConvert = true,
  memo,
  onMemoChange,
  promotionZeroed,
  onTogglePromotion,
  promotionDiscount,
  onPromotionDiscountChange,
  localSubsidyOff,
  onToggleLocalSubsidy,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('vehicle')

  /*
   * 차량만으로 바꿨는데 특장·옵션 탭에 머물러 있으면 **빈 화면**이 된다.
   * 잠긴 탭에 있으면 차량 탭으로 되돌린다.
   */
  useEffect(() => {
    if (vehicleOnly && activeTab !== 'vehicle') setActiveTab('vehicle')
  }, [vehicleOnly, activeTab])
  // 견적 저장 전에 모든 단계를 확인하게 강제한다. 기본 화면인 트림(vehicle)은 이미 본 것으로 친다.
  const [visited, setVisited] = useState<Set<TabKey>>(new Set<TabKey>(['vehicle']))
  /*
   * ⚠️ **잠긴 탭은 확인 대상이 아니다.**
   *
   * 차량만 견적이면 특장·옵션 탭을 누를 수 없다. 그런데 「방문하지 않은 탭」을 그대로
   * 세면 **갈 수도 없는 곳을 확인하라며 저장이 영영 막힌다**(실제 제보).
   */
  const lockedTab = (k: TabKey) => !!vehicleOnly && k !== 'vehicle'
  const unseen = TABS.filter((t) => !visited.has(t.key) && !lockedTab(t.key))
  const btnLabel = isSaving
    ? '저장 중…'
    : saveLabel && !unseen.length && !isUnsupported
    ? saveLabel
    : savedQuote
    ? '새 견적 작성'
    : isUnsupported
    ? '내장탑 미정 — 확정 불가'
    : unseen.length
    ? `${unseen.map((t) => t.label).join('·')} 확인 필요`
    : '견적 저장'

  // 저장 완료 상태에서는 버튼이 '새 견적 작성' 이 된다 — 잠그면 다음 견적을 못 짠다.
  const btnDisabled = isSaving || (!savedQuote && (isUnsupported || unseen.length > 0))

  return (
    <aside style={{ ...styles.panel, ...(compact ? styles.panelCompact : null) }}>
      <div style={styles.tabs}>
        {/*
          차량만 견적이면 **특장·옵션 탭을 잠근다.** 특장을 장착하지 않는데 고를 수 있게 두면
          고른 것이 금액에 안 잡혀 「왜 반영이 안 되냐」가 된다. 아예 못 누르게 막는다.
        */}
        {TABS.map(tab => (
          <div
            key={tab.key}
            // 탭은 <div> 라 disabled 가 없다 — 눌러도 아무 일이 없게 만들고 모양으로 알린다
            style={tab.key === activeTab ? styles.tabOn
              : lockedTab(tab.key) ? styles.tabOff : styles.tab}
            aria-disabled={lockedTab(tab.key)}
            title={lockedTab(tab.key) ? '차량만 견적이라 특장 옵션을 고르지 않습니다' : undefined}
            onClick={() => {
              if (lockedTab(tab.key)) return
              setActiveTab(tab.key); setVisited((v) => new Set(v).add(tab.key))
            }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <div style={styles.scroll}>
        {activeTab === 'vehicle' && (
          <>
            {/* 특장만이면 트림을 고를 이유가 없다 — 차량을 팔지 않는다 */}
            {!bodyOnly && (
              <VehicleOptionsTab
                groups={groupsByCategory(bundle, OPTION_CATEGORY.vehicle, hiddenGroupCodes)}
                selections={selections}
                onSelect={onSelect}
                hiddenValueCodes={hiddenValueCodes}
                optionPrices={optionPrices}
              />
            )}
            {onToggleBodyOnly && (
              <div style={{ marginTop: bodyOnly ? 0 : 'var(--sp-4)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-2)' }}>
                <BodyOnlyToggle on={!!bodyOnly} onToggle={onToggleBodyOnly} disabled={!!vehicleOnly} />
                {/* 거울상 — 둘은 동시에 고를 수 없다 */}
                {onToggleVehicleOnly && (
                  <VehicleOnlyToggle on={!!vehicleOnly} onToggle={onToggleVehicleOnly} disabled={!!bodyOnly} />
                )}
                {/* 트림 단가와 다른 금액으로 파는 상담 — 특장만 견적에는 차량이 없어 잠근다 */}
                {onCarPriceOverrideChange && onCarTrimLabelChange && (
                  <CarPriceOverrideBlock
                    value={carPriceOverride ?? null}
                    onChange={onCarPriceOverrideChange}
                    trimLabel={carTrimLabel ?? ''}
                    onTrimLabelChange={onCarTrimLabelChange}
                    disabled={!!bodyOnly}
                    trimPrice={trimPrice}
                    trimName={trimName}
                  />
                )}
              </div>
            )}
            {/*
              안내는 **특장만을 골랐을 때만** 뜬다. 차량을 사는 견적에는 해당 없는 이야기라
              늘 띄워 두면 읽지 않게 된다. 확인(체크)은 냉동을 고르는 자리에서 받는다.
            */}
            {bodyOnly && (
              <BodyOnlyNotice model={ownedModel ?? ''} onModelChange={onOwnedModelChange} />
            )}
          </>
        )}
        {activeTab === 'body' && (
          <BodyOptionsTab
            groups={groupsByCategory(bundle, OPTION_CATEGORY.body, hiddenGroupCodes)}
            selections={selections}
            onSelect={onSelect}
            disabledGroupCodes={disabledGroupCodes}
            hiddenValueCodes={hiddenValueCodes}
            optionPrices={optionPrices}
            /* 냉동을 고르는 그 자리에서 V2L 을 확인받는다 — 특장만 견적일 때만 */
            v2lNeeded={!!bodyOnly}
            v2lConfirmed={!!v2lConfirmed}
            onV2lConfirmedChange={onV2lConfirmedChange}
          />
        )}
        {activeTab === 'interior' && (
          <InteriorOptionsTab
            groups={groupsByCategory(bundle, OPTION_CATEGORY.interior, hiddenGroupCodes)}
            selections={selections}
            onSelect={onSelect}
            disabledGroupCodes={disabledGroupCodes}
            hiddenValueCodes={hiddenValueCodes}
            optionPrices={optionPrices}
          />
        )}
      </div>

      {/* 메모·지방보조금 소진·프로모션 — 견적 수정 팝업과 **같은 조각**(QuoteExtras) */}
      {!publicMode && (
      <div style={styles.extra}>
        <QuoteExtras
          vehicleOnly={vehicleOnly}
          bundle={bundle}
          selections={selections}
          optionPrices={optionPrices}
          memo={memo}
          onMemoChange={onMemoChange}
          localSubsidyOff={localSubsidyOff}
          onToggleLocalSubsidy={onToggleLocalSubsidy}
          promotionZeroed={promotionZeroed}
          onTogglePromotion={onTogglePromotion}
          promotionDiscount={promotionDiscount}
          onPromotionDiscountChange={onPromotionDiscountChange}
        />
      </div>
      )}

      {/* 좁은 창은 바로 아래 실구매가 한 줄이 붙는다 — 사이가 벌어지면 남의 화면처럼 읽힌다 */}
      <div style={compact ? { ...styles.footer, paddingBottom: safeBottom('var(--sp-2)') } : styles.footer}>
        {saveError && <div style={styles.saveError}>{saveError}</div>}
        {savedQuote && !saveError && (
          <div style={styles.savedNote}>
            견적 #{savedQuote.quote_id} 저장 완료 — 「내 견적·주문」 탭에서 견적서를 만들 수 있습니다. 「새 견적 작성」을 누르면 처음 상태로 돌아갑니다.
          </div>
        )}
        {canConvert && (
          <button
            style={btnDisabled ? styles.btnDisabled : savedQuote ? styles.btnSaved : styles.btnConfirm}
            onClick={savedQuote ? onStartNew : onSave}
            disabled={btnDisabled}
          >
            {btnLabel}
          </button>
        )}
      </div>
    </aside>
  )
}

// 패널 하단 주 버튼 — 크기·모양은 공통 토큰을 따르고, 폭만 패널을 꽉 채운다
const btnBase = {
  width: '100%',
  fontSize: 'var(--fs-body)',
  fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
  minHeight: 'var(--h-control)',
  borderRadius: 'var(--r-sm)',
  cursor: 'pointer',
  border: 'none',
}

const styles = {
  /** 잠긴 탭 — 자리는 지키되 누를 수 없다. 사라지면 무엇이 잠겼는지 알 수 없다 */
  tabOff: { opacity: 0.4, cursor: 'not-allowed' } as React.CSSProperties,
  savedNote: {
    background: 'var(--lime-bg)', border: '0.5px solid var(--lime)', color: 'var(--dark)',
    fontSize: 13, padding: '9px 11px', borderRadius: 8, marginBottom: 8, lineHeight: 1.5,
  },
  panel: {
    // 예전엔 440px 고정이라 넓은 화면에서 오른쪽이 휑하게 비어 보였다.
    // 3D 가 16:9 로 자리를 잡고 남는 폭을 이 패널이 전부 채운다.
    flex: 1,
    // 화면이 좁으면 여기까지만 줄어든다 — 기본 폭의 0.75배(380 → 285).
    // 더 줄이면 옵션 카드 2열이 무너진다.
    minWidth: 285,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
  },
  // 좁은 창에서는 폭을 전부 쓴다(2단이 아니므로 최소폭을 지킬 이유가 없다)
  panelCompact: { minWidth: 0, flex: 1 },
  // 패널 안 내용 탭 — 화면 탭과 같은 밑줄 방식. 선택 표시는 라임(선택·활성 표시 전용 색)
  tabs: { flexShrink: 0, display: 'flex' },
  tab: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 'var(--fs-body)',
    padding: 'var(--sp-3) var(--sp-1)',
    cursor: 'pointer',
    color: 'var(--muted)',
    borderBottom: '2px solid transparent',
  },
  tabOn: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 'var(--fs-body)',
    padding: 'var(--sp-3) var(--sp-1)',
    cursor: 'pointer',
    color: 'var(--dark)',
    fontWeight: 'var(--fw-section)' as React.CSSProperties['fontWeight'],
    borderBottom: '2px solid var(--lime)',
  },
  // 옵션 목록 — 이 패널의 주인공. 자리가 모자라면 **맨 마지막에** 줄어든다
  scroll: { flex: 3, minHeight: 120, overflowY: 'auto' as const, padding: '18px 16px' },
  extra: {
    /*
     * 메모·프로모션은 곁다리다. 예전엔 flexShrink:0 + maxHeight:260 이라 창이 짧아지면
     * **옵션만 줄어들어 라벨만 남았다**(창 모드 태블릿에서 실제로 그랬다).
     * 이제 옵션(flex 3)과 함께 줄어들되 옵션보다 먼저 양보한다.
     */
    flex: '0 1 auto' as const,
    minHeight: 0,
    // 선 대신 여백으로 나눈다 — 좁은 패널에 가로선을 여러 개 그으면 화면이 토막나 보인다
    padding: 'var(--sp-4)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    maxHeight: 'min(220px, 26%)',
    overflowY: 'auto' as const,
  },
  extraLabel: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  hint: { fontSize: 13, color: 'var(--muted)', fontWeight: 400 },
  memo: {
    width: '100%', boxSizing: 'border-box' as const, fontSize: 'var(--fs-body)',
    resize: 'vertical' as const, fontFamily: 'inherit',
  },
  promoToggle: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, cursor: 'pointer', fontWeight: 600, color: 'var(--dark)' },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' } as React.CSSProperties,
  promoList: { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '4px 0 2px 22px' },
  promoEmpty: { fontSize: 13, color: 'var(--muted)' },
  promoItem: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' },
  promoName: { flex: 1, color: 'var(--dark)' },
  promoPrice: { color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' as const },
  promoZeroed: { color: 'var(--dark)', fontWeight: 700 },
  footer: {
    flexShrink: 0,
    // 아이폰 홈 인디케이터에 버튼이 가리지 않게 — 배경은 바닥까지, 내용만 위로
    padding: '0 var(--sp-4)',
    paddingBottom: safeBottom('var(--sp-4)'),
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  saveError: {
    fontSize: 'var(--fs-label)',
    color: 'var(--warn)',
    background: 'var(--warnbg)',
    border: '0.5px solid var(--warn)',
    padding: 'var(--sp-2) var(--sp-3)',
    borderRadius: 'var(--r-sm)',
  },
  btnConfirm: {
    ...btnBase,
    background: 'var(--dark)',
    color: '#fff',
  },
  // 저장이 끝난 상태 — 끝난 일이므로 '완료' 톤(회색)으로 물러난다
  btnSaved: {
    ...btnBase,
    background: 'var(--card)',
    color: 'var(--muted)',
    cursor: 'default',
  },
  btnDisabled: {
    ...btnBase,
    background: 'var(--card)',
    color: 'var(--muted)',
    cursor: 'not-allowed',
  },
}
