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
/**
 * **권한 무제한 우회** — requirePermission 을 통째로 건너뛴다. 운영에서는 꺼 둔다.
 *
 * ⚠️ 이것은 「마스터가 세 화면을 쓸 수 있는가」와 **다른 이야기**다.
 *    한동안 둘을 이 함수 하나로 판단해, 운영에서 우회를 끄자 마스터의 화면 전환까지
 *    함께 꺼졌다(2026-08-19 — 마스터에게 관리자 화면만 보였다).
 *    화면·역할은 `masterRoles` 가, 무제한 우회는 이 함수가 맡는다.
 */
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
        /*
         * 마스터는 **세 역할을 가진 계정**이다(영업·관리·특장 화면을 오간다).
         * 이건 권한 우회가 아니라 역할 보유라 운영에서도 그대로다 —
         * 실제 권한은 그 역할들의 access_control 로 계산되므로 감사할 수 있다.
         * 무제한 우회(masterBypassEnabled)는 별개로 운영에서 꺼져 있다.
         */
        req.auth = {
          email: user.email,
          role: user.role as Role,
          roles: rolesOf({ role: user.role as Role, extra_roles: user.extra_roles as Role[], is_master: user.is_master }),
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

/**
 * **영업 화면에서는 남의 견적을 보지 않는다** — 겸직 계정이라도.
 *
 * 영업과 관리자 권한을 함께 가진 계정은 `isAdmin` 이 참이라 지금까지 **영업 화면에서도
 * 전사 견적이 보였다.** 관리자 화면에서 전체를 보는 것과, 영업으로 일하는 화면에서
 * 남의 담당 건이 섞여 보이는 것은 전혀 다른 일이다.
 *
 * 어느 화면에서 부르는지는 서버가 알 수 없어 **화면이 `scope=mine` 을 붙여 알린다.**
 * ⚠️ 이 값은 **좁히기만 한다** — 없다고 넓어지지 않고, 붙였다고 남의 것이 보이지도 않는다.
 *    그래서 화면이 보낸 값을 그대로 믿어도 권한이 새지 않는다.
 *
 * 마스터 계정은 제외한다(전수 조사·대리 처리를 해야 하는 자리다).
 */
export function scopedToMine(auth: AuthContext, scope: unknown): boolean {
  return scope === 'mine' && !auth.is_master;
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
    return mergePermissions(req.auth.roles, req.auth.email, acs, req.auth).includes(code);
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
      const permissions = mergePermissions(req.auth.roles, req.auth.email, acs, req.auth);
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
