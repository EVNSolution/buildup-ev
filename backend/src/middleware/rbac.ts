import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';

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

/**
 * JWT cookie 기반 인증 컨텍스트 주입.
 * TEST 환경: JWT payload 직접 신뢰 (DB 조회 생략).
 * 운영 환경: JWT 검증 후 DB에서 user.status/active 확인.
 */
export function injectJwtAuth(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.['access_token'] as string | undefined;
  if (!token) { next(); return; }

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch {
    next(); return;
  }

  if (process.env['NODE_ENV'] === 'test') {
    req.auth = { email: payload.email, role: payload.role as Role, org_code: payload.org_code };
    next();
    return;
  }

  if (!prisma) {
    req.auth = { email: payload.email, role: payload.role as Role, org_code: payload.org_code };
    next();
    return;
  }

  prisma.user.findUnique({ where: { email: payload.email } })
    .then(user => {
      if (user && user.status === 'active' && user.active) {
        req.auth = { email: user.email, role: user.role as Role, org_code: user.org_code };
      }
      next();
    })
    .catch(() => next());
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

export function orgScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '인증 필요' } });
    return;
  }
  next();
}
