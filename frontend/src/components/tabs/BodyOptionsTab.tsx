import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice, doorAddUnitPrice } from '@shared/pricing/core'
import { OptRow, PriceBtn } from '../OptionRow'
import { V2lConfirm } from '../BodyOnlyPanel'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
  /**
   * 특장만 견적이면 냉동을 고를 때 **V2L 확인**을 받는다.
   * 우리가 파는 차(기본·플러스)는 모두 V2L 이 있어 확인할 것이 없다 — 고객 차일 때만이다.
   */
  v2lNeeded?: boolean
  v2lConfirmed?: boolean
  onV2lConfirmedChange?: (v: boolean) => void
}

const ORDER = ['BODYTYPE', 'TOP', 'DOORTYPE', 'DOORADD']

export function BodyOptionsTab({
  groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, optionPrices,
  v2lNeeded = false, v2lConfirmed = false, onV2lConfirmedChange,
}: Props) {
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
        /*
         * 냉동을 고르는 **그 자리**에서 V2L 을 확인받는다. 다른 탭에 두면
         * 무엇 때문에 묻는지 알기 어렵고, 고르고 나서 잊는다.
         */
        const askV2l = group.code === 'BODYTYPE' && v2lNeeded && selections['BODYTYPE'] === 'BODY_REEFER'
        return (
          <div key={group.code}>
            <OptRow label={group.name} required={group.required}>
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
            {askV2l && onV2lConfirmedChange && (
              <V2lConfirm confirmed={v2lConfirmed} onChange={onV2lConfirmedChange} />
            )}
          </div>
        )
      })}
    </div>
  )
}
