import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice, doorAddUnitPrice } from '@shared/pricing/core'
import { OptRow, PriceBtn } from '../OptionRow'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
}

const ORDER = ['BODYTYPE', 'TOP', 'DOORTYPE', 'DOORADD']

export function BodyOptionsTab({ groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, optionPrices }: Props) {
  const price = (c: string) => optionPrices[c] ?? 0
  const byCode: Record<string, ApiOptionGroup> = Object.fromEntries(groups.map(g => [g.code, g]))
  const ordered = ORDER.map(c => byCode[c]).filter(Boolean) as ApiOptionGroup[]
  for (const g of groups) if (!ORDER.includes(g.code)) ordered.push(g)

  return (
    <div>
      {ordered.map(group => {
        const disabled = disabledGroupCodes.has(group.code)

        // 도어추가: 도어종류 3버튼, 현재 도어종류와 같은 것만 선택 가능(토글)
        if (group.code === 'DOORADD') {
          const doorGroup = byCode['DOORTYPE']
          if (!doorGroup) return null
          const doorTypes = doorGroup.values.filter(v => !hiddenValueCodes.has(v.code))
          const currentDoor = selections['DOORTYPE'] ?? ''
          const added = selections['DOORADD'] === 'ADD_DRIVER'
          return (
            <OptRow key="DOORADD" label={group.name} required={group.required}>
              {doorTypes.map(dt => {
                const isCurrent = dt.code === currentDoor
                return (
                  <PriceBtn
                    key={dt.code}
                    label={dt.name}
                    price={doorAddUnitPrice(dt.code, selections, price)}
                    selected={added && isCurrent}
                    disabled={disabled || !isCurrent}
                    onClick={() => onSelect('DOORADD', added ? 'ADD_NONE' : 'ADD_DRIVER')}
                  />
                )
              })}
            </OptRow>
          )
        }

        // 세그먼트(단일 선택): 특장형태·탑크기·도어종류
        const showPrice = group.code !== 'BODYTYPE' // 탑 가격은 탑크기 버튼에 표시
        const values = group.values.filter(v => !hiddenValueCodes.has(v.code))
        return (
          <OptRow key={group.code} label={group.name} required={group.required}>
            {values.map(v => (
              <PriceBtn
                key={v.code}
                label={v.name}
                price={showPrice ? valueUnitPrice(group.code, v.code, selections, price) : undefined}
                selected={selections[group.code] === v.code}
                disabled={disabled}
                onClick={() => onSelect(group.code, v.code)}
              />
            ))}
          </OptRow>
        )
      })}
    </div>
  )
}
