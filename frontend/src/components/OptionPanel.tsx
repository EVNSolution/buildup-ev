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
  const [showPromo, setShowPromo] = useState(false)

  // 재량할인 대상: 가격이 있는 특장옵션(그룹별 단가 분해). label = 그룹명 + 선택값명.
  const breakdown = optionBreakdown(selections, (c) => optionPrices[c] ?? 0)
  const zeroable = (Object.entries(breakdown) as [string, number][])
    .filter(([, v]) => v > 0)
    .map(([group, supply]) => {
      const g = bundle.groups.find((x) => x.code === group)
      const val = g?.values.find((v) => v.code === selections[group])
      return { group, supply, label: g?.name ?? group, value: val?.name ?? '' }
    })

  const btnLabel = isSaving
    ? '저장 중…'
    : savedQuote
    ? `저장 완료 (#${savedQuote.quote_id})`
    : isUnsupported
    ? '내장탑 미정 — 확정 불가'
    : '견적 저장'

  const btnDisabled = isSaving || !!savedQuote || isUnsupported

  return (
    <aside style={styles.panel}>
      <div style={styles.tabs}>
        {TABS.map(tab => (
          <div
            key={tab.key}
            style={tab.key === activeTab ? styles.tabOn : styles.tab}
            onClick={() => setActiveTab(tab.key)}
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
        <label style={styles.promoToggle}>
          <input
            type="checkbox"
            checked={localSubsidyOff}
            onChange={(e) => onToggleLocalSubsidy(e.target.checked)}
            style={styles.cbox}
          />
          지방보조금 미적용 <span style={styles.hint}>(예산 소진 시 — 이 견적에만 적용)</span>
        </label>

        <label style={styles.extraLabel}>메모 / 안내문 <span style={styles.hint}>(견적서에 그대로 표기)</span></label>
        <textarea
          style={styles.memo}
          rows={3}
          placeholder="예: 탁송료·보조금은 출고 시점에 따라 변경될 수 있습니다."
          value={memo}
          onChange={(e) => onMemoChange(e.target.value)}
        />

        <label style={styles.promoToggle}>
          <input type="checkbox" checked={showPromo} onChange={(e) => setShowPromo(e.target.checked)} style={styles.cbox} />
          프로모션 (영업 재량할인 — 선택 옵션 0원 처리)
        </label>
        {showPromo && (
          <div style={styles.promoList}>
            {zeroable.length === 0
              ? <div style={styles.promoEmpty}>가격이 있는 특장옵션이 없습니다.</div>
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
                    {promotionZeroed.has(z.group) ? '0원 (할인)' : `−${wonVat(z.supply)}`}
                  </span>
                </label>
              ))
            }
          </div>
        )}
      </div>

      <div style={styles.footer}>
        {saveError && <div style={styles.saveError}>{saveError}</div>}
        {canConvert && (
          <button
            style={btnDisabled ? styles.btnDisabled : savedQuote ? styles.btnSaved : styles.btnConfirm}
            onClick={onSave}
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
  panel: {
    flexShrink: 0,
    width: 440,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
  },
  tabs: { flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--line)' },
  tab: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 13,
    padding: '13px 4px',
    cursor: 'pointer',
    color: 'var(--muted)',
    borderBottom: '2px solid transparent',
  },
  tabOn: {
    flex: 1,
    textAlign: 'center' as const,
    fontSize: 13,
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
  extraLabel: { fontSize: 12, fontWeight: 700, color: 'var(--dark)' },
  hint: { fontSize: 10.5, color: 'var(--muted)', fontWeight: 400 },
  memo: {
    width: '100%', boxSizing: 'border-box' as const, fontSize: 12.5, padding: '8px 10px',
    border: '1px solid var(--line)', borderRadius: 7, resize: 'vertical' as const, fontFamily: 'inherit',
  },
  promoToggle: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, cursor: 'pointer', fontWeight: 600, color: 'var(--dark)' },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' } as React.CSSProperties,
  promoList: { display: 'flex', flexDirection: 'column' as const, gap: 4, padding: '4px 0 2px 22px' },
  promoEmpty: { fontSize: 11.5, color: 'var(--muted)' },
  promoItem: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, cursor: 'pointer' },
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
