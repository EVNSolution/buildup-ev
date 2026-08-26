export type {
  BizType,
  TaxConfig,
  SubsidyConfig,
  CustomerInfo,
  PricingParams,
  PricingOk,
  PricingUnsupported,
  PricingResult,
} from './types.js';

import type { PricingParams, PricingResult } from './types.js';

export {
  assembleOptionSum, optionBreakdown, valueUnitPrice, doorAddUnitPrice,
  TAKBAE_RATE, DIESEL_CONVERSION_SUBSIDY,
} from './assemble.js';

export {
  calcQuote, pmt, DEFAULT_TAX_EXEMPT_TYPE,
  dieselDeducts, toDieselStatus, DIESEL_STATUS_LABEL,
} from './quote.js';
export type { QuoteParams, QuoteResult, DieselStatus } from './quote.js';
// 특장만 견적 — 차량에 딸린 입력을 한 곳에서 0으로 만든다
export { bodyOnlyParams } from './body-only.js';
export { vehicleOnlyParams } from './vehicle-only.js';

// 가격바가 보여줄 파생값(계산은 여기 한 곳에만 — 화면·앱이 공유한다)
export { priceBarView } from './pricebar.js';
export type { PriceBarView } from './pricebar.js';

/**
 * 영업 견적 실구매가 계산 코어 — STEGO-K1 견적서_Ver1.21 로직 재현.
 *
 * 순수 함수 — DB 쿼리 없음. 호출자(API 라우트)가 옵션DB 기준 단가·보조금·세율을 조립해 주입.
 * 회귀(범석환): 베이직+냉동저상+울릉군+소상공인+택배 = ₩32,013,860.
 *
 * 견적서 대응:
 *   공급가액 D24 = trim + option_sum
 *   부가세   D25 = 간이과세자 0, 아니면 공급/10
 *   차량가격 D26 = D24 + D25
 *   보조금   D27~D31 → D32
 *   보조금적용① D33 = D26 − D32,  부가세환급후② D34 = D33 − D25
 *   차량취득세 H13 = ROUNDDOWN((trim + 탁송료)/1.1 × 세율, 10원)
 *   특장취득세 H16 = option_sum × 특장세율
 *   총등록비 ③ = 취득세 + 감면 + 특장취득세 + 증지대 + 번호판대 + 등록대행료
 *   총기타 ④ = 탁송료 + 등록부가수수료
 *   실구매가 = ② + ③ + ④
 */
export function calcPrice(p: PricingParams): PricingResult {
  const { customer: c, tax: t, subsidy: s } = p;

  // 공급가액 → 부가세 → 차량가격
  const supply_price = p.trim_price + p.option_sum;
  const vat = c.biz_type === 'simplified' ? 0 : Math.round(supply_price / 10);
  const vehicle_price = supply_price + vat;

  // 보조금 (국고 / 지방 / 소상공인 / 경유차전환 / 택배)
  const subsidy_national = s.national;
  const subsidy_local = c.biz_type === 'corporation' ? 0 : s.local;
  const subsidy_sosang = c.is_sosang ? Math.floor(subsidy_national * s.sosang_rate) : 0;
  const subsidy_diesel =
    c.biz_type === 'corporation' && c.diesel_conversion ? s.diesel_conversion : 0;
  const subsidy_takbae =
    c.has_transport_license && c.biz_type === 'individual'
      ? Math.floor(subsidy_national * s.takbae_rate)
      : 0;
  const subsidy_total =
    subsidy_national + subsidy_local + subsidy_sosang + subsidy_diesel + subsidy_takbae;

  const applied_price = vehicle_price - subsidy_total;
  // 일반구매자(비사업자)는 부가세 환급 불가 → 환급액 0 (차감하지 않음)
  const vat_refunded_price = c.biz_type === 'consumer' ? applied_price : applied_price - vat;

  // 등록비 ③ (의무보험료는 현재 합산 제외)
  const reg_acq_tax =
    Math.floor(((p.trim_price + t.delivery_fee) / 1.1) * t.acq_tax_rate / 10) * 10;
  const reg_acq_tax_relief = -Math.min(reg_acq_tax, t.acq_tax_relief_cap);
  const reg_special_acq_tax = Math.floor(p.option_sum * t.special_acq_tax_rate);
  const reg_cost =
    reg_acq_tax + reg_acq_tax_relief + reg_special_acq_tax + t.stamp + t.plate + t.reg_agency;

  // 기타비 ④ · 실구매가
  const etc_cost = t.delivery_fee + t.etc_fee;
  const real_price = vat_refunded_price + reg_cost + etc_cost;

  return {
    status: 'ok',
    supply_price, vat, vehicle_price,
    subsidy_national, subsidy_local, subsidy_sosang, subsidy_takbae, subsidy_diesel, subsidy_total,
    applied_price, vat_refunded_price,
    reg_acq_tax, reg_acq_tax_relief, reg_special_acq_tax,
    reg_stamp: t.stamp, reg_plate: t.plate, reg_agency: t.reg_agency, reg_cost,
    delivery_fee: t.delivery_fee, etc_fee: t.etc_fee, etc_cost,
    real_price,
  };
}
