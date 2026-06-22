import type { Org, User, FeatureModule, AccessControl, Role } from '@buildup-ev/shared/types';

// ── Mock 데이터 (seed CSV 기반) ─────────────────────────────────────────
// TODO: DB 연결 시 이 파일 전체를 DB 쿼리로 교체

export const MOCK_ORGS: Record<string, Org> = {
  ORG_HQ:     { code: 'ORG_HQ',     type: 'HQ',     name: 'EV&Solution 본사',      active: true },
  ORG_SALES1: { code: 'ORG_SALES1', type: 'DEALER', name: 'EV&Solution 직영영업팀', active: true },
  ORG_DEALER1:{ code: 'ORG_DEALER1',type: 'DEALER', name: '○○대리점',               active: false },
  ORG_MAKER1: { code: 'ORG_MAKER1', type: 'MAKER',  name: '△△특장',                active: true },
};

export const MOCK_USERS: Record<string, User> = {
  'admin@evnsolution.com': {
    email: 'admin@evnsolution.com',
    org_code: 'ORG_HQ',
    role: 'ADMIN',
    name: '관리자',
    status: 'active',
    must_change_pw: false,
    active: true,
  },
  'sales1@evnsolution.com': {
    email: 'sales1@evnsolution.com',
    org_code: 'ORG_SALES1',
    role: 'SALES',
    name: '영업담당',
    status: 'active',
    must_change_pw: false,
    invited_by: 'admin@evnsolution.com',
    active: true,
  },
  'maker1@partner.com': {
    email: 'maker1@partner.com',
    org_code: 'ORG_MAKER1',
    role: 'MAKER',
    name: '특장담당',
    status: 'active',
    must_change_pw: false,
    invited_by: 'admin@evnsolution.com',
    active: true,
  },
};

export const MOCK_FEATURE_MODULES: FeatureModule[] = [
  { code: 'quote.create',    name: '견적 생성',           surface: '영업',         sort_order: 1,  active: true },
  { code: 'order.convert',   name: '주문 전환',           surface: '영업',         sort_order: 2,  active: true },
  { code: 'quote.view.all',  name: '전체 진행 조회',      surface: '영업,관리자',  sort_order: 3,  active: true },
  { code: 'order.verify',    name: '주문 검증(게이트)',    surface: '관리자',       sort_order: 4,  active: true },
  { code: 'workflow.monitor',name: '주문흐름 관제',        surface: '관리자',       sort_order: 5,  active: true },
  { code: 'subsidy.manage',  name: '보조금 DB 관리',      surface: '관리자',       sort_order: 6,  active: true },
  { code: 'account.manage',  name: '계정·권한 관리',      surface: '관리자',       sort_order: 7,  active: true },
  { code: 'doc.generate',    name: '서류 자동생성',        surface: '특장사',       sort_order: 8,  active: true },
  { code: 'tuning.apply',    name: '튜닝승인 신청',        surface: '특장사',       sort_order: 9,  active: true },
  { code: 'order.receive',   name: '배정 주문·일정 조회', surface: '특장사',       sort_order: 10, active: true },
  { code: 'loadcalc.run',    name: '하중계산',            surface: '공통',         sort_order: 11, active: true },
];

/** access_control seed (F4 템플릿 v0.4 그대로) */
export const MOCK_ACCESS_CONTROL: AccessControl[] = [
  // 역할 기본값
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.create',    enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'order.convert',   enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.view.all',  enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'loadcalc.run',    enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.verify',    enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'workflow.monitor',enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'subsidy.manage',  enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'account.manage',  enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'loadcalc.run',    enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'doc.generate',    enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'tuning.apply',    enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'order.receive',   enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'loadcalc.run',    enabled: true },
  // 계정 override 예시 — sales1의 subsidy.manage 개별 차단
  { subject_type: 'user', subject_ref: 'sales1@evnsolution.com', module_code: 'subsidy.manage', enabled: false, memo: '개별 차단 예시' },
];

/**
 * 역할 기본값 + 계정 override 머지.
 * 우선순위: 계정 override > 역할 기본값.
 * 활성(enabled=true) 모듈코드 배열 반환.
 */
export function mergePermissions(role: Role, email: string): string[] {
  const permMap = new Map<string, boolean>();

  // 1단계: 역할 기본값
  for (const ac of MOCK_ACCESS_CONTROL) {
    if (ac.subject_type === 'role' && ac.subject_ref === role) {
      permMap.set(ac.module_code, ac.enabled);
    }
  }

  // 2단계: 계정 override (덮어씀)
  for (const ac of MOCK_ACCESS_CONTROL) {
    if (ac.subject_type === 'user' && ac.subject_ref === email) {
      permMap.set(ac.module_code, ac.enabled);
    }
  }

  return Array.from(permMap.entries())
    .filter(([, enabled]) => enabled)
    .map(([code]) => code);
}
