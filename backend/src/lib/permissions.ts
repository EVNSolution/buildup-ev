import type { Role } from '@buildup-ev/shared/types';
import { PRESET_BY_CODE } from '@buildup-ev/shared/rbac/presets';

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
  subject?: { is_master?: boolean; preset?: string | null },
): string[] {
  const list = Array.isArray(roles) ? roles : [roles];
  const map = new Map<string, boolean>();
  /**
   * **관리자 아닌 역할이 켜 준 것** — 프리셋이 여기를 건드리면 안 된다.
   *
   * 겸직(영업+관리자) 계정에 프리셋을 지정했더니 **영업 기능이 통째로 꺼졌다**(2026-09-16 제보).
   * 프리셋은 「관리자 안에서 무슨 자리인가」이지 「영업 일을 뺏는다」가 아니다.
   */
  const otherRolesOn = new Set<string>();
  for (const ac of acs) {
    if (ac.subject_type !== 'role' || !list.includes(ac.subject_ref as Role)) continue;
    // 한 역할이라도 켜 두었으면 켜진 것 — 끈 역할이 뒤에 와도 되돌리지 않는다
    if (ac.enabled || !map.has(ac.module_code)) map.set(ac.module_code, ac.enabled);
    if (ac.enabled && ac.subject_ref !== 'ADMIN') otherRolesOn.add(ac.module_code);
  }
  /*
   * **역할 프리셋**(2026-09-16) — 관리자 안을 하는 일로 나눈 묶음. 역할 기본값을 **덮는다.**
   *
   * 프리셋에 없는 모듈은 **끈다** — 그래야 「영업관리자에게 옵션DB가 보인다」가 사라진다.
   * 프리셋이 없는 계정(null)은 예전 그대로 역할 기본값을 쓴다(지정하기 전에는 권한이 바뀌지 않는다).
   * 계정별 토글은 이 뒤에 와서 마지막 말을 한다 — 「프리셋을 쓰되 이 계정만 예외」가 된다.
   */
  const preset = subject?.preset ? PRESET_BY_CODE[subject.preset] : undefined;
  if (preset) {
    const on = new Set(preset.modules);
    // 프리셋은 **관리자 역할이 준 것만** 여닫는다 — 영업·특장사 역할이 준 것은 그대로 둔다(겸직 계정)
    for (const code of map.keys()) map.set(code, on.has(code) || otherRolesOn.has(code));
    for (const code of on) map.set(code, true);
  }
  for (const ac of acs) {
    if (ac.subject_type === 'user' && ac.subject_ref === email) map.set(ac.module_code, ac.enabled);
  }
  const codes = [...map.entries()].filter(([, v]) => v).map(([k]) => k);

  /*
   * **옛 「옵션DB·무게상수 관리」(basedata.manage)는 우산이다.**
   * 기준데이터를 프리셋에 맞게 다섯으로 쪼갰는데(무게상수·치수·옵션DB·특장사 단가·공휴일),
   * 이미 우산만 켜 둔 계정이 그날로 다섯 화면을 전부 잃으면 안 된다 — 우산이 켜져 있으면 다섯도 켜진 것으로 본다.
   */
  if (codes.includes('basedata.manage')) {
    for (const c of ['basedata.weights', 'basedata.dims', 'basedata.optiondb', 'basedata.makerprice', 'basedata.holiday']) {
      if (!codes.includes(c)) codes.push(c);
    }
  }

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
