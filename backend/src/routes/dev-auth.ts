import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { issueSession } from '../lib/session.js';

/**
 * **로컬 전용 자동 로그인** — 개발할 때 비밀번호를 치지 않고 바로 들어간다.
 *
 * ⚠️ **운영에는 이 경로가 아예 없다.** `app.ts` 가 운영이 아닐 때만 붙인다 — 권한 검사를 끄는 것이 아니라
 *    **라우트를 만들지 않는다.** 운영은 `NODE_ENV=production` 으로 뜬다(deploy/remote-deploy.sh).
 * ⚠️ 그래도 한 겹 더 막는다: 요청이 이 기계(127.0.0.1/::1)에서 온 것이 아니면 404.
 *    운영에서 이 파일이 실수로 붙더라도 **밖에서는 열리지 않는다**(그 경우에도 프록시 뒤라 열리지 않게 두 조건을 모두 본다).
 */
export const devAuthRouter = Router();

/** 운영이 아닐 때만 — 값이 없으면 개발로 본다(config.ts 와 같은 기준) */
export const devAutoLoginEnabled = (): boolean => (process.env['NODE_ENV'] ?? 'development') !== 'production';

function localOnly(req: Request, res: Response): boolean {
  const ip = req.ip ?? '';
  const ok = devAutoLoginEnabled() && (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1');
  if (!ok) { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } }); return false; }
  return true;
}

// ── GET /dev/login?email=…&to=… — 쿠키를 심고 화면으로 보낸다 ────────────────
devAuthRouter.get('/login', async (req: Request, res: Response): Promise<void> => {
  if (!localOnly(req, res)) return;
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const email = String(req.query['email'] ?? 'master@local');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `로컬 계정 ${email} 이 없습니다` } }); return;
  }
  issueSession(res, { email: user.email, role: user.role, org_code: user.org_code }, true);
  const to = String(req.query['to'] ?? 'http://localhost:5173/admin');
  res.redirect(to.startsWith('http://localhost') ? to : 'http://localhost:5173/admin');
});
