import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { MOCK_USERS, MOCK_ORGS, mergePermissions } from '../data/auth-mock.js';
import type { Role } from '@buildup-ev/shared/types';

export const authRouter = Router();

/**
 * GET /auth/me
 * DB 가용 시 Prisma 조회, 아니면 mock 폴백.
 */
authRouter.get('/me', rbac('SALES', 'ADMIN', 'MAKER'), async (req, res): Promise<void> => {
  const { email, role, org_code } = req.auth!;

  if (prisma) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { email },
        include: { org: true },
      });
      if (dbUser) {
        const permissions = mergePermissions(dbUser.role as Role, email);
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
        return;
      }
    } catch { /* DB 오류 시 mock 폴백 */ }
  }

  const user = MOCK_USERS[email] ?? {
    email, org_code, role, name: '(mock)',
    status: 'active' as const, must_change_pw: false, active: true,
  };
  const org = MOCK_ORGS[org_code] ?? {
    code: org_code, type: 'HQ' as const, name: '(알 수 없는 조직)', active: true,
  };
  res.json({ data: { user, org, permissions: mergePermissions(role, email) } });
});

/**
 * GET /auth/me/permissions
 */
authRouter.get('/me/permissions', rbac('SALES', 'ADMIN', 'MAKER'), async (req, res): Promise<void> => {
  const { email, role } = req.auth!;
  let resolvedRole: Role = role;
  if (prisma) {
    try {
      const dbUser = await prisma.user.findUnique({ where: { email }, select: { role: true } });
      if (dbUser) resolvedRole = dbUser.role as Role;
    } catch { /* DB 오류 시 헤더 역할 유지 */ }
  }
  res.json({ data: { permissions: mergePermissions(resolvedRole, email) } });
});
