export type BizType = 'individual' | 'corporation' | 'simplified';

/** 등록비·기타비 상수 (tax_config) */
export interface TaxConfig {
  acq_tax_rate: number;          // 차량 취득세율 (0.05)
  special_acq_tax_rate: number;  // 특장 취득세율 (0.02)
  acq_tax_relief_cap: number;    // 차량 취득세 감면 상한 (1,400,000)
  stamp: number;                 // 증지대
  plate: number;                 // 번호판대
  reg_agency: number;            // 등록대행료
  delivery_fee: number;          // 탁송료
  etc_fee: number;               // 등록부가수수료
  // 의무보험료(2,800)는 견적서_Ver1.21 총등록비 합산에서 제외 상태 — 확정 시 추가.
}

/** 보조금 구성 (국고·지방·비율) */
export interface SubsidyConfig {
  national: number;              // 국고보조금
  local: number;                 // 지방보조금 (지역별)
  sosang_rate: number;           // 소상공인 할인율 (국고 대비, 0.3)
  takbae_rate: number;           // 택배업 보조금율 (국고 대비, 0.1)
  diesel_conversion: number;     // 경유차 전환 보조금 (음수, 예: -500,000)
}

export interface CustomerInfo {
  biz_type: BizType;
  is_sosang: boolean;                // 소상공인 (O/X)
  has_transport_license: boolean;    // 화물자동차 운송사업허가증 (O/X)
  diesel_conversion: boolean;        // 경유차 유지 후 전기차 전환
}

/**
 * 견적 계산 입력. 옵션 단가·도어가는 호출자(라우트)가 DB/옵션DB 기준으로 조립해 주입.
 * - trim_price: 차량 트림가 (견적서 D13)
 * - option_sum: 특장 옵션 합계 = 탑 + 스포일러 + 도어옵션 + 도어추가 + 온도기록계 + 격벽 (D15:D20)
 */
export interface PricingParams {
  trim_price: number;
  option_sum: number;
  subsidy: SubsidyConfig;
  tax: TaxConfig;
  customer: CustomerInfo;
}

export interface PricingOk {
  status: 'ok';
  supply_price: number;        // 공급가액 = trim + option_sum
  vat: number;                 // 부가세 (환급가능)
  vehicle_price: number;       // 차량가격 (VAT 포함)
  subsidy_national: number;
  subsidy_local: number;
  subsidy_sosang: number;
  subsidy_takbae: number;      // 택배업 보조금
  subsidy_diesel: number;      // 경유차 전환 (음수)
  subsidy_total: number;
  applied_price: number;       // 보조금 적용 ①
  vat_refunded_price: number;  // 부가세 환급 후 ②
  reg_acq_tax: number;         // 차량 취득세
  reg_acq_tax_relief: number;  // 차량 취득세 감면 (음수)
  reg_special_acq_tax: number; // 특장 취득세
  reg_stamp: number;
  reg_plate: number;
  reg_agency: number;
  reg_cost: number;            // 총 등록비 ③
  delivery_fee: number;
  etc_fee: number;
  etc_cost: number;            // 총 기타비 ④
  real_price: number;          // 실구매가 = ② + ③ + ④
}

/** 입력 데이터 부족 등으로 계산 불가 (라우트에서 사용) */
export interface PricingUnsupported {
  status: 'unsupported';
  reason: string;
}

export type PricingResult = PricingOk | PricingUnsupported;
