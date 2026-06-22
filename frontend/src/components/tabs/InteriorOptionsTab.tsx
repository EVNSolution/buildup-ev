import type { ApiOptionGroup } from '@shared/types/index'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
}

export function InteriorOptionsTab({ groups, selections, onSelect, disabledGroupCodes }: Props) {
  return (
    <div>
      {groups.map(group => {
        const isDisabled = disabledGroupCodes.has(group.code)
        // R3: 저상탑→스포일러 숨김
        if (group.code === 'SPOILER' && isDisabled) return null

        return (
          <SegmentRow
            key={group.code}
            group={group}
            selected={selections[group.code] ?? ''}
            onSelect={onSelect}
            disabled={isDisabled}
          />
        )
      })}
    </div>
  )
}

function SegmentRow({ group, selected, onSelect, disabled }: {
  group: ApiOptionGroup
  selected: string
  onSelect: (code: string, val: string) => void
  disabled: boolean
}) {
  return (
    <div style={{ ...styles.row, opacity: disabled ? 0.4 : 1 }}>
      <label style={styles.label}>
        {group.name}
        {disabled && <span style={styles.disabledBadge}> 비활성</span>}
      </label>
      <div style={styles.seg}>
        {group.values.map(v => (
          <button
            key={v.code}
            style={v.code === selected ? styles.segBtnOn : styles.segBtn}
            onClick={() => !disabled && onSelect(group.code, v.code)}
            disabled={disabled}
          >
            {v.name}
          </button>
        ))}
      </div>
    </div>
  )
}

const btnBase = {
  flex: 1,
  minWidth: 54,
  fontSize: 12.5,
  padding: '9px 6px',
  border: '1px solid var(--line)',
  background: '#fff',
  borderRadius: 8,
  cursor: 'pointer',
  color: 'var(--body)',
}

const styles = {
  row: { marginBottom: 14, transition: 'opacity .15s' },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  disabledBadge: { fontSize: 10, color: 'var(--warn)', marginLeft: 4 },
  seg: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  segBtn: btnBase,
  segBtnOn: { ...btnBase, borderColor: 'var(--dark)', background: 'var(--dark)', color: '#fff', fontWeight: 600 },
}
