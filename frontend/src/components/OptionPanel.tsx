import { useState } from 'react'
import type { ApiPricingBundle, ApiOptionGroup } from '@shared/types/index'
import type { PricingOk } from '@shared/pricing/core'
import { optionBreakdown } from '@shared/pricing/core'
import { VehicleOptionsTab } from './tabs/VehicleOptionsTab'
import { BodyOptionsTab } from './tabs/BodyOptionsTab'
import { InteriorOptionsTab } from './tabs/InteriorOptionsTab'

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
  savedQuote: { quote_id: number; pricing: PricingOk } | null
  saveError: string
  isUnsupported: boolean
  canConvert?: boolean
  // 메모 + 재량할인(프로모션)
  memo: string
  onMemoChange: (v: string) => void
  promotionZeroed: Set<string>
  onTogglePromotion: (groupCode: string) => void
  // 지방보조금 소진 시 이 견적에만 미적용(영업 재량)
  localSubsidyOff: boolean
  onToggleLocalSubsidy: (v: boolean) => void
}

const wonVat = (supply: number) => '₩' + Math.round(supply * 1.1).toLocaleString('ko-KR')

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vehicle', label: '차량 트림' },
  { key: 'body', label: '특장' },
  { key: 'interior', label: '옵션' },
]

function groupsByCategory(bundle: ApiPricingBundle, category: string, hidden: Set<string>): ApiOptionGroup[] {
  return bundle.groups.filter(g => g.category === category && !hidden.has(g.code))
}

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
  savedQuote,
  saveError,
  isUnsupported,
  canConvert = true,
  memo,
  onMemoChange,
  promotionZeroed,
  onTogglePromotion,
  localSubsidyOff,
  onToggleLocalSubsidy,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('vehicle')
  // 견적 저장 전에 모든 단계를 확인하게 강제한다. 기본 화면인 트림(vehicle)은 이미 본 것으로 친다.
  const [visited, setVisited] = useState<Set<TabKey>>(new Set<TabKey>(['vehicle']))
  const unseen = TABS.filter((t) => !visited.has(t.key))
  const [showPromo, setShowPromo] = useState(false)

  // 재량할인 대상: 가격이 있는 **선택 옵션**만(필수 옵션은 제외 — 탑 등 기본 사양).
  // 예외로 도어종류(DOORTYPE)는 필수지만 할인 대상 — 목록에는 '기본도어' 로 표기한다.
  const PROMO_EXCEPTIONS: Record<string, string> = { DOORTYPE: '기본도어' }
  const breakdown = optionBreakdown(selections, (c) => optionPrices[c] ?? 0)
  const zeroable = (Object.entries(breakdown) as [string, number][])
    .filter(([, v]) => v > 0)
    .map(([group, supply]) => {
      const g = bundle.groups.find((x) => x.code === group)
      const val = g?.values.find((v) => v.code === selections[group])
      const exception = PROMO_EXCEPTIONS[group]
      return {
        group, supply,
        required: (g?.required ?? false) && !exception,
        label: exception ?? g?.name ?? group,
        value: val?.name ?? '',
      }
    })
    .filter((z) => !z.required)

  const btnLabel = isSaving
    ? '저장 중…'
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
    <aside style={styles.panel}>
      <div style={styles.tabs}>
        {TABS.map(tab => (
          <div
            key={tab.key}
            style={tab.key === activeTab ? styles.tabOn : styles.tab}
            onClick={() => { setActiveTab(tab.key); setVisited((v) => new Set(v).add(tab.key)) }}
          >
            {tab.label}
          </div>
        ))}
      </div>

      <div style={styles.scroll}>
        {activeTab === 'vehicle' && (
          <VehicleOptionsTab
            groups={groupsByCategory(bundle, '차량옵션', hiddenGroupCodes)}
            selections={selections}
            onSelect={onSelect}
            hiddenValueCodes={hiddenValueCodes}
            optionPrices={optionPrices}
          />
        )}
        {activeTab === 'body' && (
          <BodyOptionsTab
            groups={groupsByCategory(bundle, '특장', hiddenGroupCodes)}
            selections={selections}
            onSelect={onSelect}
            disabledGroupCodes={disabledGroupCodes}
            hiddenValueCodes={hiddenValueCodes}
            optionPrices={optionPrices}
          />
        )}
        {activeTab === 'interior' && (
          <InteriorOptionsTab
            groups={groupsByCategory(bundle, '옵션', hiddenGroupCodes)}
            selections={selections}
            onSelect={onSelect}
            disabledGroupCodes={disabledGroupCodes}
            hiddenValueCodes={hiddenValueCodes}
            optionPrices={optionPrices}
          />
        )}
      </div>

      <div style={styles.extra}>
        <label style={styles.extraLabel}>메모 / 안내문</label>
        <textarea
          style={styles.memo}
          rows={3}
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
        />

        <label style={styles.promoToggle}>
          <input
            type="checkbox"
            checked={localSubsidyOff}
            onChange={(e) => onToggleLocalSubsidy(e.target.checked)}
            style={styles.cbox}
          />
          지방보조금 소진
        </label>

        <label style={styles.promoToggle}>
          <input type="checkbox" checked={showPromo} onChange={(e) => setShowPromo(e.target.checked)} style={styles.cbox} />
          프로모션
        </label>
        {showPromo && (
          <div style={styles.promoList}>
            {zeroable.length === 0
              ? <div style={styles.promoEmpty}>할인 가능한 옵션이 없습니다.</div>
              : zeroable.map((z) => (
                <label key={z.group} style={styles.promoItem}>
                  <input
                    type="checkbox"
                    checked={promotionZeroed.has(z.group)}
                    onChange={() => onTogglePromotion(z.group)}
                    style={styles.cbox}
                  />
                  <span style={styles.promoName}>{z.label}{z.value ? ` · ${z.value}` : ''}</span>
                  <span style={promotionZeroed.has(z.group) ? styles.promoZeroed : styles.promoPrice}>
                    {promotionZeroed.has(z.group) ? '0원' : wonVat(z.supply)}
                  </span>
                </label>
              ))
            }
          </div>
        )}
      </div>

      <div style={styles.footer}>
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

const btnBase = {
  width: '100%',
  fontSize: 13.5,
  fontWeight: 700,
  padding: 12,
  borderRadius: 9,
  cursor: 'pointer',
  border: 'none',
}

const styles = {
  savedNote: {
    background: '#eef7e9', border: '1px solid #cfe4c2', color: '#3d6b28',
    fontSize: 12.5, padding: '9px 11px', borderRadius: 8, marginBottom: 8, lineHeight: 1.5,
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
  tabs: { flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--line)' },
  tab: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 13.5,
    padding: '13px 4px',
    cursor: 'pointer',
    color: 'var(--muted)',
    borderBottom: '2px solid transparent',
  },
  tabOn: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 13.5,
    padding: '13px 4px',
    cursor: 'pointer',
    color: 'var(--dark)',
    fontWeight: 700,
    borderBottom: '2px solid var(--lime)',
  },
  scroll: { flex: 1, minHeight: 0, overflowY: 'auto' as const, padding: '18px 16px' },
  extra: {
    flexShrink: 0,
    borderTop: '1px solid var(--line)',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 8,
    maxHeight: 260,
    overflowY: 'auto' as const,
  },
  extraLabel: { fontSize: 13.5, fontWeight: 700, color: 'var(--dark)' },
  hint: { fontSize: 12.5, color: 'var(--muted)', fontWeight: 400 },
  memo: {
    width: '100%', boxSizing: 'border-box' as const, fontSize: 13.5, padding: '9px 11px',
    border: '1px solid var(--line)', borderRadius: 7, resize: 'vertical' as const, fontFamily: 'inherit',
  },
  promoToggle: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13.5, cursor: 'pointer', fontWeight: 600, color: 'var(--dark)' },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' } as React.CSSProperties,
  promoList: { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '4px 0 2px 22px' },
  promoEmpty: { fontSize: 12.5, color: 'var(--muted)' },
  promoItem: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer' },
  promoName: { flex: 1, color: 'var(--dark)' },
  promoPrice: { color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' as const },
  promoZeroed: { color: '#2e7d32', fontWeight: 700 },
  footer: {
    flexShrink: 0,
    borderTop: '1px solid var(--line)',
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  saveError: {
    fontSize: 12,
    color: 'var(--warn)',
    background: 'var(--warnbg)',
    border: '1px solid #f0c9ad',
    padding: '6px 10px',
    borderRadius: 7,
  },
  btnConfirm: {
    ...btnBase,
    background: 'var(--dark)',
    color: '#fff',
  },
  btnSaved: {
    ...btnBase,
    background: '#e6f4ea',
    color: '#2e7d32',
    cursor: 'default',
  },
  btnDisabled: {
    ...btnBase,
    background: '#f0f2f4',
    color: '#b0b7c0',
    cursor: 'not-allowed',
  },
}
