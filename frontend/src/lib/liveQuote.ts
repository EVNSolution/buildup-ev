import type { ApiPricingBundle, CustomerInfo } from '@shared/types/index'
import type { QuoteResult } from '@shared/pricing/core'
import { calcQuote, assembleOptionSum, makePriceLookup, groupOfPriceCode, bodyOnlyParams, vehicleOnlyParams, noVatRefund, resolveCarPrice, TAKBAE_RATE, DEFAULT_TAX_EXEMPT_TYPE, rowState } from '@shared/pricing/core'
import type { CustomOption, CustomOptionDraft } from '@shared/pricing/core'

/**
 * 화면 계산에 넣을 커스텀 옵션 — **다 적은 줄만** 센다.
 * 적는 도중(이름만 적힌 상태)에 금액이 움직이면 숫자가 널뛰어 보인다.
 * 저장 판정은 서버·저장 버튼이 `checkCustomOptions` 로 따로 한다.
 */
export function liveCustomOptions(rows: readonly CustomOptionDraft[] | undefined): CustomOption[] {
  return (rows ?? [])
    .filter(r => rowState(r) === 'ok')
    .map(r => ({ name: r.name.trim(), price: r.price as number }))
}
import { mapBizType } from './quoteCustomer'
import type { SubsidyInputs } from '../components/SubsidyInputs'

/**
 * 화면에 보이는 금액 — **총견적서 기준**(견적서 PDF 와 같은 규칙).
 *
 * 영업 화면과 공개 화면이 **이 함수 하나**를 쓴다. 각자 계산하면 같은 사양인데 화면마다
 * 다른 금액이 나오고, 고객이 공개 화면에서 본 값과 영업이 뽑아 준 견적서가 어긋난다.
 *
 * ⚠️ 여기서 새 규칙을 만들지 않는다. 값을 모아 calcQuote(shared)에 넘길 뿐이다.
 *    세율·부대비용의 기본값은 백엔드 buildQuoteParams 와 **같은 값**이어야 한다.
 */
export interface LiveTotalArgs {
  bundle: ApiPricingBundle | null
  selections: Record<string, string>
  subsidyInputs: SubsidyInputs
  /** 지역으로 조회한 지방보조금(원). 미선택이면 0 */
  subsidyLocal: number
  /** 보조금 산정 조건이 갖춰졌는가(법인이거나 지역 선택됨) */
  subsidyReady: boolean
  /** 옵션 무상제공(0원 처리)할 그룹 — 공개 화면은 넘기지 않는다 */
  promotionZeroed?: Set<string>
  /** 프로모션 할인액(원, VAT 포함). 특장 가격에서 뺀다 */
  promotionDiscount?: number
  localSubsidyOff?: boolean
  /** 특장만 견적 — 고객이 차를 이미 갖고 있어 차량 금액·보조금이 전부 빠진다 */
  bodyOnly?: boolean
  /** 차량만 견적 — 특장을 장착하지 않는다. 특장만과 동시에 참일 수 없다. */
  vehicleOnly?: boolean
  /**
   * 영업이 적어 넣은 차량 가격(VAT 포함). 비었으면 `null` — 트림 단가를 쓴다.
   * ⚠️ `undefined` 가 아니라 `null` 로 비운다는 점이 중요하다(resolveCarPrice 주석 참고).
   */
  carPriceOverride?: number | null
  /**
   * 커스텀 특장 옵션 — 단가표에 없는 사양을 영업이 직접 적은 줄.
   * **반쪽만 적힌 줄은 계산에서 뺀다** — 저장은 어차피 막히고, 그 사이에 금액이
   * 오르내리면 다 적기도 전에 숫자가 널뛴다. 다 적는 순간 반영된다.
   */
  customOptions?: readonly CustomOptionDraft[]
  /** 영업 화면의 저장된 고객(영업용 번호판·면세구분). 공개 화면은 없음 */
  customer?: Pick<CustomerInfo, 'has_biz_plate' | 'tax_exempt_type'> | null
}

/**
 * **단가가 정해지지 않은 사양** — 있으면 그 문항에서 고른 값의 코드들.
 *
 * ⚠️ 0원과 다른 말이다. 0원은 0으로 정해 둔 것이고(계약상 무상 등), 여기서 걸리는 것은
 *    단가표에 **행 자체가 없는** 사양이다. 예전엔 둘을 구분하지 않아 미닫이처럼 값이 없는
 *    사양이 **0원으로 계산돼 고객에게 나갔다.**
 *
 * 서버도 저장할 때 같은 것을 본다(`UnpricedSelectionError`). 화면이 모르면
 * 「금액은 보이는데 저장만 거부되는」 견적이 되므로 **여기서 먼저** 말해 준다.
 */
export function unpricedSelections(
  bundle: ApiPricingBundle | null | undefined,
  selections: Record<string, string>,
): string[] {
  if (!bundle || Object.keys(selections).length === 0) return []
  const { price, missing } = makePriceLookup(bundle.option_prices)
  // 조회를 실제로 시켜 봐야 어떤 복합코드가 필요한지 알 수 있다(고르지 않은 문항은 조회조차 없다)
  assembleOptionSum(selections, price, [], [])
  const picked: string[] = []
  for (const code of missing) {
    const v = selections[groupOfPriceCode(code)]
    if (v && !picked.includes(v)) picked.push(v)
  }
  return picked
}

export function buildLiveTotal(args: LiveTotalArgs): QuoteResult | null {
  const { bundle, selections, subsidyInputs, subsidyLocal, subsidyReady } = args
  const promotionZeroed = args.promotionZeroed ?? new Set<string>()
  const promotionDiscount = Math.max(0, Math.round(args.promotionDiscount ?? 0))
  const localSubsidyOff = args.localSubsidyOff ?? false
  const customer = args.customer ?? null
  // 특장만 견적에는 차량이 없다 — 직접 입력값이 남아 있어도 무시한다
  const carPriceOverride = args.bodyOnly ? null : (args.carPriceOverride ?? null)


  if (!bundle || Object.keys(selections).length === 0) return null
  const price = (code: string) => bundle.option_prices[code] ?? 0
  const { trim_price, option_sum } = assembleOptionSum(
    selections, price, [...promotionZeroed], liveCustomOptions(args.customOptions),
  )
  const tax = bundle.tax_all ?? {}
  const biz = mapBizType(subsidyInputs.business_type)
  const params = {
    car_price: resolveCarPrice(trim_price, carPriceOverride),
    delivery_fee: tax['delivery_fee'] ?? bundle.tax.delivery_fee,
    commercial_discount: tax['commercial_discount'] ?? 0,
    partnership_rate: tax['partnership_rate'] ?? 0.01,
    subsidy_national: bundle.subsidy_national?.amount ?? 0,
    diesel_conversion: subsidyInputs.diesel_status === 'keep',   // 엑셀 D15 — 「유지」만 −50만
    diesel_deduction: tax['diesel_deduction'] ?? 500_000,
    subsidy_local: subsidyReady ? subsidyLocal : 0,
    is_corporation: biz === 'corporation',
    local_subsidy_off: localSubsidyOff,
    no_vat_refund: noVatRefund(biz),
    is_sosang: subsidyInputs.is_small_business ?? false,
    sosang_rate: bundle.subsidy_national?.sosang_rate ?? 0.3,
    is_individual: biz === 'individual',
    has_transport_license: subsidyInputs.has_transport_license ?? false,
    takbae_rate: TAKBAE_RATE,
    body_price: Math.round(option_sum * 1.1),
    // I18 — 서버(quote-calc)와 같은 규칙: 음수·특장가격 초과를 막는다
    promotion: Math.min(promotionDiscount, Math.round(option_sum * 1.1)),
    car_deposit: tax['car_deposit'] ?? 100_000,
    body_deposit: tax['body_deposit'] ?? 400_000,
    down_payment_rate: 0,     // 선수금·할부는 견적서 생성 단계 입력
    installment_months: 0,
    installment_rate: 0,
    has_biz_plate: !!customer?.has_biz_plate,
    acq_tax_rate_biz: tax['acq_tax_rate_biz'] ?? 0.04,
    acq_tax_rate_normal: tax['acq_tax_rate'] ?? bundle.tax.acq_tax_rate,
    acq_tax_relief: tax['acq_tax_relief_cap'] ?? bundle.tax.acq_tax_relief_cap,
    special_acq_tax_rate: tax['special_acq_tax_rate'] ?? bundle.tax.special_acq_tax_rate,
    is_seoul_normal: (customer?.tax_exempt_type ?? DEFAULT_TAX_EXEMPT_TYPE) === '일반인' && subsidyInputs.region_code === '서울특별시',
    bond_discount: tax['bond_discount'] ?? 0,
    plate: tax['plate'] ?? bundle.tax.plate,
    stamp: tax['stamp'] ?? bundle.tax.stamp,
    insurance: tax['insurance'] ?? 2_800,
    reg_agency: tax['reg_agency'] ?? bundle.tax.reg_agency,
    etc_fee: tax['etc_fee'] ?? bundle.tax.etc_fee,
    // 구조변경 비용 — tax_config 값. 백엔드(buildQuoteParams)와 같은 기본값을 써야
    // 화면 가격과 견적서 PDF 가 어긋나지 않는다.
    structure_change_fee: tax['structure_change_fee'] ?? 400_000,
  }
  /*
   * 특장만이면 차량에 딸린 입력을 통째로 0으로 만든다 — **백엔드와 같은 함수**를 쓴다.
   * 각자 0을 채우면 한쪽만 빠뜨렸을 때 화면과 견적서가 다른 금액을 말한다.
   */
  // 화면과 서버가 **같은 변환**을 쓴다 — 갈리면 미리보기와 견적서 금액이 달라진다
  if (args.bodyOnly) return calcQuote(bodyOnlyParams(params))
  if (args.vehicleOnly) return calcQuote(vehicleOnlyParams(params))
  return calcQuote(params)
}
