import type { Request, Response, NextFunction } from 'express';

export type Role = 'sales' | 'admin' | 'conversion';

// TODO: 인증 실제구현 — JWT 파싱 후 role 추출
function extractRole(req: Request): Role | null {
  const raw = req.headers['x-role'];
  if (raw === 'sales' || raw === 'admin' || raw === 'conversion') return raw;
  return null;
}

export function rbac(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = extractRole(req);
    if (!role || !allowed.includes(role)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '권한 없음' } });
      return;
    }
    next();
  };
}
