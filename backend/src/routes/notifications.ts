/**
 * 알림함 — **자기 알림만** 본다.
 *
 * 헤더의 종 아이콘이 쓴다. 안 읽은 개수(빨간 점)·목록·하나 읽음·모두 읽음.
 * 받는 사람을 고르는 규칙은 보내는 쪽(services/push.ts `notify`)에 있고, 여기서는 주인만 따진다.
 * 지우는 경로는 없다 — 읽으면 `read_at` 만 찍는다.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';

export const notificationsRouter = Router();

const PAGE_MAX = 50;

// ── GET /notifications?before=<id>&limit=<n> — 최신부터 ──────────────────────
notificationsRouter.get('/', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const email = req.auth!.email;
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(req.query['limit']) || 30));
  const before = Number(req.query['before']);
  const rows = await prisma.notification.findMany({
    where: { user_email: email, ...(Number.isFinite(before) && before > 0 ? { id: { lt: before } } : {}) },
    orderBy: { id: 'desc' },
    take: limit + 1,
    select: { id: true, title: true, body: true, url: true, created_at: true, read_at: true },
  });
  const unread = await prisma.notification.count({ where: { user_email: email, read_at: null } });
  const page = rows.slice(0, limit);
  res.json({
    data: page,
    unread,
    // 더 있으면 다음 페이지 기준 — 「더 보기」
    next_before: rows.length > limit ? page[page.length - 1]!.id : null,
  });
});

// ── GET /notifications/unread-count — 빨간 점 ──────────────────────────────
notificationsRouter.get('/unread-count', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const unread = await prisma.notification.count({ where: { user_email: req.auth!.email, read_at: null } });
  res.json({ data: { unread } });
});

// ── POST /notifications/read-all — 모두 읽음 ───────────────────────────────
notificationsRouter.post('/read-all', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const r = await prisma.notification.updateMany({
    where: { user_email: req.auth!.email, read_at: null },
    data: { read_at: new Date() },
  });
  res.json({ data: { updated: r.count, unread: 0 } });
});

// ── POST /notifications/:id/read — 하나 읽음(눌러서 열 때) ──────────────────
notificationsRouter.post('/:id/read', rbac('SALES', 'ADMIN', 'MAKER'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const id = Number(req.params['id']);
  if (!Number.isInteger(id)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 알림 id' } }); return; }
  const email = req.auth!.email;
  /*
   * 주인 조건을 **쓰기에 함께** 건다 — 남의 알림 id 를 넣어도 아무것도 바뀌지 않는다.
   * 이미 읽은 것은 처음 읽은 시각을 덮어쓰지 않는다.
   */
  const r = await prisma.notification.updateMany({
    where: { id, user_email: email, read_at: null },
    data: { read_at: new Date() },
  });
  if (r.count === 0) {
    const mine = await prisma.notification.findFirst({ where: { id, user_email: email }, select: { id: true } });
    if (!mine) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '알림을 찾을 수 없습니다' } }); return; }
  }
  const unread = await prisma.notification.count({ where: { user_email: email, read_at: null } });
  res.json({ data: { unread } });
});
