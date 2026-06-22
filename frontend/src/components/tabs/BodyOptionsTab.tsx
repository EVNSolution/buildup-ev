import type { OptionGroup } from '@shared/types/index'

interface Props {
  groups: OptionGroup[]
  selections: Record<string, string>
  onSelect: (groupKey: string, valueKey: string) => void
}

const BODY_KEYS = ['cargo_type', 'top_size', 'door_type', 'door_extra']

export function BodyOptionsTab({ groups, selections, onSelect }: Props) {
  const bodyGroups = groups.filter(g => BODY_KEYS.includes(g.key))

  return (
    <div>
      {bodyGroups.map(group => (
        <SegmentRow key={group.key} group={group} selected={selections[group.key] ?? group.default_key} onSelect={onSelect} />
      ))}
    </div>
  )
}

function SegmentRow({ group, selected, onSelect }: {
  group: OptionGroup
  selected: string
  onSelect: (gKey: string, vKey: string) => void
}) {
  return (
    <div style={styles.row}>
      <label style={styles.label}>{group.label}</label>
      <div style={styles.seg}>
        {group.values.map(v => (
          <button
            key={v.key}
            style={v.key === selected ? styles.segBtnOn : styles.segBtn}
            onClick={() => onSelect(group.key, v.key)}
            disabled={v.disabled}
          >
            {v.label}
          </button>
        ))}
      </div>
      {group.key === 'top_size' && (
        <div style={styles.hint}>커스텀 선택 시 치수 입력 → 원자재 길이별 견적(추후)</div>
      )}
    </div>
  )
}

const btnBase: React.CSSProperties = {
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
  row: { marginBottom: 14 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  seg: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  segBtn: btnBase,
  segBtnOn: { ...btnBase, borderColor: 'var(--dark)', background: 'var(--dark)', color: '#fff', fontWeight: 600 },
  hint: { fontSize: 11, color: 'var(--muted)', marginTop: 5 },
}
