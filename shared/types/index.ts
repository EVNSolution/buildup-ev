// ── 공통 도메인 타입 (frontend / backend 공유) ──────────────────────────

export type VehicleModelCode = string;
export type OptionGroupKey = string;
export type OptionValueKey = string;

export interface Trim {
  key: string;
  label: string;
  sub_label: string;
  base_price: number;
  description: string;
}

export interface OptionValue {
  key: OptionValueKey;
  label: string;
  /** 기준가 대비 delta (0 = 포함) */
  price_delta: number;
  disabled?: boolean;
}

export interface OptionGroup {
  key: OptionGroupKey;
  label: string;
  type: 'segment' | 'select';
  values: OptionValue[];
  default_key: OptionValueKey;
}

export interface VehicleModel {
  code: VehicleModelCode;
  name: string;
  trims: Trim[];
  option_groups: OptionGroup[];
}

/** GET /models/:code/options 응답 */
export interface ModelOptionsResponse {
  model: VehicleModel;
}

// ── 고객 정보 ──────────────────────────────────────────────────────────

export type BusinessType = 'individual' | 'corporate' | 'simplified';

export interface CustomerInfo {
  name: string;
  business_type: BusinessType;
  region_code: string;
  is_small_business: boolean;
  is_old_vehicle_scrapped: boolean;
}

// ── 견적 계산 ──────────────────────────────────────────────────────────

/** POST /quotes/calculate 요청 */
export interface QuoteCalculateRequest {
  model_code: VehicleModelCode;
  trim_key: string;
  options: Record<OptionGroupKey, OptionValueKey>;
  customer?: CustomerInfo;
}

/**
 * POST /quotes/calculate 응답
 * 회귀검증: 범석환 케이스 실구매가 = ₩46,471,818
 */
export interface QuoteResult {
  supply_price: number;           // 공급가액
  vat: number;                    // 부가세
  vehicle_price: number;          // 차량가 (공급가액 + 부가세)
  subsidy_national: number;       // 국고보조금
  subsidy_local: number;          // 지방보조금
  subsidy_small_biz: number;      // 소상공인 추가 할인
  total_subsidy: number;          // 보조금 합계
  subsidy_applied_price: number;  // 보조금 적용가
  vat_refund: number;             // 부가세 환급액
  vat_refund_price: number;       // 부가세 환급 후
  registration_fee: number;       // 등록비 + 기타
  final_price: number;            // 실구매가 (= vat_refund_price + registration_fee)
}

// ── RBAC ──────────────────────────────────────────────────────────────

export type UserRole = 'sales' | 'admin' | 'conversion';

export interface AuthUser {
  id: string;
  name: string;
  role: UserRole;
}
