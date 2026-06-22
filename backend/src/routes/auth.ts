import { Router } from 'express';
import type { Request, Response, CookieOptions } from 'express';
import rateLimit from 'express-rate-limit';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { signToken } from '../lib/jwt.js';
import { verifyPassword, hashPassword } from '../lib/password.js';
import { mergePermissions } from '../lib/permissions.js';
import type { Role } from '@buildup-ev/shared/types';

export const authRouter = Router();

const COOKIE_NAME = 'access_token';
const LOCK_AFTER  = 5;
const LOCK_MS     = 15 * 60 * 1000;

function cookieOpts(): CookieOptions {
  return {
    httpOnly: true,
    secure:   process.env['NODE_ENV'] === 'production',
    sameSite: 'strict',
    maxAge:   8 * 60 * 60 * 1000,
    path:     '/',
  };
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: '너무 많은 시도. 15분 후 다시 시도해주세요.' } },
});

// ── POST /auth/login ──────────────────────────────────────────────────────

authRouter.post('/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }

  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '이메일과 비밀번호를 입력해주세요.' } });
    return;
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Generic error — never distinguish "not found" vs "wrong password"
  const INVALID = { error: { code: 'INVALID_CREDENTIALS', message: '이메일 또는 비밀번호가 올바르지 않습니다.' } };

  if (!user || !user.password_hash) {
    res.status(401).json(INVALID);
    return;
  }

  // suspended or deactivated → block
  if (user.status === 'suspended' || !user.active) {
    res.status(403).json({ error: { code: 'ACCOUNT_INACTIVE', message: '비활성 계정입니다. 관리자에게 문의하세요.' } });
    return;
  }

  // Check lockout
  if (user.locked_until && user.locked_until > new Date()) {
    const remainMin = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    res.status(423).json({ error: { code: 'ACCOUNT_LOCKED', message: `계정이 잠겼습니다. ${remainMin}분 후 다시 시도해주세요.` } });
    return;
  }

  const valid = await verifyPassword(password, user.password_hash);

  if (!valid) {
    const attempts = user.login_attempts + 1;
    const lockData = attempts >= LOCK_AFTER
      ? { login_attempts: attempts, locked_until: new Date(Date.now() + LOCK_MS) }
      : { login_attempts: attempts };
    await prisma.user.update({ where: { email }, data: lockData });
    res.status(401).json(INVALID);
    return;
  }

  // Success: reset lockout state; invited → active on first login
  const updateData: Record<string, unknown> = { login_attempts: 0, locked_until: null };
  if (user.status === 'invited') updateData['status'] = 'active';
  await prisma.user.update({ where: { email }, data: updateData });

  const token = signToken({ email: user.email, role: user.role, org_code: user.org_code });
  res.cookie(COOKIE_NAME, token, cookieOpts());
  res.json({ data: { email: user.email, role: user.role, must_change_pw: user.must_change_pw } });
});

// ── POST /auth/logout ─────────────────────────────────────────────────────

authRouter.post('/logout', (_req: Request, res: Response): void => {
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ data: { ok: true } });
});

// ── GET /auth/me ──────────────────────────────────────────────────────────

authRouter.get('/me', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { email } = req.auth!;
  const dbUser = await prisma.user.findUnique({ where: { email }, include: { org: true } });
  if (!dbUser) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' } });
    return;
  }
  const acs = await prisma.accessControl.findMany({
    where: { OR: [{ subject_type: 'role', subject_ref: dbUser.role }, { subject_type: 'user', subject_ref: email }] },
  });
  const permissions = mergePermissions(dbUser.role as Role, email, acs);
  res.json({
    data: {
      user: {
        email: dbUser.email,
        org_code: dbUser.org_code,
        role: dbUser.role,
        name: dbUser.name,
        phone: dbUser.phone ?? undefined,
        status: dbUser.status,
        must_change_pw: dbUser.must_change_pw,
        invited_by: dbUser.invited_by ?? undefined,
        active: dbUser.active,
      },
      org: {
        code: dbUser.org.code,
        type: dbUser.org.type,
        name: dbUser.org.name,
        active: dbUser.org.active,
      },
      permissions,
    },
  });
});

// ── GET /auth/me/permissions ──────────────────────────────────────────────

authRouter.get('/me/permissions', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } });
    return;
  }
  const { email, role } = req.auth!;
  const acs = await prisma.accessControl.findMany({
    where: { OR: [{ subject_type: 'role', subject_ref: role }, { subject_type: 'user', subject_ref: email }] },
  });
  res.json({ data: { permissions: mergePermissions(role, email, acs) } });
});

// ── POST /auth/change-password ────────────────────────────────────────────

authRouter.post('/change-password', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } });
    return;
  }
  const { current_password, new_password } = req.body as { current_password?: string; new_password?: string };
  if (!current_password || !new_password) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '현재 비밀번호와 새 비밀번호를 입력해주세요.' } });
    return;
  }
  if (new_password.length < 8) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '새 비밀번호는 8자 이상이어야 합니다.' } });
    return;
  }

  const { email } = req.auth!;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.password_hash) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '비밀번호를 변경할 수 없습니다.' } });
    return;
  }

  const valid = await verifyPassword(current_password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: '현재 비밀번호가 올바르지 않습니다.' } });
    return;
  }

  const newHash = await hashPassword(new_password);
  await prisma.user.update({ where: { email }, data: { password_hash: newHash, must_change_pw: false } });
  res.json({ data: { ok: true } });
});
