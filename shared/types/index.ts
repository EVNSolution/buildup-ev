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
  address?: string;                    // 주소(주소 검색으로 채운 도로명주소)
  address_detail?: string;             // 동·호수 등 상세주소
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

export const ALL_ROLES: readonly Role[] = ['SALES', 'ADMIN', 'MAKER'];

export interface User {
  email: string;
  org_code: string;
  /**
   * 주 역할 — 로그인 직후 여는 화면과 배지의 기준. **하나뿐**이다.
   * 겸직은 아래 extra_roles 로 더한다(주 역할을 배열로 바꾸면 "어디로 보낼지"가 사라진다).
   */
  role: Role;
  /**
   * 겸직 — 주 역할 외에 더 가진 역할.
   *
   * 관리자가 영업 화면까지 쓰거나, 관리자가 특장 화면까지 봐야 하는 일이 실제로 있다.
   * 계정을 두 개 만들면 견적·주문이 다른 사람 것으로 쌓이므로 **한 계정에 역할을 더한다**.
   */
  extra_roles?: Role[];
  name: string;
  phone?: string;
  status: UserStatus;
  must_change_pw: boolean;
  invited_by?: string;
  active: boolean;
  // DEV: master surface switcher — true일 때 헤더에 surface 전환 토글 표시
  is_master?: boolean;
}

/**
 * 이 계정이 가진 역할 전부 — 주 역할이 늘 맨 앞이다(중복은 지운다).
 *
 * 화면 전환 토글·권한 합산·라우팅이 모두 이 목록 하나를 본다. 각자 [role, ...extra] 을
 * 다시 만들면 한 곳만 고쳐졌을 때 화면과 권한이 어긋난다.
 * 마스터 계정은 전 역할을 가진 것으로 본다(테스트용 계정 — 서버도 같은 판단을 한다).
 */
export function rolesOf(u: { role: Role; extra_roles?: Role[] | null; is_master?: boolean }): Role[] {
  if (u.is_master) return [...ALL_ROLES];
  return [...new Set<Role>([u.role, ...(u.extra_roles ?? [])])];
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
  /**
   * 담당 영업이 배정을 **수락한** 시각. null = 수락 대기(또는 배정 전).
   * 공개 문의는 배정만으로 담당이 정해졌다고 보지 않는다 — 영업이 직접 받아야 한다.
   */
  sales_accepted_at?: string | null;
  /** 'sales' = 영업 작성 / 'public' = 고객이 공개 화면에서 직접 접수한 문의 */
  source?: string;
  customer_id: number | null;
  created_at: string;
  customer: { id: number; name: string; email?: string | null; phone?: string | null; address?: string | null; address_detail?: string | null } | null;
  /** 견적별 입력 스냅샷(사업자구분·보조금조건·계약서 입력 등). 고객정보 수정 팝업이 되읽는다. */
  inputs?: Record<string, unknown> | null;
  /** 선택한 옵션(그룹코드→값코드). 수정 팝업의 「옵션」 탭이 되읽는다. */
  selections?: Record<string, string> | null;
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
  /** signing_method: EMAIL·KAKAO = 전자서명 / PAPER = 종이로 체결하고 스캔본을 등록한 건 */
  contract?: { status: string; sent_at: string | null; completed_at: string | null; signing_method?: string } | null;
  /** 숨김 — 지우지 않고 화면에서만 감춘 견적(임시저장만 가능). null 이면 보인다. */
  hidden_at?: string | null;
  hidden_by?: string | null;
}

/** 목록에서 「지금 뭘 해야 하나」를 보여주기 위한 요약. 상세를 열지 않아도 알 수 있게. */
export interface ApiOrderStepSummary {
  done: number;
  total: number;
  /**
   * **끝낸 단계 이름들**(카탈로그 순서) — 목록에 적는 요약은 이것으로만 쓴다.
   *
   * ⚠️ 「지금 할 수 있는 단계」(`open`)를 요약 자리에 적으면 읽는 사람이 **끝냈다**고
   *    읽는다. 아무것도 완료 안 된 주문에 「차량 도착 · 특장 제작 완료」가 떠서
   *    실제로 그렇게 오해했다.
   */
  done_labels: string[];
  /** 가장 나중에 끝낸 단계. 하나도 없으면 null */
  last_done: string | null;
  /** 지금 손댈 수 있는 단계 이름들 — **정렬·강조용**이다. 요약 문구로 쓰지 말 것 */
  open: string[];
  /** 하나라도 기준 일수를 넘게 멈춰 있나 */
  stalled: boolean;
}

export interface ApiOrder {
  id: number;
  quote_id: number;
  maker_org_id: string | null;
  assigned_at: string | null;
  /** 단계 진행 요약 — 옛 `status`(6단계 문자열)를 대신한다 */
  steps?: ApiOrderStepSummary;
  /** 특장사가 수락하며 약속한 납기일 (YYYY-MM-DD). 수락 전에는 null */
  delivery_due?: string | null;
  /** 발주 수락 시각 */
  accepted_at?: string | null;
  /** 발주서 비고 — 이 주문만의 요청사항. 있으면 목록에 「커스텀」이 뜬다 */
  remark?: string | null;
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
  maker_org_id: string | null;
  assigned_at: string | null;
  created_at: string;
  model_code: string;
  customer_name: string | null;
  options: ApiOrderOption[];
  documents: ApiDocument[];
  vehicle_info?: OrderVehicleInfo | null;
  /** 발주서 비고 — 이 주문만의 요청사항 */
  remark?: string | null;
  /** 배정된 특장사 이름 — 발주서를 다시 그리는 데 필요하다 */
  maker_org_name?: string | null;
  delivery_due?: string | null;
}
