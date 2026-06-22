import type { FeatureModule } from '@buildup-ev/shared/types';

// Feature module definitions — used as DB fallback in feature-modules route
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

// re-export for backward compatibility (tests import mergePermissions from here)
export { mergePermissions } from '../lib/permissions.js';
