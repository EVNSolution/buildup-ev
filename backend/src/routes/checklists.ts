import { Router, type Request, type Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { CHECKLIST_STEPS, TRACK_LABEL, checklistActorOf } from '@buildup-ev/shared/process';
import { ADDON_STEPS, ADDON_TRACK_LABEL } from '@buildup-ev/shared/process/addon';
import { checklistActor } from '../services/checklist.js';

/**
 * 체크리스트 **서식** — 관리자가 단계별로 고친다.
 *
 * 규칙은 코드에 있고(어느 단계에 붙는가·누가 적는가·채워야 넘어간다),
 * 여기서 고치는 것은 **무엇을 확인하는가**뿐이다.
 *
 * ⚠️ 여기를 고치면 **제출 전** 체크리스트는 다음에 열 때 따라간다(문구가 바뀐 항목은 판정이 비워진다).
 *    **제출한** 체크리스트는 그때 항목 그대로다 — 발주서 단가와 같은 원칙이다(services/checklist syncWithTemplate).
 * ⚠️ 지우지 않는다. 끄면(`active=false`) **새로 만드는** 체크리스트에서만 빠진다.
 */
export const checklistsRouter = Router();

/**
 * 서식을 붙일 수 있는 단계 — **모든 단계**(2026-09-15). 「특장사 진행」·「부가작업 진행」 두 묶음,
 * 단계마다 켜진 항목 수를 함께 준다(0 이면 그 단계에는 체크리스트가 뜨지 않는다).
 */
checklistsRouter.get('/steps', rbac('ADMIN'), async (_req: Request, res: Response): Promise<void> => {
  const counts = prisma
    ? await prisma.checklistItem.groupBy({ by: ['step_code'], where: { active: true }, _count: { _all: true } })
    : [];
  const n = (code: string) => counts.find(c => c.step_code === code)?._count._all ?? 0;
  res.json({
    data: [
      ...CHECKLIST_STEPS.map(s => ({ group: 'maker', track: TRACK_LABEL[s.track], code: s.code, label: s.label, actor: checklistActorOf(s), count: n(s.code) })),
      ...ADDON_STEPS.map(s => ({ group: 'addon', track: ADDON_TRACK_LABEL[s.track], code: s.code, label: s.label, actor: 'ADMIN', count: n(s.code) })),
    ],
  });
});

checklistsRouter.get('/', rbac('ADMIN'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const step = String(req.query['step'] ?? '').trim();
  if (!checklistActor(step)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '체크리스트가 붙지 않는 단계입니다' } }); return;
  }
  try {
    const rows = await prisma.checklistItem.findMany({
      where: { step_code: step },
      orderBy: [{ active: 'desc' }, { seq: 'asc' }, { id: 'asc' }],
    });
    res.json({ data: rows });
  } catch (e) {
    console.error('[GET /checklists]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '체크리스트 서식을 불러오지 못했습니다.' } });
  }
});

/**
 * 서식을 통째로 저장한다 — 화면에서 줄을 더하고 지우고 순서를 바꾼 결과.
 *
 * ⚠️ 화면에서 「지운」 줄은 **끄는 것**으로 저장한다. 실제로 지우면 그 항목으로
 *    합격 처리한 옛 체크리스트가 무엇을 봤는지 되짚을 수 없다.
 */
checklistsRouter.put('/', rbac('ADMIN'), requirePermission('checklist.manage'), async (req: Request, res: Response): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } }); return; }
  const body = req.body as { step?: unknown; items?: unknown };
  const step = String(body.step ?? '').trim();
  if (!checklistActor(step)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '체크리스트가 붙지 않는 단계입니다' } }); return;
  }
  if (!Array.isArray(body.items)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '항목 목록이 필요합니다' } }); return;
  }
  type In = { id?: number; category?: string; content?: string };
  const items = (body.items as In[])
    .map((it, i) => ({
      id: typeof it.id === 'number' ? it.id : null,
      seq: i + 1,
      category: String(it.category ?? '').trim().slice(0, 60),
      content: String(it.content ?? '').trim().slice(0, 300),
    }))
    .filter(it => it.content !== '');
  if (items.some(it => it.category === '')) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '항목명(구분)을 적어야 합니다' } }); return;
  }

  const who = req.auth?.email ?? 'unknown';
  try {
    const keep = new Set(items.map(it => it.id).filter((v): v is number => v !== null));
    await prisma.$transaction(async tx => {
      // 화면에 없는 줄은 **끈다**(지우지 않는다)
      await tx.checklistItem.updateMany({
        where: { step_code: step, active: true, id: { notIn: [...keep] } },
        data: { active: false, updated_by: who },
      });
      for (const it of items) {
        if (it.id === null) {
          await tx.checklistItem.create({
            data: { step_code: step, seq: it.seq, category: it.category, content: it.content, updated_by: who },
          });
        } else {
          await tx.checklistItem.update({
            where: { id: it.id },
            data: { seq: it.seq, category: it.category, content: it.content, active: true, updated_by: who },
          });
        }
      }
    });
    const rows = await prisma.checklistItem.findMany({
      where: { step_code: step },
      orderBy: [{ active: 'desc' }, { seq: 'asc' }, { id: 'asc' }],
    });
    res.json({ data: rows });
  } catch (e) {
    console.error('[PUT /checklists]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '체크리스트 서식을 저장하지 못했습니다.' } });
  }
});
