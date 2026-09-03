import type { Role } from '@buildup-ev/shared/types';

interface AcRecord {
  subject_type: string;
  subject_ref: string;
  module_code: string;
  enabled: boolean;
}

/**
 * **문을 잠그는 모듈.** 이것을 잃으면 「계정 관리」·「기능모듈」 탭이 통째로 사라져
 * 되돌릴 화면 자체가 없어진다. 운영에서는 마스터도 권한 우회를 하지 않으므로
 * (감사 가능하게 하려고 일부러 꺼 두었다) 아무도 복구할 수 없는 상태가 된다.
 */
export const LOCK_MODULE = 'account.manage';

/**
 * 이 계정이 실제로 쓸 수 있는 모듈 코드.
 *
 * 역할 기본값 → 계정 override 순으로 덮는다(계정 토글이 마지막 말이다).
 *
 * ⚠️ 역할이 여럿이면 **합집합**이다 — 관리+영업을 가진 계정에서 영업이 켠 모듈을
 *    관리가 끄고 있다고 막으면, 영업 화면을 쓰라고 준 역할이 아무 일도 못 한다.
 *    역할 하나가 켜 두었으면 켜진 것으로 본다. 특정 계정만 막으려면 계정 override 를 쓴다.
 */
export function mergePermissions(
  roles: Role | Role[],
  email: string,
  acs: AcRecord[],
  subject?: { is_master?: boolean },
): string[] {
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
  const codes = [...map.entries()].filter(([, v]) => v).map(([k]) => k);

  /*
   * **마스터는 `account.manage` 를 잃지 않는다.**
   *
   * 이 줄이 없으면 마스터가 기능모듈에서 이 모듈을 끄는 순간 **스스로를 잠근다** —
   * 두 관리 탭이 함께 사라지고, 운영에서는 마스터 우회도 꺼져 있어 되돌릴 길이 없다
   * (실제로 그렇게 막혔다). 나머지 모듈은 그대로 access_control 이 정한다.
   */
  if (subject?.is_master && !codes.includes(LOCK_MODULE)) codes.push(LOCK_MODULE);
  return codes;
}
