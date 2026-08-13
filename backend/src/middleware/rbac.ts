import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';
import { rolesOf } from '@buildup-ev/shared/types';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { mergePermissions } from '../lib/permissions.js';

export interface AuthContext {
  email: string;
  /** 주 역할 — 표시·기본 화면용 */
  role: Role;
  /** 이 계정이 가진 역할 전부(주 역할 포함). 권한·접근 판정은 **이것**을 본다. */
  roles: Role[];
  org_code: string;
  // DEV: master surface switcher — true이면 rbac 역할 체크 우회
  is_master?: boolean;
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
    req.auth = { email: payload.email, role: payload.role as Role, roles: [payload.role as Role], org_code: payload.org_code };
    next();
    return;
  }

  if (!prisma) {
    req.auth = { email: payload.email, role: payload.role as Role, roles: [payload.role as Role], org_code: payload.org_code };
    next();
    return;
  }

  prisma.user.findUnique({ where: { email: payload.email } })
    .then(user => {
      if (user && user.status === 'active' && user.active) {
        /*
         * ⚠️ 역할은 **토큰이 아니라 DB** 에서 읽는다. 토큰에 박아 두면 관리자가 역할을
         *    더해 줘도 다시 로그인하기 전까지 반영되지 않는다.
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
    .catch(() => next());
}

/**
 * 자료를 어디까지 보여줄지 — **역할 하나가 아니라 가진 역할 전부**로 판단한다.
 *
 * 예전에는 `auth.role === 'SALES'` 로 "내 견적만" 을 걸었다. 겸직이 생기면서 이 판정이
 * 틀어진다: 주 역할이 영업이고 관리를 겸한 계정은 관리 화면에서도 자기 견적만 보게 된다.
 * 그래서 "관리자인가"를 먼저 묻고, 아니면 남은 역할로 범위를 정한다.
 */
export function isAdmin(auth: AuthContext): boolean {
  return !!auth.is_master || auth.roles.includes('ADMIN');
}

/** 남의 견적은 못 보는 자리인가(순수 영업). */
export function ownQuotesOnly(auth: AuthContext): boolean {
  return !isAdmin(auth) && auth.roles.includes('SALES');
}

/** 자기 조직에 배정된 주문만 보는 자리인가(순수 특장사). */
export function ownOrgOnly(auth: AuthContext): boolean {
  return !isAdmin(auth) && auth.roles.includes('MAKER');
}

/** 역할 기반 접근 제어. 허용 역할 목록에 없으면 403.
 * DEV: is_master=true인 계정은 역할 체크 우회 (surface 전환 테스트용). */
export function rbac(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한 없음' } });
      return;
    }
    // 겸직 포함 — 가진 역할 중 하나라도 허용 목록에 있으면 통과
    if (req.auth.is_master || req.auth.roles.some(r => allowed.includes(r))) {
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

/**
 * 권한 보유 여부만 확인한다(막지는 않는다).
 * "권한이 있으면 전체, 없으면 본인 것만" 처럼 **결과 범위를 가르는** 데 쓴다.
 * 역할로 가르면 계정별 토글이 무시되므로 여기서도 같은 판정을 쓴다.
 */
export async function hasPermission(req: Request, code: string): Promise<boolean> {
  if (!req.auth) return false;
  if (req.auth.is_master) return true;
  if (!prisma || process.env['NODE_ENV'] === 'test') return true;
  try {
    const acs = await prisma.accessControl.findMany({
      where: {
        OR: [
          { subject_type: 'role', subject_ref: { in: req.auth.roles } },
          { subject_type: 'user', subject_ref: req.auth.email },
        ],
      },
    });
    return mergePermissions(req.auth.roles, req.auth.email, acs).includes(code);
  } catch {
    return false;
  }
}

/** 권한 모듈 코드 기반 접근 제어. 역할 체크(rbac) 이후에 체인으로 사용.
 * DEV: is_master=true이면 우회. TEST/DB없음이면 우회. */
export function requirePermission(code: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.auth) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '인증 필요' } });
      return;
    }
    if (req.auth.is_master) { next(); return; }
    if (!prisma || process.env['NODE_ENV'] === 'test') { next(); return; }

    try {
      const acs = await prisma.accessControl.findMany({
        where: {
          OR: [
            { subject_type: 'role', subject_ref: { in: req.auth.roles } },
            { subject_type: 'user', subject_ref: req.auth.email },
          ],
        },
      });
      const perms = mergePermissions(req.auth.roles, req.auth.email, acs);
      if (!perms.includes(code)) {
        res.status(403).json({ error: { code: 'PERMISSION_DENIED', message: `'${code}' 권한이 없습니다.` } });
        return;
      }
      next();
    } catch {
      next();
    }
  };
}
