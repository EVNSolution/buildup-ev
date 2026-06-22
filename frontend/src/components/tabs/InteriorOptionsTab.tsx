import type { OptionGroup } from '@shared/types/index'

interface Props {
  groups: OptionGroup[]
  selections: Record<string, string>
  onSelect: (groupKey: string, valueKey: string) => void
}

const INTERIOR_KEYS = ['thermometer', 'partition']

export function InteriorOptionsTab({ groups, selections, onSelect }: Props) {
  const interiorGroups = groups.filter(g => INTERIOR_KEYS.includes(g.key))

  return (
    <div>
      {interiorGroups.map(group => (
        <SegmentRow key={group.key} group={group} selected={selections[group.key] ?? group.default_key} onSelect={onSelect} />
      ))}
      <div style={styles.hint}>
        내장탑에서는 온도기록계 비활성 등 옵션 종속규칙 적용(예정)
      </div>
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
  hint: { fontSize: 11, color: 'var(--muted)', marginTop: 8 },
}
