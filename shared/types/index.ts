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

/** individual=개인사업자 · corporate=법인사업자 · simplified=간이과세자 · consumer=일반구매자(부가세 환급 불가) */
export type BusinessType = 'individual' | 'corporate' | 'simplified' | 'consumer';

export interface CustomerInfo {
  /** 법인사업자면 **상호**, 그 외에는 **성명**. 계약서 `{{buyer_name}}` 으로 나간다. */
  name: string;
  /**
   * 대표이사 — **법인사업자일 때만** 입력받는다. 계약서 매수인 서명블록의
   * 「회사명 / 대표이사」 줄(`{{ceo_name}}`)에 인쇄된다. 그 외 구분에서는 공란.
   */
  ceo_name?: string;
  email?: string;
  phone?: string;
  business_type: BusinessType;
  region_code: string;
  address?: string;                    // 세부주소 — 계약서·견적서·구조변경 서류에 사용
  is_small_business: boolean;          // 소상공인
  has_transport_license: boolean;      // 화물자동차 운송사업허가증
  /**
   * 경유차 폐차여부 — 총견적서 '입력 시트' C5. 'none'|'keep'|'scrap'.
   * 국고보조금을 깎는 것은 'keep'(유지)뿐이다(엑셀 D15). 'scrap'(폐차)은 금액 영향 없음.
   */
  diesel_status?: DieselStatusCode;
  /** @deprecated diesel_status 로 대체. 옛 견적 복원용으로만 남긴다(= 'keep' 여부). */
  is_diesel_conversion: boolean;
  has_biz_plate?: boolean;             // 영업용 번호판 보유 → 취득세 4% (총견적서)
  tax_exempt_type?: string;            // 면세구분('일반인' 등) — 공채할인 판정 (총견적서)

  // ── 계약서 전용 입력(견적 저장 단계에서 함께 받는다) ──
  // 전부 선택 입력 — 비워두면 계약서에 공란으로 나간다.
  contract_party?: string;             // 계약처
  buyer_agent?: string;                // 대리인(위임장 필수)
  buyer_relation?: string;             // 관계
  buyer_regno?: string;                // 생년월일 / 사업자번호
  buyer_tel?: string;                  // 유선 전화번호
}

/** shared/pricing 의 DieselStatus 와 같은 값 — 타입 패키지 간 순환 import 를 피하려고 여기 다시 둔다. */
export type DieselStatusCode = 'none' | 'keep' | 'scrap';

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
  tax: ApiTaxConfig;
  /** tax_config 전체(param_key→value) — 총견적서 계산용(커머셜할인·공채·계약금·의무보험 등) */
  tax_all?: Record<string, number>;
  subsidy_national: ApiSubsidyNational | null;
}

// ── 견적 / 주문 API 응답 타입 ──────────────────────────────────────────────

/**
 * 견적 상태 6단계 (+ 만료).
 *   임시저장 → 견적확정 → 계약완료(전자서명 완료) → 배정완료 → 주문진행 → 완료
 * DB enum(QuoteStatus)과 값이 1:1로 같아야 한다.
 */
export type QuoteStatus =
  | 'draft' | 'confirmed' | 'contracted' | 'assigned' | 'ordered' | 'completed' | 'expired';

export interface ApiQuote {
  id: number;
  quote_no: string | null;
  model_code: string;
  status: QuoteStatus;
  supply_price: number;
  final_price: number;
  sales_user_id: string | null;
  org_id: string | null;
  customer_id: number | null;
  created_at: string;
  customer: { id: number; name: string; email?: string | null; phone?: string | null; address?: string | null } | null;
  /** 견적별 입력 스냅샷(사업자구분·보조금조건·계약서 입력 등). 고객정보 수정 팝업이 되읽는다. */
  inputs?: Record<string, unknown> | null;
  /**
   * 서류 고정 시각. 전자서명 발송이 성공하면 그 시점 문서를 정본으로 굳힌다.
   * 값이 있으면 견적 입력·고객정보를 **더 이상 고칠 수 없다**(백엔드 409 DOCS_FROZEN).
   */
  docs_frozen_at?: string | null;
  order: { maker_org: { code: string; name: string } | null } | null;
  /** 참고용 메일(견적서·계약서 첨부) 마지막 발송 — 전자서명과는 별개 채널 */
  docs_emailed_at?: string | null;
  docs_emailed_to?: string | null;
  /** 전자서명 현황(최신 1건). 미발송이면 null */
  contract?: { status: string; sent_at: string | null; completed_at: string | null } | null;
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

/** 구조변경 서류 바인딩용 차량 정보 (특장사 입력, order.vehicle_info) */
export interface OrderVehicleInfo {
  제원관리번호?: string;
  등록번호?: string;
  차대번호?: string;
  형식코드?: string;
  모델연도?: string | number;
  소유자성명?: string;
  소유자주소?: string;
  최초등록일?: string;
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
  vehicle_info?: OrderVehicleInfo | null;
}
