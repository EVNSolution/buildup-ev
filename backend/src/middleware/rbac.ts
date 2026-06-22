import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';
import { prisma } from '../lib/prisma.js';
import { MOCK_USERS } from '../data/auth-mock.js';

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

/**
 * X-User(이메일) 헤더로 인증 컨텍스트 주입.
 * DB 가용 시 Prisma 조회, 아니면 MOCK_USERS 폴백(테스트 환경 호환).
 */
export function injectMockAuth(req: Request, _res: Response, next: NextFunction): void {
  const rawUser = req.headers['x-user'] as string | undefined;
  if (!rawUser) { next(); return; }

  if (prisma) {
    prisma.user.findUnique({ where: { email: rawUser } })
      .then(user => {
        if (user) {
          req.auth = { email: user.email, role: user.role as Role, org_code: user.org_code };
        } else {
          // DB에 없으면 mock 폴백 (seed 전·테스트 계정 호환)
          const m = MOCK_USERS[rawUser];
          if (m) req.auth = { email: m.email, role: m.role, org_code: m.org_code };
        }
        next();
      })
      .catch(() => {
        // DB 연결 실패 시 mock 폴백
        const m = MOCK_USERS[rawUser];
        if (m) req.auth = { email: m.email, role: m.role, org_code: m.org_code };
        next();
      });
  } else {
    const m = MOCK_USERS[rawUser];
    if (m) req.auth = { email: m.email, role: m.role, org_code: m.org_code };
    next();
  }
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
  next();
}
