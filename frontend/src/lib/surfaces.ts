import type { Role, User } from '@shared/types/index'
import { rolesOf } from '@shared/types/index'

/**
 * 화면(surface) ↔ 역할 — **한 곳에서만** 정한다.
 *
 * 로그인 후 어디로 보낼지(LoginPage·ChangePasswordPage), 헤더 전환 토글에 무엇을 띄울지,
 * 주소를 직접 쳤을 때 들여보낼지(RequireAuth)가 모두 이 표를 본다.
 * 예전엔 ROLE_HOME 이 두 파일에 복사돼 있었다 — 한쪽만 고치면 화면과 권한이 어긋난다.
 */
export interface Surface {
  path: string
  label: string
  role: Role
}

export const SURFACES: readonly Surface[] = [
  { path: '/sales', label: '영업', role: 'SALES' },
  { path: '/admin', label: '관리', role: 'ADMIN' },
  { path: '/maker', label: '특장', role: 'MAKER' },
]

/** 이 역할이 로그인 직후 여는 화면. */
export function homeFor(role: Role): string {
  return SURFACES.find(s => s.role === role)?.path ?? '/sales'
}

/**
 * 이 계정이 쓸 수 있는 화면들 — 겸직 포함.
 * 순서는 위 SURFACES 순서를 따른다(가진 역할이 뭐든 영업·관리·특장 순으로 보인다).
 */
export function surfacesFor(user: Pick<User, 'role' | 'extra_roles' | 'is_master'>): Surface[] {
  const roles = rolesOf(user)
  return SURFACES.filter(s => roles.includes(s.role))
}

/** 이 경로에 들어갈 수 있는가(주소를 직접 친 경우까지). */
export function canUseSurface(user: Pick<User, 'role' | 'extra_roles' | 'is_master'>, path: string): boolean {
  const surface = SURFACES.find(s => s.path === path)
  // 표에 없는 경로(비밀번호 변경 등)는 역할로 가르지 않는다
  if (!surface) return true
  return rolesOf(user).includes(surface.role)
}
