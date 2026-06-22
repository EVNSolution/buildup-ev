import type { Trim } from '@shared/types/index'

interface Props {
  trims: Trim[]
  selectedTrim: string
  onSelectTrim: (key: string) => void
}

export function VehicleOptionsTab({ trims, selectedTrim, onSelectTrim }: Props) {
  const active = trims.find(t => t.key === selectedTrim) ?? trims[0]

  return (
    <div>
      <div style={styles.row}>
        <label style={styles.label}>차종</label>
        <select>
          <option>PV5 오픈베드</option>
          <option disabled>STEGO-K (예정)</option>
        </select>
      </div>

      <div style={styles.row}>
        <label style={styles.label}>트림 선택</label>
        <div style={styles.trimGrid}>
          {trims.map(trim => (
            <div
              key={trim.key}
              style={trim.key === selectedTrim ? styles.trimCardOn : styles.trimCard}
              onClick={() => onSelectTrim(trim.key)}
            >
              <div style={styles.trimImg}>이미지</div>
              <div style={styles.trimName}>{trim.label}</div>
              <div style={styles.trimSub}>{trim.sub_label}</div>
            </div>
          ))}
        </div>
        {active && (
          <div style={styles.trimDetail} dangerouslySetInnerHTML={{ __html: active.description }} />
        )}
      </div>
    </div>
  )
}

const cardBase: React.CSSProperties = {
  flex: 1,
  border: '1.5px solid var(--line)',
  borderRadius: 12,
  padding: 11,
  cursor: 'pointer',
  textAlign: 'center',
  transition: '.12s',
}

const styles = {
  row: { marginBottom: 14 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  trimGrid: { display: 'flex', gap: 10 },
  trimCard: cardBase,
  trimCardOn: {
    ...cardBase,
    borderColor: 'var(--lime)',
    boxShadow: '0 0 0 2px rgba(200,210,0,.25)',
  },
  trimImg: {
    height: 70,
    background: 'repeating-linear-gradient(45deg,#f0f2f4,#f0f2f4 8px,#e9ecef 8px,#e9ecef 16px)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#b3b9c0',
    fontSize: 11,
  },
  trimName: { fontWeight: 700, fontSize: 14, marginTop: 9, color: 'var(--dark)' },
  trimSub: { fontSize: 11, color: 'var(--muted)' },
  trimDetail: {
    marginTop: 12,
    background: 'var(--card)',
    borderRadius: 10,
    padding: 12,
    fontSize: 12.5,
    lineHeight: 1.55,
  },
}
