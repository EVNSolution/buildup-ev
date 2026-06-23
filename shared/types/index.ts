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

// ── RBAC / 인증·권한 (클러스터 F) ────────────────────────────────────

/** F1. 조직 유형 */
export type OrgType = 'HQ' | 'DEALER' | 'MAKER';

export interface Org {
  code: string;
  type: OrgType;
  name: string;
  biz_no?: string;
  active: boolean;
}

/** F2. 역할 — DB ENUM 그대로 대문자 */
export type Role = 'SALES' | 'ADMIN' | 'MAKER';

export type UserStatus = 'active' | 'invited' | 'suspended';

export interface User {
  email: string;
  org_code: string;
  role: Role;
  name: string;
  phone?: string;
  status: UserStatus;
  must_change_pw: boolean;
  invited_by?: string;
  active: boolean;
  // DEV: master surface switcher — true일 때 헤더에 surface 전환 토글 표시
  is_master?: boolean;
}

/** F3. 기능 모듈 카탈로그 */
export interface FeatureModule {
  code: string;
  name: string;
  /** 콤마 구분 (예: '영업,관리자') */
  surface: string;
  sort_order: number;
  active: boolean;
}

/** F4. 권한 토글 (역할 기본값 + 계정 override) */
export type SubjectType = 'role' | 'user';

export interface AccessControl {
  id?: number;
  subject_type: SubjectType;
  /** 역할: 'SALES'|'ADMIN'|'MAKER' / 계정: email */
  subject_ref: string;
  module_code: string;
  enabled: boolean;
  memo?: string;
}

/** GET /auth/me 응답 */
export interface AuthMe {
  user: User;
  org: Org;
  /** 활성 모듈코드 배열 (역할 기본 + 계정 override 머지 결과) */
  permissions: string[];
}

/** @deprecated UserRole → Role 로 변경. 하위 호환용 alias. */
export type UserRole = Role;

export interface AuthUser {
  id: string;     // email
  name: string;
  role: Role;
  org_code: string;
}

// ── 영업 API 응답 타입 (GET /models/:code/pricing-bundle) ─────────────────

export interface ApiOptionValue {
  code: string;
  name: string;
  vivar_code: string | null;
  sort_order: number;
}

export interface ApiOptionGroup {
  code: string;
  category: string | null;
  name: string;
  select_type: string;
  required: boolean;
  values: ApiOptionValue[];
}

export interface ApiOptionRule {
  code: string;
  when_value: string;
  effect: string;
  target_type: string;
  target_code: string;
  memo?: string | null;
}

export interface ApiDoorPrice {
  top: string;
  doortype: string;
  unit_price: number;
}

export interface ApiTaxConfig {
  acq_tax_rate: number;
  special_acq_tax_rate: number;
  acq_tax_relief_cap: number;
  stamp: number;
  plate: number;
  reg_agency: number;
  delivery_fee: number;
  etc_fee: number;
}

export interface ApiSubsidyNational {
  amount: number;
  sosang_rate: number;
}

export interface ApiPricingBundle {
  groups: ApiOptionGroup[];
  rules: ApiOptionRule[];
  option_prices: Record<string, number>;
  door_unit_prices: ApiDoorPrice[];
  tax: ApiTaxConfig;
  subsidy_national: ApiSubsidyNational | null;
}

// ── 견적 / 주문 API 응답 타입 ──────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'confirmed' | 'ordered' | 'expired';

export interface ApiQuote {
  id: number;
  model_code: string;
  status: QuoteStatus;
  supply_price: number;
  final_price: number;
  sales_user_id: string | null;
  org_id: string | null;
  customer_id: number | null;
  created_at: string;
  customer: { id: number; name: string } | null;
}

export interface ApiOrder {
  id: number;
  quote_id: number;
  status: string;
  maker_org_id: string | null;
  assigned_at: string | null;
  created_at: string;
  quote: {
    model_code: string;
    supply_price: number;
    final_price: number;
    status: string;
    customer_id: number | null;
    customer: { id: number; name: string } | null;
  };
  maker_org: { code: string; name: string } | null;
}

export interface ApiOrderOption {
  id: number;
  group_code: string;
  group_name: string;
  value_code: string;
  value_name: string;
}

export interface ApiDocument {
  id: number;
  name: string;
  status: 'pending' | 'done' | 'na';
}

/** MAKER용 주문 상세 — 가격·영업 정보 제외, 제작에 필요한 사양·서류만 */
export interface ApiOrderMakerDetail {
  id: number;
  quote_id: number;
  status: string;
  maker_org_id: string | null;
  assigned_at: string | null;
  created_at: string;
  model_code: string;
  customer_name: string | null;
  options: ApiOrderOption[];
  documents: ApiDocument[];
}
