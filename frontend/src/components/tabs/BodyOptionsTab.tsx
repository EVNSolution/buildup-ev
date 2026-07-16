import type { ApiOptionGroup } from '@shared/types/index'
import { OptionSegmentRow } from '../OptionSegmentRow'
import { OptionToggleButton, offValueCode, fmtDelta } from '../OptionToggle'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  priceDelta: (groupCode: string, valueCode: string) => number
}

export function BodyOptionsTab({ groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, priceDelta }: Props) {
  return (
    <div>
      {groups.map(group => {
        const off = offValueCode(group)
        // 토글형 그룹(도어 추가): 단일 토글 버튼
        if (off) {
          const positives = group.values.filter(v => v.code !== off && !hiddenValueCodes.has(v.code))
          if (positives.length === 0) return null
          const disabled = disabledGroupCodes.has(group.code)
          return (
            <div key={group.code} style={styles.toggleRow}>
              {positives.map(v => {
                const selected = selections[group.code] === v.code
                return (
                  <div key={v.code} style={styles.toggleCell}>
                    <OptionToggleButton
                      label={positives.length === 1 ? group.name : v.name}
                      selected={selected}
                      delta={selected ? '' : fmtDelta(priceDelta(group.code, v.code))}
                      disabled={disabled}
                      onClick={() => onSelect(group.code, selected ? off : v.code)}
                    />
                  </div>
                )
              })}
            </div>
          )
        }
        // 일반 선택형(특장형태·탑크기·도어종류): 세그먼트
        return (
          <OptionSegmentRow
            key={group.code}
            group={group}
            selected={selections[group.code] ?? ''}
            onSelect={onSelect}
            disabled={disabledGroupCodes.has(group.code)}
            hiddenValueCodes={hiddenValueCodes}
            priceDelta={priceDelta}
          />
        )
      })}
    </div>
  )
}

const styles = {
  toggleRow: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' as const },
  toggleCell: { flex: '0 1 160px', minWidth: 140 },
}
