import type { ApiPricingBundle } from '@shared/types/index'

/**
 * option_rule 해석 — 지금 선택에 따라 무엇을 감추고 무엇을 잠글지.
 *
 * 컨피규레이터(SalesPage)와 저장된 견적의 옵션 수정 팝업이 **같은 규칙**을 써야 한다.
 * 한쪽에만 있으면 저장 후 수정에서 고를 수 없는 조합이 만들어진다.
 */

/** effect=hide → 현재 선택 기준 숨길 그룹/값 코드 */
export function computeHidden(sel: Record<string, string>, bundle: ApiPricingBundle) {
  const groups = new Set<string>()
  const values = new Set<string>()
  const selected = new Set(Object.values(sel))
  for (const rule of bundle.rules) {
    if (rule.effect !== 'hide' || !selected.has(rule.when_value)) continue
    if (rule.target_type === 'group') groups.add(rule.target_code)
    else if (rule.target_type === 'value') values.add(rule.target_code)
  }
  return { groups, values }
}

/** effect=disable → 지금 고를 수 없는 그룹 코드 */
export function computeDisabledGroups(sel: Record<string, string>, bundle: ApiPricingBundle): Set<string> {
  const disabled = new Set<string>()
  const selected = new Set(Object.values(sel))
  for (const rule of bundle.rules) {
    if (rule.effect === 'disable' && rule.target_type === 'group' && selected.has(rule.when_value)) {
      disabled.add(rule.target_code)
    }
  }
  return disabled
}

/** 숨겨진 그룹 선택 제거 + 숨겨진 값 선택 시 첫 노출값으로 대체 */
export function sanitizeSelections(sel: Record<string, string>, bundle: ApiPricingBundle): Record<string, string> {
  const { groups, values } = computeHidden(sel, bundle)
  const out = { ...sel }
  for (const g of bundle.groups) {
    if (groups.has(g.code)) { delete out[g.code]; continue }
    if (out[g.code] && values.has(out[g.code])) {
      const firstVisible = g.values.find(v => !values.has(v.code))
      if (firstVisible) out[g.code] = firstVisible.code
      else delete out[g.code]
    }
  }
  return out
}
