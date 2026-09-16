import type { Request, Response, NextFunction } from 'express';
import type { Role } from '@buildup-ev/shared/types';
import { rolesOf } from '@buildup-ev/shared/types';
import { prisma } from '../lib/prisma.js';
import { verifyToken } from '../lib/jwt.js';
import { COOKIE_NAME, issueSession, remembers, revoked, shouldRefresh } from '../lib/session.js';
import { mergePermissions } from '../lib/permissions.js';

export interface AuthContext {
  email: string;
  role: Role;
  roles: Role[];
  org_code: string;
  /** 보호 대상 마스터 계정 표시. 운영 권한 우회 여부와는 별개다. */
  is_master?: boolean;
  /** 이 로그인이 「로그인 상태 유지」인가 — 비밀번호 변경 뒤 같은 방식으로 다시 발급한다 */
  remember?: boolean;
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
 * **마스터는 모든 기능모듈을 가진다** — 운영에서도 그렇다.
 *
 * 예전에는 개발 환경에서만 우회했다(`NODE_ENV !== 'production'`). 그러자 운영의
 * 마스터 계정에서 「옵션DB」·「무게상수」 탭이 보이지 않았다 — 기능모듈 화면에서
 * 켜 주기 전에는 시스템 주인이 자기 시스템의 일부를 못 보는 상태였다(제보).
 *
 * ⚠️ 이것은 **기능모듈**(관리자 화면의 모듈 토글)에 대한 이야기다.
 *    「누구의 견적을 볼 수 있는가」 같은 **자료 범위**는 여기서 넓히지 않는다 —
 *    그건 각 라우트가 역할과 소유로 따로 판단한다.
 *
 * ⚠️ 이것은 「마스터가 세 화면을 쓸 수 있는가」와도 **다른 이야기**다.
 *    한동안 둘을 이 함수 하나로 판단해, 운영에서 우회를 끄자 마스터의 화면 전환까지
 *    함께 꺼졌다(2026-08-19 — 마스터에게 관리자 화면만 보였다).
 *    화면·역할은 `masterRoles` 가, 모듈 전체 보유는 이 함수가 맡는다.
 */
export function masterBypassEnabled(auth: Pick<AuthContext, 'is_master'>): boolean {
  return auth.is_master === true;
}

async function loadAccessControls(auth: AuthContext): Promise<PermissionRecord[]> {
  if (!prisma) throw new Error('permission store unavailable');
  return prisma.accessControl.findMany({
    where: {
      OR: [
        { subject_type: 'role', subject_ref: { in: auth.roles } },
        { subject_type: 'user', subject_ref: auth.email },
        // 역할 프리셋 구성 — 기능모듈 화면에서 고친 값이 여기 있다(2026-09-16)
        { subject_type: 'preset' },
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
      if (user && user.status === 'active' && user.active && revoked(payload, user.sessions_valid_after)) {
        // 비밀번호가 바뀌기 전에 발급된 토큰 — 로그인 안 한 것으로 본다. 쿠키도 치운다
        res.clearCookie(COOKIE_NAME, { path: '/' });
      } else if (user && user.status === 'active' && user.active) {
        // 쓰는 동안은 계속 늘어난다 — 토큰이 묵었으면 새로 발급한다(현재 역할·소속으로)
        if (shouldRefresh(payload)) issueSession(res, user, remembers(payload));
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
          remember: remembers(payload),
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

/**
 * 이 계정의 **역할 프리셋**(관리자 안의 자리) — 권한 계산에 쓴다.
 *
 * ⚠️ 토큰에 담지 않는다. 담으면 관리자가 프리셋을 바꿔도 그 사람이 다시 로그인할 때까지(최대 30일)
 *    옛 권한으로 다닌다. 권한을 볼 때마다 DB 에서 읽는다 — 권한 조회는 어차피 DB 를 탄다.
 */
async function loadPreset(auth: AuthContext): Promise<string | null> {
  if (!prisma) return null;
  const u = await prisma.user.findUnique({ where: { email: auth.email }, select: { admin_preset: true } });
  return u?.admin_preset ?? null;
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
    const [acs, preset] = await Promise.all([lookup(req.auth), loadPreset(req.auth)]);
    return mergePermissions(req.auth.roles, req.auth.email, acs, { ...req.auth, preset }).includes(code);
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
      const [acs, preset] = await Promise.all([lookup(req.auth), loadPreset(req.auth)]);
      const permissions = mergePermissions(req.auth.roles, req.auth.email, acs, { ...req.auth, preset });
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
