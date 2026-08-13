import { useState } from 'react'
import type { ApiPricingBundle } from '@shared/types/index'
import { optionBreakdown } from '@shared/pricing/core'

/**
 * 메모 · 지방보조금 소진 · 프로모션 — **컨피규레이터와 견적 수정이 함께 쓰는** 조각.
 *
 * 셋 다 견적에 저장되는 값(quote.inputs)이고 금액을 바꾼다(프로모션·지방보조금).
 * 예전에는 컨피규레이터에만 있어서, 저장한 뒤에는 고칠 방법이 없었다(실제 제보).
 * 한쪽에만 칸을 두면 다른 쪽에서 못 고치는 값이 생긴다 — 그래서 한 벌로 뺐다.
 */
const wonVat = (supply: number) => '₩' + Math.round(supply * 1.1).toLocaleString('ko-KR')

/**
 * 재량할인 대상 — 가격이 있는 **선택 옵션**만.
 * 필수 옵션(탑 등 기본 사양)은 빼되, 도어종류는 필수여도 대상이다(목록엔 '기본도어').
 */
const PROMO_EXCEPTIONS: Record<string, string> = { DOORTYPE: '기본도어' }

export interface ZeroableOption {
  group: string
  supply: number
  label: string
  value: string
}

export function zeroableOptions(
  bundle: ApiPricingBundle,
  selections: Record<string, string>,
  optionPrices: Record<string, number>,
): ZeroableOption[] {
  const breakdown = optionBreakdown(selections, (c: string) => optionPrices[c] ?? 0)
  return (Object.entries(breakdown) as [string, number][])
    .filter(([, v]) => v > 0)
    .map(([group, supply]) => {
      const g = bundle.groups.find(x => x.code === group)
      const val = g?.values.find(v => v.code === selections[group])
      const exception = PROMO_EXCEPTIONS[group]
      return {
        group, supply,
        required: (g?.required ?? false) && !exception,
        label: exception ?? g?.name ?? group,
        value: val?.name ?? '',
      }
    })
    .filter(z => !z.required)
    .map(({ group, supply, label, value }) => ({ group, supply, label, value }))
}

interface Props {
  bundle: ApiPricingBundle
  selections: Record<string, string>
  optionPrices: Record<string, number>
  memo: string
  onMemoChange: (v: string) => void
  localSubsidyOff: boolean
  onToggleLocalSubsidy: (v: boolean) => void
  promotionZeroed: Set<string>
  onTogglePromotion: (groupCode: string) => void
  /** 값을 고칠 수 없는 상태(서류 고정·권한 없음) */
  disabled?: boolean
}

export function QuoteExtras({
  bundle, selections, optionPrices,
  memo, onMemoChange, localSubsidyOff, onToggleLocalSubsidy,
  promotionZeroed, onTogglePromotion, disabled = false,
}: Props) {
  // 프로모션 목록은 접어 둔다 — 대부분의 견적에서 쓰지 않는다.
  // 이미 할인이 걸려 있으면 펼친 채로 연다(무엇이 0원인지 모르고 지나치면 안 된다).
  const [showPromo, setShowPromo] = useState(promotionZeroed.size > 0)
  const zeroable = zeroableOptions(bundle, selections, optionPrices)

  return (
    <>
      <label style={s.label}>메모 / 안내문</label>
      <textarea
        style={s.memo} rows={3} value={memo} disabled={disabled}
        onChange={e => onMemoChange(e.target.value)}
      />

      <label style={s.toggle}>
        <input
          type="checkbox" checked={localSubsidyOff} disabled={disabled} style={s.cbox}
          onChange={e => onToggleLocalSubsidy(e.target.checked)}
        />
        지방보조금 소진
      </label>

      <label style={s.toggle}>
        <input type="checkbox" checked={showPromo} style={s.cbox} onChange={e => setShowPromo(e.target.checked)} />
        프로모션
      </label>
      {showPromo && (
        <div style={s.list}>
          {zeroable.length === 0
            ? <div style={s.empty}>할인 가능한 옵션이 없습니다.</div>
            : zeroable.map(z => (
              <label key={z.group} style={s.item}>
                <input
                  type="checkbox" checked={promotionZeroed.has(z.group)} disabled={disabled} style={s.cbox}
                  onChange={() => onTogglePromotion(z.group)}
                />
                <span style={s.name}>{z.label}{z.value ? ` · ${z.value}` : ''}</span>
                <span style={promotionZeroed.has(z.group) ? s.zeroed : s.price}>
                  {promotionZeroed.has(z.group) ? '0원' : wonVat(z.supply)}
                </span>
              </label>
            ))
          }
        </div>
      )}
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  label: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  memo: {
    width: '100%', boxSizing: 'border-box', fontSize: 'var(--fs-body)',
    resize: 'vertical', fontFamily: 'inherit',
  },
  toggle: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 14, cursor: 'pointer', fontWeight: 600, color: 'var(--dark)' },
  cbox: { width: 15, height: 15, accentColor: 'var(--lime)' },
  list: { display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0 2px 22px' },
  empty: { fontSize: 13, color: 'var(--muted)' },
  item: { display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, cursor: 'pointer' },
  name: { flex: 1, color: 'var(--dark)' },
  price: { color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' },
  zeroed: { color: '#2e7d32', fontWeight: 700 },
}
