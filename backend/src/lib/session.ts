import type { Response, CookieOptions } from 'express';
import { signToken, type VerifiedPayload } from './jwt.js';

/**
 * **로그인 유지** — 한 번 로그인하면 쓰는 동안은 다시 묻지 않는다.
 *
 * 예전에는 로그인하고 8시간이 지나면 쓰는 중이어도 무조건 끊겼다. 그래서 사실상
 * 매일 로그인해야 했다(2026-09-14 요청). 이제는:
 *
 *   - 「로그인 상태 유지」(기본 체크) → **마지막으로 쓴 때부터 30일.** 쓰는 동안 계속 늘어난다.
 *   - 체크 해제(공용 PC) → 브라우저를 닫으면 끝. 닫지 않아도 **8시간 동안 안 쓰면** 끝.
 *
 * 늘리는 방법: 요청이 올 때 토큰이 어느 정도 묵었으면 새로 발급해 쿠키를 갈아 끼운다.
 * 매 요청마다 갈지 않는 것은 쿠키 헤더를 매번 보내지 않기 위해서다.
 *
 * ⚠️ 오래 유지되는 만큼 **끊어야 할 때는 바로 끊긴다.**
 *    - 계정 정지·비활성 → 요청마다 DB 에서 상태를 본다(rbac.injectJwtAuth, 기존)
 *    - 비밀번호 변경·관리자 초기화 → `user.sessions_valid_after` 이전에 발급된 토큰은 무효
 */
export const COOKIE_NAME = 'access_token';

const DAY = 24 * 60 * 60 * 1000;
export const REMEMBER_MS = 30 * DAY;
export const SESSION_MS = 8 * 60 * 60 * 1000;

/** 이만큼 묵은 토큰이면 새로 발급한다 */
const REFRESH_AFTER_MS = { remember: DAY, session: 30 * 60 * 1000 };

/** 토큰에 적힌 유지 여부 — 필드가 없던 예전 토큰은 기본값(유지)으로 본다 */
export function remembers(p: Pick<VerifiedPayload, 'rem'>): boolean {
  return p.rem !== false;
}

export function cookieOptions(remember: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    path: '/',
    // 유지하지 않으면 만료를 적지 않는다 — 브라우저를 닫을 때 지워지는 쿠키가 된다
    ...(remember ? { maxAge: REMEMBER_MS } : {}),
  };
}

/** 로그인·연장·비밀번호 변경 뒤 — 새 토큰을 쿠키로 내려 준다 */
export function issueSession(
  res: Response,
  user: { email: string; role: string; org_code: string },
  remember: boolean,
): void {
  const token = signToken(
    { email: user.email, role: user.role, org_code: user.org_code, rem: remember },
    remember ? '30d' : '8h',
  );
  res.cookie(COOKIE_NAME, token, cookieOptions(remember));
}

/** 새로 발급할 만큼 묵었는가 */
export function shouldRefresh(p: Pick<VerifiedPayload, 'iat' | 'rem'>, now = Date.now()): boolean {
  // 이 기능 전에 발급된 8시간짜리 토큰 — 바로 새 방식으로 갈아 준다. 안 그러면 한 번은 더 끊긴다
  if (p.rem === undefined) return true;
  const age = now - p.iat * 1000;
  return age >= (remembers(p) ? REFRESH_AFTER_MS.remember : REFRESH_AFTER_MS.session);
}

/**
 * 비밀번호가 바뀐 뒤라 **이미 무효가 된 토큰인가.**
 * `iat` 는 초 단위라 기준 시각도 초로 내려 비교한다 — 바꾼 직후 새로 받은 토큰이 같은 초에
 * 발급돼도 살아 있어야 한다.
 */
export function revoked(p: Pick<VerifiedPayload, 'iat'>, validAfter: Date | null | undefined): boolean {
  if (!validAfter) return false;
  return p.iat < Math.floor(validAfter.getTime() / 1000);
}
