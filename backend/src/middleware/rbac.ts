import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';
import { rolesOf } from '@buildup-ev/shared/types';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { mergePermissions } from '../lib/permissions.js';

export interface AuthContext {
  email: string;
  role: Role;
  roles: Role[];
  org_code: string;
  /** 보호 대상 마스터 계정 표시. 운영 권한 우회 여부와는 별개다. */
  is_master?: boolean;
}

interface PermissionRecord {
  subject_type: string;
  subject_ref: string;
  module_code: string;
  enabled: boolean;
}

type PermissionLookup = (auth: AuthContext) => Promise<PermissionRecord[]>;

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

function testAuthBypassEnabled(): boolean {
  return process.env['NODE_ENV'] === 'test' && process.env['ALLOW_TEST_AUTH_BYPASS'] === 'true';
}

function testPermissionBypassEnabled(): boolean {
  return process.env['NODE_ENV'] === 'test' && process.env['ALLOW_TEST_PERMISSION_BYPASS'] === 'true';
}

/** 테스트용 surface 전환은 개발·테스트에서만 허용한다. */
export function masterBypassEnabled(auth: Pick<AuthContext, 'is_master'>): boolean {
  return process.env['NODE_ENV'] !== 'production' && auth.is_master === true;
}

async function loadAccessControls(auth: AuthContext): Promise<PermissionRecord[]> {
  if (!prisma) throw new Error('permission store unavailable');
  return prisma.accessControl.findMany({
    where: {
      OR: [
        { subject_type: 'role', subject_ref: { in: auth.roles } },
        { subject_type: 'user', subject_ref: auth.email },
      ],
    },
  });
}

/** JWT를 검증한 뒤 DB의 현재 계정 상태와 역할만 신뢰한다. */
export function injectJwtAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.cookies?.['access_token'] as string | undefined;
  if (!token) { next(); return; }

  let payload: ReturnType<typeof verifyToken>;
  try {
    payload = verifyToken(token);
  } catch {
    next(); return;
  }

  if (testAuthBypassEnabled()) {
    req.auth = { email: payload.email, role: payload.role as Role, roles: [payload.role as Role], org_code: payload.org_code };
    next();
    return;
  }

  if (!prisma) {
    res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: '계정 확인을 사용할 수 없습니다.' } });
    return;
  }

  prisma.user.findUnique({ where: { email: payload.email } })
    .then(user => {
      if (user && user.status === 'active' && user.active) {
        const masterBypass = masterBypassEnabled({ is_master: user.is_master });
        req.auth = {
          email: user.email,
          role: user.role as Role,
          roles: rolesOf({ role: user.role as Role, extra_roles: user.extra_roles as Role[], is_master: masterBypass }),
          org_code: user.org_code,
          is_master: user.is_master,
        };
      }
      next();
    })
    .catch(() => {
      res.status(503).json({ error: { code: 'AUTH_UNAVAILABLE', message: '계정 확인을 사용할 수 없습니다.' } });
    });
}

export function isAdmin(auth: AuthContext): boolean {
  return masterBypassEnabled(auth) || auth.roles.includes('ADMIN');
}

export function ownQuotesOnly(auth: AuthContext): boolean {
  return !isAdmin(auth) && auth.roles.includes('SALES');
}

export function ownOrgOnly(auth: AuthContext): boolean {
  return !isAdmin(auth) && auth.roles.includes('MAKER');
}

export function canSeeQuotePrices(auth: AuthContext): boolean {
  return isAdmin(auth) || auth.roles.includes('SALES');
}

/** 역할 기반 접근 제어. 운영에서는 실제 역할만 인정한다. */
export function rbac(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한 없음' } });
      return;
    }
    if (masterBypassEnabled(req.auth) || req.auth.roles.some(role => allowed.includes(role))) {
      next();
      return;
    }
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한 없음' } });
  };
}

export function orgScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth) {
    res.status(403).json({ error: { code: 'FORBIDDEN', message: '인증 필요' } });
    return;
  }
  next();
}

/** 권한 보유 여부만 확인한다. 조회 장애는 권한 없음으로 처리한다. */
export async function hasPermission(
  req: Request,
  code: string,
  lookup: PermissionLookup = loadAccessControls,
): Promise<boolean> {
  if (!req.auth) return false;
  if (masterBypassEnabled(req.auth)) return true;
  if (testPermissionBypassEnabled()) return true;
  try {
    const acs = await lookup(req.auth);
    return mergePermissions(req.auth.roles, req.auth.email, acs).includes(code);
  } catch {
    return false;
  }
}

/** 권한 저장소가 없거나 조회에 실패하면 요청을 허용하지 않는다. */
export function requirePermission(code: string, lookup: PermissionLookup = loadAccessControls) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '인증 필요' } });
      return;
    }
    if (masterBypassEnabled(req.auth) || testPermissionBypassEnabled()) { next(); return; }

    try {
      const acs = await lookup(req.auth);
      const permissions = mergePermissions(req.auth.roles, req.auth.email, acs);
      if (!permissions.includes(code)) {
        res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: `'${code}' 권한이 없습니다.` } });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: { code: 'PERMISSION_UNAVAILABLE', message: '권한 확인을 사용할 수 없습니다.' } });
    }
  };
}
