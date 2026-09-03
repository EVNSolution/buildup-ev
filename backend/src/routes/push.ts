/**
 * 웹 푸시 구독 관리.
 *
 * 기기 하나가 구독 하나다 — 같은 사람이 폰과 PC 를 각각 등록할 수 있다.
 * `endpoint` 가 곧 기기 식별자라 유니크로 잡고, 다시 등록하면 덮어쓴다.
 *
 * ⚠️ 공개키만 내보낸다. 비밀키는 서버 밖으로 나가지 않는다.
 */
import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { rbac } from '../middleware/rbac.js';
import { pushEnabled, publicKey } from '../services/push.js';

export const pushRouter = Router();

/** 화면이 구독을 시작하기 전에 물어본다 — 꺼져 있으면 버튼 자체를 안 띄운다 */
pushRouter.get('/config', rbac('ADMIN', 'SALES', 'MAKER'), (_req: Request, res: Response): void => {
  res.json({ data: { enabled: pushEnabled(), publicKey: publicKey() } });
});

pushRouter.post('/subscribe', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const b = (req.body ?? {}) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const endpoint = String(b.endpoint ?? '').trim();
  const p256dh = String(b.keys?.p256dh ?? '').trim();
  const auth = String(b.keys?.auth ?? '').trim();
  if (!endpoint || !p256dh || !auth) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '구독 정보가 올바르지 않습니다' } });
    return;
  }
  const ua = String(req.headers['user-agent'] ?? '').slice(0, 300);
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { user_email: req.auth!.email, endpoint, p256dh, auth, user_agent: ua },
    // 기기를 다른 사람이 쓰게 됐을 수도 있다 — 주인을 지금 로그인한 사람으로 옮긴다
    update: { user_email: req.auth!.email, p256dh, auth, user_agent: ua },
  });
  res.status(201).json({ data: { ok: true } });
});

pushRouter.post('/unsubscribe', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결이 필요합니다' } }); return; }
  const endpoint = String((req.body as { endpoint?: string })?.endpoint ?? '').trim();
  if (endpoint) await prisma.pushSubscription.deleteMany({ where: { endpoint, user_email: req.auth!.email } });
  res.json({ data: { ok: true } });
});
