import type { ApiPricingBundle } from '@shared/types/index'
import { optionBreakdown } from '@shared/pricing/core'

/**
 * 메모 · 지방보조금 소진 · 프로모션 — **컨피규레이터와 견적 수정이 함께 쓰는** 조각.
 *
 * 셋 다 견적에 저장되는 값(quote.inputs)이고 금액을 바꾼다(프로모션·지방보조금).
 * 예전에는 컨피규레이터에만 있어서, 저장한 뒤에는 고칠 방법이 없었다(실제 제보).
 * 한쪽에만 칸을 두면 다른 쪽에서 못 고치는 값이 생긴다 — 그래서 한 벌로 뺐다.
 */
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
  memo: string
  onMemoChange: (v: string) => void
  localSubsidyOff: boolean
  onToggleLocalSubsidy: (v: boolean) => void
  /** 프로모션 할인액(원, VAT 포함) */
  promotionDiscount: number
  onPromotionDiscountChange: (v: number) => void
  /** 옛 방식으로 0원 처리된 옵션 이름들 — 읽기 전용 안내용 */
  zeroedLegacy: string[]
  /** 값을 고칠 수 없는 상태(서류 고정·권한 없음) */
  disabled?: boolean
}

export function QuoteExtras({
  memo, onMemoChange, localSubsidyOff, onToggleLocalSubsidy,
  promotionDiscount, onPromotionDiscountChange, zeroedLegacy, disabled = false,
}: Props) {

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

      {/*
        프로모션 — **금액 할인.**
        예전에는 옵션을 0원으로 만드는 방식이었는데, 얼마를 깎아 준 것인지 견적서에
        드러나지 않았다(옵션 단가가 0원으로 보일 뿐이다). 이제 할인액을 그대로 적는다.
        ⚠️ 옛 방식으로 만든 견적이 운영에 남아 있어 계산은 그대로 두었다 — 아래에
           읽기 전용으로 알려 준다(값이 있는데 화면에 없으면 금액이 왜 다른지 알 수 없다).
      */}
      <label style={s.label}>프로모션 할인</label>
      <div style={s.amountRow}>
        <input
          style={s.amount}
          type="text"
          inputMode="numeric"
          placeholder="0"
          disabled={disabled}
          value={promotionDiscount ? promotionDiscount.toLocaleString('ko-KR') : ''}
          onChange={e => {
            // 숫자만 남긴다 — 콤마는 우리가 다시 찍는다
            const n = Number(e.target.value.replace(/[^\d]/g, ''))
            onPromotionDiscountChange(Number.isFinite(n) ? n : 0)
          }}
        />
        <span style={s.won}>원</span>
      </div>
      <div style={s.hint}>
        {promotionDiscount > 0
          ? <>특장 가격에서 <b>{promotionDiscount.toLocaleString('ko-KR')}원</b>을 뺍니다. 견적서에 프로모션 항목으로 표시됩니다.</>
          : '비워 두면 견적서에 프로모션 항목이 나오지 않습니다.'}
      </div>

      {zeroedLegacy.length > 0 && (
        <div style={s.legacy}>
          이 견적은 <b>옛 방식(옵션 0원 처리)</b>으로 할인이 적용되어 있습니다 —
          {' '}{zeroedLegacy.join(' · ')}. 금액은 그대로 유지됩니다.
        </div>
      )}
    </>
  )
}

const s: Record<string, React.CSSProperties> = {
  label: { fontSize: 14, fontWeight: 700, color: 'var(--dark)' },
  amountRow: { display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' },
  // 금액은 오른쪽 정렬 + 고정폭 숫자 — 자릿수가 흔들리면 얼마인지 읽기 어렵다
  amount: {
    flex: '0 1 180px', minWidth: 0, textAlign: 'right',
    fontVariantNumeric: 'tabular-nums', fontWeight: 600,
  },
  won: { fontSize: 'var(--fs-label)', color: 'var(--muted)' },
  hint: { fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 'var(--lh-body)' },
  legacy: {
    fontSize: 'var(--fs-caption)', color: 'var(--body)', background: 'var(--card)',
    borderRadius: 'var(--r-sm)', padding: 'var(--sp-2) var(--sp-3)', lineHeight: 'var(--lh-body)',
  },
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
  zeroed: { color: 'var(--dark)', fontWeight: 700 },
}
