import { OPTION_CARD } from '../styles/optionCard'
import type { ApiOptionGroup } from '@shared/types/index'

interface Props {
  group: ApiOptionGroup
  selected: string
  onSelect: (code: string, val: string) => void
  disabled?: boolean
  hiddenValueCodes: Set<string>
  priceDelta: (groupCode: string, valueCode: string) => number
}

function fmtDelta(d: number): string {
  if (!d) return ''
  return d > 0 ? `+${d.toLocaleString()}` : `−${Math.abs(d).toLocaleString()}`
}

/** 옵션 한 그룹의 세그먼트 버튼 행. 숨김값 제외 + 버튼별 증감액 표기. */
export function OptionSegmentRow({ group, selected, onSelect, disabled = false, hiddenValueCodes, priceDelta }: Props) {
  const values = group.values.filter(v => !hiddenValueCodes.has(v.code))
  if (values.length === 0) return null

  return (
    <div style={{ ...styles.row, opacity: disabled ? 0.4 : 1 }}>
      <label style={styles.label}>
        {group.name}
        {disabled && <span style={styles.disabledBadge}> 비활성</span>}
      </label>
      <div style={styles.seg}>
        {values.map(v => {
          const on = v.code === selected
          const delta = on ? '' : fmtDelta(priceDelta(group.code, v.code))
          return (
            <button
              key={v.code}
              style={on ? styles.segBtnOn : styles.segBtn}
              onClick={() => !disabled && onSelect(group.code, v.code)}
              disabled={disabled}
            >
              <span>{v.name}</span>
              {delta && <span style={on ? styles.deltaOn : styles.delta}>{delta}</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const btnBase = {
  flex: 1,
  minWidth: 54,
  minHeight: 'var(--h-control)',
  fontSize: 'var(--fs-body)',
  color: 'var(--body)',
  display: 'flex',
  flexDirection: 'column' as const,
  alignItems: 'center',
  justifyContent: 'center' as const,
  gap: 2,
}

const styles = {
  row: { marginBottom: 16, transition: 'opacity .15s' },
  label: { display: 'block', fontSize: 13, color: 'var(--muted)', marginBottom: 7 },
  disabledBadge: { fontSize: 13, color: 'var(--warn)', marginLeft: 4 },
  seg: { display: 'flex', gap: 6, flexWrap: 'wrap' as const },
  segBtn: { ...btnBase, ...OPTION_CARD.base },
  segBtnOn: { ...btnBase, ...OPTION_CARD.on },
  delta: { fontSize: 'var(--fs-label)', color: 'var(--muted)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'] },
  deltaOn: { fontSize: 'var(--fs-label)', color: 'var(--muted)', fontWeight: 'var(--fw-label)' as React.CSSProperties['fontWeight'] },
}
