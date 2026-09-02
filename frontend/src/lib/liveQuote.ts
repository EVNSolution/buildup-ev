import type { ApiPricingBundle, CustomerInfo } from '@shared/types/index'
import type { QuoteResult } from '@shared/pricing/core'
import { calcQuote, assembleOptionSum, bodyOnlyParams, vehicleOnlyParams, noVatRefund, resolveCarPrice, TAKBAE_RATE, DEFAULT_TAX_EXEMPT_TYPE } from '@shared/pricing/core'
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
  /** 영업 화면의 저장된 고객(영업용 번호판·면세구분). 공개 화면은 없음 */
  customer?: Pick<CustomerInfo, 'has_biz_plate' | 'tax_exempt_type'> | null
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
  const { trim_price, option_sum } = assembleOptionSum(selections, price, [...promotionZeroed])
  const t = bundle.tax_all ?? {}
  const biz = mapBizType(subsidyInputs.business_type)
  const params = {
    car_price: resolveCarPrice(trim_price, carPriceOverride),
    delivery_fee: t['delivery_fee'] ?? bundle.tax.delivery_fee,
    commercial_discount: t['commercial_discount'] ?? 0,
    partnership_rate: t['partnership_rate'] ?? 0.01,
    subsidy_national: bundle.subsidy_national?.amount ?? 0,
    diesel_conversion: subsidyInputs.diesel_status === 'keep',   // 엑셀 D15 — 「유지」만 −50만
    diesel_deduction: t['diesel_deduction'] ?? 500_000,
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
    car_deposit: t['car_deposit'] ?? 100_000,
    body_deposit: t['body_deposit'] ?? 400_000,
    down_payment_rate: 0,     // 선수금·할부는 견적서 생성 단계 입력
    installment_months: 0,
    installment_rate: 0,
    has_biz_plate: !!customer?.has_biz_plate,
    acq_tax_rate_biz: t['acq_tax_rate_biz'] ?? 0.04,
    acq_tax_rate_normal: t['acq_tax_rate'] ?? bundle.tax.acq_tax_rate,
    acq_tax_relief: t['acq_tax_relief_cap'] ?? bundle.tax.acq_tax_relief_cap,
    special_acq_tax_rate: t['special_acq_tax_rate'] ?? bundle.tax.special_acq_tax_rate,
    is_seoul_normal: (customer?.tax_exempt_type ?? DEFAULT_TAX_EXEMPT_TYPE) === '일반인' && subsidyInputs.region_code === '서울특별시',
    bond_discount: t['bond_discount'] ?? 0,
    plate: t['plate'] ?? bundle.tax.plate,
    stamp: t['stamp'] ?? bundle.tax.stamp,
    insurance: t['insurance'] ?? 2_800,
    reg_agency: t['reg_agency'] ?? bundle.tax.reg_agency,
    etc_fee: t['etc_fee'] ?? bundle.tax.etc_fee,
    // 구조변경 비용 — tax_config 값. 백엔드(buildQuoteParams)와 같은 기본값을 써야
    // 화면 가격과 견적서 PDF 가 어긋나지 않는다.
    structure_change_fee: t['structure_change_fee'] ?? 400_000,
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
