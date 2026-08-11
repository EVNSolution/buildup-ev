/**
 * 영업 성과 조회 — /api/v1/stats/*
 *
 * ⚠️ 권한: SALES 는 **자기 것만** 본다. 서로 비교되는 숫자를 상시 노출하면
 *    견적을 부풀리거나 임시저장을 안 지우는 식으로 숫자를 만지게 된다.
 *    ADMIN 만 전체·계정별 필터를 쓴다.
 */
import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { salesStats, attentionList } from '../services/sales-stats.js';

export const statsRouter = Router();

/** 조회 대상 계정 — SALES 는 본인 고정, ADMIN 은 쿼리로 고른다(비우면 전체). */
function targetUser(req: Request): string | undefined {
  if (req.auth?.role === 'SALES') return req.auth.email;
  const q = (req.query['sales_user'] as string | undefined)?.trim();
  return q || undefined;
}

function dateOf(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ── GET /stats/sales — 계정별 깔때기·금액·활동량·속도 ──────────────────────
statsRouter.get('/sales', rbac('ADMIN', 'SALES'), async (req: Request, res): Promise<void> => {
  try {
    const data = await salesStats({
      from: dateOf(req.query['from']),
      to: dateOf(req.query['to']),
      salesUser: targetUser(req),
    });
    res.json({ data });
  } catch (e) {
    console.error('[GET /stats/sales]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '성과 집계 중 오류가 발생했습니다.' } });
  }
});

// ── GET /stats/attention — 지금 붙어야 할 건 ───────────────────────────────
statsRouter.get('/attention', rbac('ADMIN', 'SALES'), async (req: Request, res): Promise<void> => {
  try {
    res.json({ data: await attentionList(targetUser(req)) });
  } catch (e) {
    console.error('[GET /stats/attention]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '조회 중 오류가 발생했습니다.' } });
  }
});
