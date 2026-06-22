export type {
  BizType,
  DoorPrices,
  TaxConfig,
  PricingParams,
  PricingOk,
  PricingUnsupported,
  PricingResult,
} from './types.js';

import type { PricingParams, PricingResult } from './types.js';

/**
 * 영업 견적 실구매가 계산 코어.
 *
 * 순수 함수 — DB 쿼리 없음. 호출자(API 라우트)가 DB에서 단가·보조금·세율을 읽어 주입.
 * 회귀: TRIM_PLUS+저상+슬라이딩+온도O+그물망+소상공인+경기남양주 = ₩46,471,818
 */
export function calcPrice(p: PricingParams): PricingResult {
  if (p.bodytype_code !== 'BODY_REEFER') {
    return { status: 'unsupported', reason: '내장탑 가격 미정(TBD)' };
  }

  // 공급가액 = Σ선택옵션 단가 + 도어가
  const option_sum = p.selected_value_codes.reduce(
    (s, c) => s + (p.option_prices[c] ?? 0), 0,
  );
  const door_price =
    (p.door.selected_price - p.door.base_swing_price) +
    (p.door.has_extra ? p.door.selected_price : 0);
  const supply_price = option_sum + door_price;

  // 부가세 · 차량가
  const vat = p.customer.biz_type === 'simplified'
    ? 0
    : Math.floor(supply_price * 0.1);
  const vehicle_price = supply_price + vat;

  // 보조금
  const sub_national = p.subsidy_national;
  const sub_local = p.customer.biz_type === 'corporation' ? 0 : p.subsidy_local;
  const sub_sosang = p.customer.is_sosang
    ? Math.floor(sub_national * p.subsidy_sosang_rate)
    : 0;
  const sub_scrap = 0;
  const sub_total = sub_national + sub_local + sub_sosang + sub_scrap;
  const applied_price = vehicle_price - sub_total;
  const vat_refunded_price = applied_price - vat;

  // 등록비
  const trim_price = p.option_prices[p.trim_code] ?? 0;
  const delivery_excl = Math.floor(p.tax.delivery_fee * 10 / 11);
  const reg_acq_tax = Math.floor((trim_price + delivery_excl) * p.tax.acq_tax_rate);
  const reg_acq_tax_relief = -Math.min(reg_acq_tax, p.tax.acq_tax_relief_cap);
  const reg_special_acq_tax = Math.floor(
    (supply_price - trim_price) * p.tax.special_acq_tax_rate,
  );
  const reg_cost =
    reg_acq_tax + reg_acq_tax_relief + reg_special_acq_tax +
    p.tax.stamp + p.tax.plate + p.tax.reg_agency;

  // 기타 · 실구매가
  const etc_cost = p.tax.delivery_fee + p.tax.etc_fee;
  const real_price = vat_refunded_price + reg_cost + etc_cost;

  return {
    status: 'ok',
    supply_price, vat, vehicle_price,
    subsidy_national: sub_national,
    subsidy_local: sub_local,
    subsidy_sosang: sub_sosang,
    subsidy_scrap: sub_scrap,
    subsidy_total: sub_total,
    applied_price,
    vat_refunded_price,
    reg_acq_tax,
    reg_acq_tax_relief,
    reg_special_acq_tax,
    reg_stamp: p.tax.stamp,
    reg_plate: p.tax.plate,
    reg_agency: p.tax.reg_agency,
    reg_cost,
    delivery_fee: p.tax.delivery_fee,
    etc_fee: p.tax.etc_fee,
    etc_cost,
    real_price,
  };
}
