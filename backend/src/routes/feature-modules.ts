import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { MOCK_FEATURE_MODULES } from '../data/auth-mock.js';

export const featureModulesRouter = Router();

/**
 * GET /feature-modules
 * 기능 모듈 카탈로그 전체 반환. 관리자가 권한 토글 UI에서 참조.
 */
featureModulesRouter.get('/', rbac('ADMIN'), (_req, res): void => {
  res.json({ data: MOCK_FEATURE_MODULES });
});
