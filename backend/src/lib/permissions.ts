import type { Role } from '@buildup-ev/shared/types';

interface AcRecord {
  subject_type: string;
  subject_ref: string;
  module_code: string;
  enabled: boolean;
}

export function mergePermissions(role: Role, email: string, acs: AcRecord[]): string[] {
  const map = new Map<string, boolean>();
  for (const ac of acs) {
    if (ac.subject_type === 'role' && ac.subject_ref === role) map.set(ac.module_code, ac.enabled);
  }
  for (const ac of acs) {
    if (ac.subject_type === 'user' && ac.subject_ref === email) map.set(ac.module_code, ac.enabled);
  }
  return [...map.entries()].filter(([, v]) => v).map(([k]) => k);
}
