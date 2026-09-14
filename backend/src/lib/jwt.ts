import jwt from 'jsonwebtoken';

export interface JwtPayload {
  email: string;
  role: string;
  org_code: string;
  /**
   * 「로그인 상태 유지」를 골랐는가. 연장할 때 같은 방식으로 다시 발급하려고 담는다.
   * 이 필드가 생기기 전에 발급된 토큰에는 없다 — 기본값(유지)으로 본다.
   */
  rem?: boolean;
}

/** 검증을 통과한 토큰 — 발급·만료 시각(초)이 붙어 있다 */
export type VerifiedPayload = JwtPayload & { iat: number; exp: number };

function secret(): string {
  const s = process.env['JWT_SECRET'];
  if (!s) throw new Error('JWT_SECRET env not set');
  return s;
}

export function signToken(payload: JwtPayload, expiresIn: string = '8h'): string {
  return jwt.sign(payload, secret(), { expiresIn } as jwt.SignOptions);
}

export function verifyToken(token: string): VerifiedPayload {
  return jwt.verify(token, secret()) as VerifiedPayload;
}
