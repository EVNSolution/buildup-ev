import { quoteKind, QUOTE_KIND_LABEL } from '../lib/quoteCustomer'
import type { ApiQuote } from '@shared/types/index'

/**
 * 견적 종류 표시 — **열어 보지 않고** 특장만·차량만을 가린다.
 *
 * 견적서를 하나씩 열어야 무슨 견적인지 알 수 있으면, 목록에서 고를 수가 없다.
 * 금액만 봐서는 구분이 안 된다 — 특장만 2천만원과 차량만 3천만원이 나란히 있으면
 * 어느 쪽이 무엇인지 알 길이 없다.
 *
 * ⚠️ **일반 견적(차량+특장)에는 아무것도 붙이지 않는다.** 대부분이 그것이라 다 붙이면
 *    표가 배지로 뒤덮여 정작 다른 건이 묻힌다. 「보통과 다른 것」만 표시한다.
 */
export function QuoteKindTag({ quote }: { quote: ApiQuote }) {
  const kind = quoteKind(quote)
  const label = QUOTE_KIND_LABEL[kind]
  if (!label) return null
  return <span style={kind === 'body' ? s.body : s.vehicle}>{label}</span>
}

const base: React.CSSProperties = {
  display: 'inline-block', marginLeft: 6, verticalAlign: '1px',
  fontSize: 'var(--fs-caption)', fontWeight: 700, lineHeight: 1.5,
  padding: '0 6px', borderRadius: 3, whiteSpace: 'nowrap',
}
const s: Record<string, React.CSSProperties> = {
  /* 두 종류를 **다른 색**으로 — 같은 회색이면 붙어 있어도 구분이 안 된다 */
  body:    { ...base, color: 'var(--dark)', background: 'var(--lime-bg)', border: '0.5px solid var(--lime)' },
  vehicle: { ...base, color: 'var(--dark)', background: 'var(--card)', border: '0.5px solid var(--line-firm)' },
}
