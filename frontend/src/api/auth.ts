import type { Org, User, FeatureModule, AccessControl, Role, AuthMe } from '@shared/types/index'

// ── Mock 데이터 (backend/src/data/auth-mock.ts 와 동일) ─────────────────
// TODO: 실인증 구현 시 fetch('/api/v1/auth/me') 등으로 교체

const MOCK_ORGS: Record<string, Org> = {
  ORG_HQ:     { code: 'ORG_HQ',     type: 'HQ',     name: 'EV&Solution 본사', active: true },
  ORG_DEALER1:{ code: 'ORG_DEALER1',type: 'DEALER',  name: '○○대리점',         active: false },
  ORG_MAKER1: { code: 'ORG_MAKER1', type: 'MAKER',   name: '△△특장',           active: false },
}

const MOCK_USERS: Record<string, User> = {
  'admin@evnsolution.com': {
    email: 'admin@evnsolution.com', org_code: 'ORG_HQ', role: 'ADMIN',
    name: '관리자', status: 'active', must_change_pw: false, active: true,
  },
  'sales1@evnsolution.com': {
    email: 'sales1@evnsolution.com', org_code: 'ORG_HQ', role: 'SALES',
    name: '영업담당', status: 'invited', must_change_pw: true,
    invited_by: 'admin@evnsolution.com', active: false,
  },
  'maker1@partner.com': {
    email: 'maker1@partner.com', org_code: 'ORG_MAKER1', role: 'MAKER',
    name: '특장담당', status: 'invited', must_change_pw: true,
    invited_by: 'admin@evnsolution.com', active: false,
  },
}

export const MOCK_FEATURE_MODULES: FeatureModule[] = [
  { code: 'quote.create',     name: '견적 생성',           surface: '영업',         sort_order: 1,  active: true },
  { code: 'order.convert',    name: '주문 전환',           surface: '영업',         sort_order: 2,  active: true },
  { code: 'quote.view.all',   name: '전체 진행 조회',      surface: '영업,관리자',  sort_order: 3,  active: true },
  { code: 'order.verify',     name: '주문 검증(게이트)',   surface: '관리자',       sort_order: 4,  active: true },
  { code: 'workflow.monitor', name: '주문흐름 관제',       surface: '관리자',       sort_order: 5,  active: true },
  { code: 'subsidy.manage',   name: '보조금 DB 관리',      surface: '관리자',       sort_order: 6,  active: true },
  { code: 'account.manage',   name: '계정·권한 관리',      surface: '관리자',       sort_order: 7,  active: true },
  { code: 'doc.generate',     name: '서류 자동생성',       surface: '특장사',       sort_order: 8,  active: true },
  { code: 'tuning.apply',     name: '튜닝승인 신청',       surface: '특장사',       sort_order: 9,  active: true },
  { code: 'order.receive',    name: '배정 주문·일정 조회', surface: '특장사',       sort_order: 10, active: true },
  { code: 'loadcalc.run',     name: '하중계산',            surface: '공통',         sort_order: 11, active: true },
]

let MOCK_ACCESS_CONTROL: AccessControl[] = [
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.create',     enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'order.convert',    enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.view.all',   enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'loadcalc.run',     enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.verify',     enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'workflow.monitor', enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'subsidy.manage',   enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'account.manage',   enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'loadcalc.run',     enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'doc.generate',     enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'tuning.apply',     enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'order.receive',    enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'loadcalc.run',     enabled: true },
  { subject_type: 'user', subject_ref: 'sales1@evnsolution.com', module_code: 'subsidy.manage', enabled: false, memo: '개별 차단 예시' },
]

function mergePermissions(role: Role, email: string): string[] {
  const map = new Map<string, boolean>()
  for (const ac of MOCK_ACCESS_CONTROL) {
    if (ac.subject_type === 'role' && ac.subject_ref === role) map.set(ac.module_code, ac.enabled)
  }
  for (const ac of MOCK_ACCESS_CONTROL) {
    if (ac.subject_type === 'user' && ac.subject_ref === email) map.set(ac.module_code, ac.enabled)
  }
  return [...map.entries()].filter(([, v]) => v).map(([k]) => k)
}

// ── 공개 API ───────────────────────────────────────────────────────────

/** GET /auth/me mock */
export async function fetchAuthMe(role: Role, email: string): Promise<AuthMe> {
  await new Promise(r => setTimeout(r, 100))
  const user = MOCK_USERS[email] ?? {
    email, org_code: role === 'MAKER' ? 'ORG_MAKER1' : 'ORG_HQ',
    role, name: email, status: 'active' as const, must_change_pw: false, active: true,
  }
  const org = MOCK_ORGS[user.org_code] ?? { code: user.org_code, type: 'HQ' as const, name: user.org_code, active: true }
  return { user, org, permissions: mergePermissions(role, email) }
}

/** GET /feature-modules mock */
export async function fetchFeatureModules(): Promise<FeatureModule[]> {
  await new Promise(r => setTimeout(r, 0))
  return MOCK_FEATURE_MODULES
}

/** GET /access-control mock */
export async function fetchAccessControl(): Promise<AccessControl[]> {
  await new Promise(r => setTimeout(r, 0))
  return [...MOCK_ACCESS_CONTROL]
}

/** 낙관적 업데이트 — TODO: POST /api/v1/access-control 실연결 */
export async function upsertAccessControl(entry: AccessControl): Promise<void> {
  const idx = MOCK_ACCESS_CONTROL.findIndex(
    ac => ac.subject_type === entry.subject_type &&
          ac.subject_ref  === entry.subject_ref  &&
          ac.module_code  === entry.module_code
  )
  if (idx >= 0) MOCK_ACCESS_CONTROL[idx] = entry
  else MOCK_ACCESS_CONTROL.push(entry)
}
