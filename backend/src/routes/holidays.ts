import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { fromDbDate } from '@buildup-ev/shared/schedule';

/**
 * 공휴일 달력 — **화면이 서버와 같은 달력을 쓰기 위한 창구.**
 *
 * 납기 계산은 shared 에 한 벌만 있고, 화면과 서버가 그 함수에 **같은 목록**을
 * 주입해야 답이 같아진다. 그래서 조회는 로그인한 누구나 할 수 있다 —
 * 특장사도 납기를 고르려면 달력이 필요하다.
 */
export const holidaysRouter = Router();

holidaysRouter.get('/', async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  try {
    /*
     * 범위를 좁혀 받을 수 있게 둔다. 지금은 몇십 건이라 전부 내려도 되지만,
     * 해가 쌓이면 화면이 쓰지도 않을 옛 연도를 매번 받는다.
     */
    const from = String(req.query['from'] ?? '').trim();
    const to = String(req.query['to'] ?? '').trim();
    const where: Record<string, unknown> = { active: true };
    if (/^\d{4}-\d{2}-\d{2}$/.test(from) || /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      where['day'] = {
        ...(/^\d{4}-\d{2}-\d{2}$/.test(from) ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
        ...(/^\d{4}-\d{2}-\d{2}$/.test(to) ? { lte: new Date(`${to}T00:00:00Z`) } : {}),
      };
    }
    const rows = await prisma.holiday.findMany({
      where, select: { day: true, name: true }, orderBy: { day: 'asc' },
    });
    res.json({ data: rows.map(r => ({ day: fromDbDate(r.day), name: r.name })) });
  } catch (e) {
    console.error('[GET /holidays]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '공휴일을 불러오지 못했습니다.' } });
  }
});
