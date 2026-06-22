import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { MOCK_USERS, MOCK_ORGS, mergePermissions } from '../data/auth-mock.js';

export const authRouter = Router();

/**
 * GET /auth/me
 * X-Role, X-User 헤더 기반 mock. TODO: 실인증 구현 시 JWT 파싱으로 교체.
 */
authRouter.get('/me', rbac('SALES', 'ADMIN', 'MAKER'), (req, res): void => {
  const { email, role, org_code } = req.auth!;

  const user = MOCK_USERS[email] ?? {
    email,
    org_code,
    role,
    name: '(mock 사용자)',
    status: 'active' as const,
    must_change_pw: false,
    active: true,
  };

  const org = MOCK_ORGS[org_code] ?? {
    code: org_code,
    type: 'HQ' as const,
    name: '(알 수 없는 조직)',
    active: true,
  };

  const permissions = mergePermissions(role, email);

  res.json({ data: { user, org, permissions } });
});

/**
 * GET /me/permissions
 * 역할 기본 + 계정 override를 머지한 활성 모듈코드 배열.
 */
authRouter.get('/me/permissions', rbac('SALES', 'ADMIN', 'MAKER'), (req, res): void => {
  const { email, role } = req.auth!;
  const permissions = mergePermissions(role, email);
  res.json({ data: { permissions } });
});
