import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';

/** mock 인증 컨텍스트 — TODO: 실인증(JWT 등) 구현 시 교체 */
export interface AuthContext {
  email: string;
  role: Role;
  org_code: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

/** X-Role / X-User 헤더로 mock 인증 컨텍스트 주입 */
export function injectMockAuth(req: Request, _res: Response, next: NextFunction): void {
  const rawRole = req.headers['x-role'];
  const rawUser = (req.headers['x-user'] as string | undefined) ?? 'mock@evnsolution.com';

  const role = rawRole === 'SALES' || rawRole === 'ADMIN' || rawRole === 'MAKER'
    ? (rawRole as Role)
    : null;

  if (role) {
    req.auth = {
      email: rawUser,
      role,
      org_code: role === 'MAKER' ? 'ORG_MAKER1' : 'ORG_HQ',
    };
  }
  next();
}

/** 역할 기반 접근 제어. 허용 역할 목록에 없으면 403. */
export function rbac(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth || !allowed.includes(req.auth.role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한 없음' } });
      return;
    }
    next();
  };
}

/**
 * org 스코핑 stub — DB 연결 후 쿼리 필터로 구현.
 * - SALES: sales_user_id = req.auth.email OR org_id = req.auth.org_code
 * - MAKER: maker_org_id = req.auth.org_code
 * - ADMIN: 전체 허용
 */
export function orgScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '인증 필요' } });
    return;
  }
  // TODO: DB 연결 시 여기에 쿼리 필터 파라미터 주입
  // req.scopeFilter = buildScopeFilter(req.auth)
  next();
}
