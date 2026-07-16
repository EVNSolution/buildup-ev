import type { ApiOptionGroup } from '@shared/types/index'
import { OptionSegmentRow } from '../OptionSegmentRow'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  priceDelta: (groupCode: string, valueCode: string) => number
}

export function InteriorOptionsTab({ groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, priceDelta }: Props) {
  return (
    <div>
      {groups.map(group => (
        <OptionSegmentRow
          key={group.code}
          group={group}
          selected={selections[group.code] ?? ''}
          onSelect={onSelect}
          disabled={disabledGroupCodes.has(group.code)}
          hiddenValueCodes={hiddenValueCodes}
          priceDelta={priceDelta}
        />
      ))}
    </div>
  )
}
