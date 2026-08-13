import type { Role } from '@buildup-ev/shared/types';

interface AcRecord {
  subject_type: string;
  subject_ref: string;
  module_code: string;
  enabled: boolean;
}

/**
 * 이 계정이 실제로 쓸 수 있는 모듈 코드.
 *
 * 역할 기본값 → 계정 override 순으로 덮는다(계정 토글이 마지막 말이다).
 *
 * ⚠️ 역할이 여럿이면 **합집합**이다 — 관리+영업을 가진 계정에서 영업이 켠 모듈을
 *    관리가 끄고 있다고 막으면, 영업 화면을 쓰라고 준 역할이 아무 일도 못 한다.
 *    역할 하나가 켜 두었으면 켜진 것으로 본다. 특정 계정만 막으려면 계정 override 를 쓴다.
 */
export function mergePermissions(roles: Role | Role[], email: string, acs: AcRecord[]): string[] {
  const list = Array.isArray(roles) ? roles : [roles];
  const map = new Map<string, boolean>();
  for (const ac of acs) {
    if (ac.subject_type !== 'role' || !list.includes(ac.subject_ref as Role)) continue;
    // 한 역할이라도 켜 두었으면 켜진 것 — 끈 역할이 뒤에 와도 되돌리지 않는다
    if (ac.enabled || !map.has(ac.module_code)) map.set(ac.module_code, ac.enabled);
  }
  for (const ac of acs) {
    if (ac.subject_type === 'user' && ac.subject_ref === email) map.set(ac.module_code, ac.enabled);
  }
  return [...map.entries()].filter(([, v]) => v).map(([k]) => k);
}
