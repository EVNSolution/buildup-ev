import { useState } from 'react'
import type { VehicleModel, QuoteResult } from '@shared/types/index'
import { VehicleOptionsTab } from './tabs/VehicleOptionsTab'
import { BodyOptionsTab } from './tabs/BodyOptionsTab'
import { InteriorOptionsTab } from './tabs/InteriorOptionsTab'

type TabKey = 'vehicle' | 'body' | 'interior'

interface Props {
  model: VehicleModel
  selections: Record<string, string>
  selectedTrim: string
  onSelectTrim: (key: string) => void
  onSelect: (groupKey: string, valueKey: string) => void
  onGenerateQuote: () => void
  onConfirmQuote: () => void
  quoteResult: QuoteResult | null
  isCalculating: boolean
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'vehicle', label: '차량옵션' },
  { key: 'body', label: '특장' },
  { key: 'interior', label: '내부옵션' },
]

export function OptionPanel({
  model,
  selections,
  selectedTrim,
  onSelectTrim,
  onSelect,
  onGenerateQuote,
  onConfirmQuote,
  quoteResult,
  isCalculating,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('vehicle')

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
            trims={model.trims}
            selectedTrim={selectedTrim}
            onSelectTrim={onSelectTrim}
          />
        )}
        {activeTab === 'body' && (
          <BodyOptionsTab
            groups={model.option_groups}
            selections={selections}
            onSelect={onSelect}
          />
        )}
        {activeTab === 'interior' && (
          <InteriorOptionsTab
            groups={model.option_groups}
            selections={selections}
            onSelect={onSelect}
          />
        )}
      </div>

      <div style={styles.footer}>
        <button style={styles.btnCalc} onClick={onGenerateQuote} disabled={isCalculating}>
          {isCalculating ? '계산 중…' : '견적 생성'}
        </button>
        <button
          style={quoteResult ? styles.btnConfirmReady : styles.btnConfirm}
          onClick={onConfirmQuote}
        >
          견적 확정
        </button>
      </div>
    </aside>
  )
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
    gap: 8,
  },
  btnCalc: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: 'none', background: 'var(--lime)', color: 'var(--dark)',
  } as React.CSSProperties,
  btnConfirm: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: '1px solid var(--line)', background: '#fff', color: '#bbb',
  } as React.CSSProperties,
  btnConfirmReady: {
    flex: 1, fontSize: 13.5, fontWeight: 700, padding: 12, borderRadius: 9,
    cursor: 'pointer', border: '1px solid var(--dark)', background: '#fff', color: 'var(--dark)',
  } as React.CSSProperties,
}
