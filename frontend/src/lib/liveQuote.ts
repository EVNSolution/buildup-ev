import type { ApiPricingBundle, CustomerInfo } from '@shared/types/index'
import type { QuoteResult } from '@shared/pricing/core'
import { calcQuote, assembleOptionSum, TAKBAE_RATE, DEFAULT_TAX_EXEMPT_TYPE } from '@shared/pricing/core'
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
  /** 영업 재량 — 공개 화면은 넘기지 않는다(빈 값) */
  promotionZeroed?: Set<string>
  localSubsidyOff?: boolean
  /** 영업 화면의 저장된 고객(영업용 번호판·면세구분). 공개 화면은 없음 */
  customer?: Pick<CustomerInfo, 'has_biz_plate' | 'tax_exempt_type'> | null
}

export function buildLiveTotal(args: LiveTotalArgs): QuoteResult | null {
  const { bundle, selections, subsidyInputs, subsidyLocal, subsidyReady } = args
  const promotionZeroed = args.promotionZeroed ?? new Set<string>()
  const localSubsidyOff = args.localSubsidyOff ?? false
  const customer = args.customer ?? null


  if (!bundle || Object.keys(selections).length === 0) return null
  const price = (code: string) => bundle.option_prices[code] ?? 0
  const { trim_price, option_sum } = assembleOptionSum(selections, price, [...promotionZeroed])
  const t = bundle.tax_all ?? {}
  const biz = mapBizType(subsidyInputs.business_type)
  return calcQuote({
    car_price: Math.round(trim_price * 1.1),
    delivery_fee: t['delivery_fee'] ?? bundle.tax.delivery_fee,
    commercial_discount: t['commercial_discount'] ?? 0,
    partnership_rate: t['partnership_rate'] ?? 0.01,
    subsidy_national: bundle.subsidy_national?.amount ?? 0,
    diesel_conversion: subsidyInputs.diesel_status === 'keep',   // 엑셀 D15 — 「유지」만 −50만
    diesel_deduction: t['diesel_deduction'] ?? 500_000,
    subsidy_local: subsidyReady ? subsidyLocal : 0,
    is_corporation: biz === 'corporation',
    local_subsidy_off: localSubsidyOff,
    no_vat_refund: biz === 'consumer',
    is_sosang: subsidyInputs.is_small_business ?? false,
    sosang_rate: bundle.subsidy_national?.sosang_rate ?? 0.3,
    is_individual: biz === 'individual',
    has_transport_license: subsidyInputs.has_transport_license ?? false,
    takbae_rate: TAKBAE_RATE,
    body_price: Math.round(option_sum * 1.1),
    promotion: 0,
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
  })
}
