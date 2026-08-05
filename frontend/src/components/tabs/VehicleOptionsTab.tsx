import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice } from '@shared/pricing/core'
import { fmtWonVat } from '../OptionRow'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
}

export function VehicleOptionsTab({ groups, selections, onSelect, hiddenValueCodes, optionPrices }: Props) {
  const price = (c: string) => optionPrices[c] ?? 0
  return (
    <div>
      <div style={styles.row}>
        <label style={styles.label}>차종</label>
        <select>
          <option>STEGO-K</option>
        </select>
      </div>

      {groups.map(group => (
        <div key={group.code} style={styles.row}>
          <label style={styles.label}>{group.name}</label>
          <div style={styles.cardGrid}>
            {group.values.filter(v => !hiddenValueCodes.has(v.code)).map(v => {
              const selected = selections[group.code] === v.code
              return (
                <div
                  key={v.code}
                  style={selected ? styles.cardOn : styles.card}
                  onClick={() => onSelect(group.code, v.code)}
                >
                  <div style={styles.cardImg}>이미지</div>
                  <div style={styles.cardName}>{v.name}</div>
                  <div style={styles.cardDelta}>{fmtWonVat(valueUnitPrice(group.code, v.code, selections, price))}</div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const cardBase = {
  flex: 1,
  border: '1.5px solid var(--line)',
  borderRadius: 12,
  padding: 11,
  cursor: 'pointer',
  textAlign: 'center' as const,
  transition: '.12s',
}

const styles = {
  row: { marginBottom: 14 },
  label: { display: 'block', fontSize: 11.5, color: 'var(--muted)', marginBottom: 6 },
  cardGrid: { display: 'flex', gap: 10 },
  card: cardBase,
  cardOn: {
    ...cardBase,
    borderColor: 'var(--lime)',
    boxShadow: '0 0 0 2px rgba(200,210,0,.25)',
  },
  cardImg: {
    height: 70,
    background: 'repeating-linear-gradient(45deg,#f0f2f4,#f0f2f4 8px,#e9ecef 8px,#e9ecef 16px)',
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#b3b9c0',
    fontSize: 11,
  },
  cardName: { fontWeight: 700, fontSize: 14, marginTop: 9, color: 'var(--dark)' },
  cardCode: { fontSize: 10, color: 'var(--muted)', marginTop: 2 },
  cardDelta: { fontSize: 11, color: 'var(--muted)', marginTop: 2, fontWeight: 600 },
}
