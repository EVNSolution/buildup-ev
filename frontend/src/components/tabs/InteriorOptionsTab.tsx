import type { ApiOptionGroup } from '@shared/types/index'
import { valueUnitPrice } from '@shared/pricing/core'
import { offValueCode } from '../OptionToggle'
import { OptRow, PriceBtn } from '../OptionRow'
import { CustomOptionRows } from '../CustomOptionRows'
import type { CustomOptionDraft } from '@shared/pricing/core'

interface Props {
  groups: ApiOptionGroup[]
  selections: Record<string, string>
  onSelect: (groupCode: string, valueCode: string) => void
  disabledGroupCodes: Set<string>
  hiddenValueCodes: Set<string>
  optionPrices: Record<string, number>
  /**
   * 커스텀 특장 옵션 — 단가표에 없는 사양. 넘기지 않으면 칸 자체를 띄우지 않는다
   * (공개 화면처럼 영업이 아닌 자리).
   */
  customOptions?: CustomOptionDraft[]
  onCustomOptionsChange?: (next: CustomOptionDraft[]) => void
}

/**
 * 내부 옵션 = 격벽·온도기록계·스포일러 라벨 줄. 격벽은 종류(그물망·이동식) 상호배타 토글,
 * 온도기록계·스포일러는 '추가' 토글. 각 버튼에 부가세 포함 절대가격 표시.
 */
export function InteriorOptionsTab({
  groups, selections, onSelect, disabledGroupCodes, hiddenValueCodes, optionPrices,
  customOptions, onCustomOptionsChange,
}: Props) {
  const price = (c: string) => optionPrices[c] ?? 0
  // 격벽 먼저
  const ordered = [...groups].sort((a, b) => (a.code === 'PARTITION' ? 0 : 1) - (b.code === 'PARTITION' ? 0 : 1))

  return (
    <div>
      {ordered.map(group => {
        const off = offValueCode(group)
        if (!off) return null
        const disabled = disabledGroupCodes.has(group.code)
        const fullPos = group.values.filter(v => v.code !== off)
        const positives = fullPos.filter(v => !hiddenValueCodes.has(v.code))
        if (positives.length === 0) return null

        return (
          <OptRow key={group.code} label={group.name} required={group.required}>
            {positives.map(v => {
              const selected = selections[group.code] === v.code
              // 종류가 하나면 '추가'(온도·스포일러), 여럿이면 종류명(그물망·이동식)
              const label = fullPos.length === 1 ? '추가' : v.name
              return (
                <PriceBtn
                  key={v.code}
                  label={label}
                  price={valueUnitPrice(group.code, v.code, selections, price)}
                  selected={selected}
                  disabled={disabled}
                  onClick={() => onSelect(group.code, selected ? off : v.code)}
                />
              )
            })}
          </OptRow>
        )
      })}

      {/* 단가표에 없는 사양 — 목록 맨 아래, 「+」는 그 아래 왼쪽에 */}
      {customOptions && onCustomOptionsChange && (
        <CustomOptionRows rows={customOptions} onChange={onCustomOptionsChange} />
      )}
    </div>
  )
}
