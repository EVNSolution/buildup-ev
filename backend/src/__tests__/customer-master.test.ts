import { describe, it, expect } from 'vitest';
import { hasMasterKey } from '../services/customer-master.js';

/**
 * 고객 마스터 식별 키 = 성명(상호) + 생년월일(사업자번호) **둘 다**.
 *
 * 이 판정이 조회 API 의 문지기다. 한 값만으로 조회가 되면 사실상 목록 조회가 되어
 * 남의 연락처·주소를 훑을 수 있으므로, 둘 다 있을 때만 통과시킨다.
 * (실제 조회는 prisma where { name, reg_no } 완전일치 — 로컬 DB 가 없어 여기선 키 판정만 검증)
 */
describe('고객 마스터 키 (hasMasterKey)', () => {
  it('성명 + 생년월일이 모두 있어야 조회할 수 있다', () => {
    expect(hasMasterKey('여준성', '900101-1234567')).toBe(true);
    expect(hasMasterKey('(주)한빛물류', '123-45-67890')).toBe(true);
  });

  it('이름만으로는 조회하지 못한다 — 동명이인이 섞이고 목록 조회가 된다', () => {
    expect(hasMasterKey('여준성', '')).toBe(false);
    expect(hasMasterKey('여준성', undefined)).toBe(false);
    expect(hasMasterKey('여준성', null)).toBe(false);
  });

  it('생년월일만으로도 조회하지 못한다', () => {
    expect(hasMasterKey('', '900101-1234567')).toBe(false);
    expect(hasMasterKey(undefined, '900101-1234567')).toBe(false);
  });

  it('공백만 있는 값은 없는 것으로 본다', () => {
    expect(hasMasterKey('   ', '900101-1234567')).toBe(false);
    expect(hasMasterKey('여준성', '   ')).toBe(false);
    expect(hasMasterKey('  ', '  ')).toBe(false);
  });
});
