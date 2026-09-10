import { Router, type Request } from 'express';
import { prisma } from '../lib/prisma.js';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { invalidateHolidays } from '../services/holidays.js';
import { draftYear } from '../services/holiday-import.js';
import { fromDbDate } from '@buildup-ev/shared/schedule';

/**
 * 공휴일 달력 — **화면이 서버와 같은 달력을 쓰기 위한 창구.**
 *
 * 납기 계산은 shared 에 한 벌만 있고, 화면과 서버가 그 함수에 **같은 목록**을
 * 주입해야 답이 같아진다. 그래서 조회는 **로그인한** 누구나 할 수 있다 —
 * 특장사도 납기를 고르려면 달력이 필요하다.
 *
 * ⚠️ 공휴일은 비밀이 아니지만 **문을 열어 두지는 않는다.** 인증 없이 DB 를 두드릴 수
 *    있는 자리를 만들면, 지금은 무해해도 다음에 무엇이 붙을지 모른다. 다른 API 와
 *    같은 규칙을 쓴다(배포하고 나서 열려 있는 것을 발견했다).
 */
export const holidaysRouter = Router();

holidaysRouter.get('/', rbac('ADMIN', 'SALES', 'MAKER'), async (req: Request, res): Promise<void> => {
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

// ── 관리 ─────────────────────────────────────────────────────────────────────

/**
 * 그 해의 **전부** — 꺼 둔 날까지. 관리 화면이 쓴다.
 *
 * 조회용 `GET /` 는 켜진 것만 주고, 여기는 끈 것도 준다. 껐다는 사실 자체가
 * 「이 날은 안 쉰다고 정했다」는 기록이라 화면에서 보여야 한다.
 */
holidaysRouter.get('/admin', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const year = Number(req.query['year']);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '연도를 YYYY 로 보내야 합니다' } }); return;
  }
  try {
    const rows = await prisma.holiday.findMany({
      where: { day: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
      orderBy: { day: 'asc' },
    });
    res.json({
      data: rows.map(r => ({
        day: fromDbDate(r.day), name: r.name, source: r.source, active: r.active,
        memo: r.memo, updated_by: r.updated_by, updated_at: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[GET /holidays/admin]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '공휴일을 불러오지 못했습니다.' } });
  }
});

/**
 * 바깥에서 그 해를 받아 온다 — **초안이다. 저장하지 않는다.**
 *
 * 무료 소스는 한국 공휴일을 틀리게 주는 일이 있어(2026년 제헌절) 화면이 보여 주고
 * 사람이 골라 저장한다. 서비스키(`HOLIDAY_API_KEY`)가 있으면 행정안전부 특일정보를 쓴다.
 */
holidaysRouter.get('/import', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  const year = Number(req.query['year']);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '연도를 YYYY 로 보내야 합니다' } }); return;
  }
  try {
    res.json({ data: await draftYear(year) });
  } catch (e) {
    console.error('[GET /holidays/import]', e);
    res.status(502).json({ error: { code: 'UPSTREAM', message: '공휴일을 받아 오지 못했습니다. 직접 적어 주세요.' } });
  }
});

/**
 * 그 해를 저장한다 — 화면에 있는 그대로.
 *
 * ⚠️ 화면에서 뺀 날은 **끄는 것**으로 저장한다. 지우면 「이 날은 안 쉰다고 정했다」는
 *    판단이 사라져, 다음에 누가 다시 넣는다.
 */
holidaysRouter.put('/', rbac('ADMIN'), requirePermission('basedata.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const body = req.body as { year?: unknown; days?: unknown };
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '연도를 YYYY 로 보내야 합니다' } }); return;
  }
  if (!Array.isArray(body.days)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '날짜 목록이 필요합니다' } }); return;
  }
  type In = { day?: string; name?: string; memo?: string; source?: string };
  const days = (body.days as In[])
    .map(d => ({
      day: String(d.day ?? '').trim(),
      name: String(d.name ?? '').trim().slice(0, 60),
      memo: d.memo ? String(d.memo).trim().slice(0, 200) : null,
      source: d.source === 'api' ? 'api' : 'manual',
    }))
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d.day) && d.day.startsWith(String(year)) && d.name !== '');
  const dup = days.map(d => d.day).filter((v, i, a) => a.indexOf(v) !== i);
  if (dup.length) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: `같은 날짜가 두 번 있습니다: ${dup[0]}` } }); return;
  }

  const who = req.auth?.email ?? 'unknown';
  try {
    const keep = new Set(days.map(d => d.day));
    const existing = await prisma.holiday.findMany({
      where: { day: { gte: new Date(`${year}-01-01T00:00:00Z`), lte: new Date(`${year}-12-31T00:00:00Z`) } },
      select: { day: true },
    });
    for (const e of existing) {
      if (!keep.has(fromDbDate(e.day))) {
        // 지우지 않고 끈다 — 「안 쉬는 날로 정했다」도 기록이다
        await prisma.holiday.update({ where: { day: e.day }, data: { active: false, updated_by: who } });
      }
    }
    for (const d of days) {
      const day = new Date(`${d.day}T00:00:00Z`);
      await prisma.holiday.upsert({
        where: { day },
        update: { name: d.name, memo: d.memo, source: d.source, active: true, updated_by: who },
        create: { day, name: d.name, memo: d.memo, source: d.source, active: true, updated_by: who },
      });
    }
    // 다음 계산부터 새 달력을 쓴다 — 고치고 나서 반영을 기다리게 하지 않는다
    invalidateHolidays();
    res.json({ data: { saved: days.length } });
  } catch (e) {
    console.error('[PUT /holidays]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '공휴일을 저장하지 못했습니다.' } });
  }
});
