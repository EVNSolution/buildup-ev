import type { FeatureModule } from '@buildup-ev/shared/types';

// Feature module definitions — used as DB fallback in feature-modules route
export const MOCK_FEATURE_MODULES: FeatureModule[] = [
  { code: 'quote.create',   name: '견적 생성',           surface: '영업',              sort_order: 1, active: true },
  { code: 'quote.confirm',  name: '견적서 확정·생성',    surface: '영업,관리자',       sort_order: 2, active: true },
  { code: 'order.confirm',  name: '주문 전환·배정',      surface: '관리자',            sort_order: 3, active: true },
  { code: 'view.all',       name: '전체 조회',           surface: '영업,관리자',       sort_order: 4, active: true },
  { code: 'order.view',     name: '주문 진행 조회',      surface: '영업,관리자,특장사', sort_order: 5, active: true },
  { code: 'order.control',  name: '주문 상태 변경',      surface: '관리자,특장사',     sort_order: 6, active: true },
  { code: 'subsidy.manage', name: '보조금 관리',         surface: '관리자',            sort_order: 7, active: true },
  { code: 'account.manage', name: '계정 관리',           surface: '관리자',            sort_order: 8, active: true },
  { code: 'doc.view',       name: '서류 조회',           surface: '관리자,특장사',     sort_order: 9, active: true },
];

// re-export for backward compatibility (tests import mergePermissions from here)
export { mergePermissions } from '../lib/permissions.js';
