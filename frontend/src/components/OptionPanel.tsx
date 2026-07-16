import { useState } from 'react'
import type { ApiPricingBundle, ApiOptionGroup } from '@shared/types/index'
import type { PricingOk } from '@shared/pricing/core'
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
}

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
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('vehicle')

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
