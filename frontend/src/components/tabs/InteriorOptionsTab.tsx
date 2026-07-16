import type { ApiOptionGroup } from '@shared/types/index'
import { OptionToggleButton, offValueCode, fmtDelta } from '../OptionToggle'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  priceDelta: (groupCode: string, valueCode: string) => number
}

/**
 * 내부 옵션 = 2열 토글 그리드. 각 옵션(스포일러·온도기록계 등)은 단일 토글 버튼.
 * 격벽처럼 종류가 여러 개인 그룹은 종류별 토글이 상호배타(한 그룹당 1개만 선택).
 */
export function InteriorOptionsTab({ groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, priceDelta }: Props) {
  const cells: { key: string; groupCode: string; offCode: string; valueCode: string; label: string; disabled: boolean }[] = []

  for (const g of groups) {
    const off = offValueCode(g)
    if (!off) continue
    const fullPositives = g.values.filter(v => v.code !== off)
    const positives = fullPositives.filter(v => !hiddenValueCodes.has(v.code))
    for (const v of positives) {
      cells.push({
        key: v.code,
        groupCode: g.code,
        offCode: off,
        valueCode: v.code,
        // 종류가 하나면 그룹명(스포일러), 여럿이면 종류명(그물망/이동식)
        label: fullPositives.length === 1 ? g.name : v.name,
        disabled: disabledGroupCodes.has(g.code),
      })
    }
  }

  if (cells.length === 0) return <div style={styles.empty}>선택 가능한 옵션이 없습니다.</div>

  return (
    <div style={styles.grid}>
      {cells.map(c => {
        const selected = selections[c.groupCode] === c.valueCode
        return (
          <OptionToggleButton
            key={c.key}
            label={c.label}
            selected={selected}
            delta={selected ? '' : fmtDelta(priceDelta(c.groupCode, c.valueCode))}
            disabled={c.disabled}
            onClick={() => onSelect(c.groupCode, selected ? c.offCode : c.valueCode)}
          />
        )
      })}
    </div>
  )
}

const styles = {
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 },
  empty: { fontSize: 12.5, color: 'var(--muted)', padding: '8px 2px' },
}
