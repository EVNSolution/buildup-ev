import { describe, it, expect } from 'vitest';
import { rolesOf } from './index.js';

/**
 * 역할 목록 — 화면 전환 토글·라우팅·권한 합산이 모두 이 함수 하나를 본다.
 * 여기가 틀리면 "관리자인데 영업 화면이 안 보인다" 같은 식으로 사방에서 어긋난다.
 */
describe('rolesOf — 겸직 포함 역할 목록', () => {
  it('겸직이 없으면 주 역할 하나', () => {
    expect(rolesOf({ role: 'SALES' })).toEqual(['SALES']);
  });

  it('주 역할이 늘 맨 앞', () => {
    expect(rolesOf({ role: 'ADMIN', extra_roles: ['SALES', 'MAKER'] })).toEqual(['ADMIN', 'SALES', 'MAKER']);
  });

  it('주 역할이 겸직에 섞여 들어와도 한 번만', () => {
    expect(rolesOf({ role: 'ADMIN', extra_roles: ['ADMIN', 'SALES'] })).toEqual(['ADMIN', 'SALES']);
  });

  it('null·undefined 를 빈 목록으로 본다 — 서버가 안 내려줘도 화면이 죽지 않는다', () => {
    expect(rolesOf({ role: 'MAKER', extra_roles: null })).toEqual(['MAKER']);
    expect(rolesOf({ role: 'MAKER' })).toEqual(['MAKER']);
  });

  it('마스터 계정은 전 역할', () => {
    expect(rolesOf({ role: 'SALES', is_master: true }).sort()).toEqual(['ADMIN', 'MAKER', 'SALES']);
  });
});
