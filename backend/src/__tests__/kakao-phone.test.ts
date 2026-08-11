/**
 * 알림톡 수신번호 정규화 — 저장 형식(하이픈)과 모두싸인 형식(숫자만)이 다르다.
 * 이 변환이 빠지면 카카오 발송이 400 으로 떨어진다(요금이 나가는 호출이라 미리 잡는다).
 */
import { describe, it, expect } from 'vitest';
import { toKakaoPhone } from '../services/modusign.js';

describe('알림톡 수신번호', () => {
  it('하이픈·공백을 떼고 숫자만 남긴다', () => {
    expect(toKakaoPhone('010-1234-5678')).toBe('01012345678');
    expect(toKakaoPhone('010 1234 5678')).toBe('01012345678');
    expect(toKakaoPhone('01012345678')).toBe('01012345678');
    expect(toKakaoPhone('+82 10-1234-5678')).toBe('821012345678');
  });

  it('번호가 없으면 undefined — 발송 전에 막힌다', () => {
    expect(toKakaoPhone('')).toBeUndefined();
    expect(toKakaoPhone(undefined)).toBeUndefined();
    expect(toKakaoPhone('--')).toBeUndefined();
  });
});
