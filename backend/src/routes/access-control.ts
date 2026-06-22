import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';

export const accessControlRouter = Router();

// ── GET /access-control ───────────────────────────────────────────────────

accessControlRouter.get('/', rbac('ADMIN'), async (_req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const acs = await prisma.accessControl.findMany({ orderBy: [{ subject_type: 'asc' }, { subject_ref: 'asc' }] });
  res.json({ data: acs });
});

// ── POST /access-control — upsert ────────────────────────────────────────

accessControlRouter.post('/', rbac('ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { subject_type, subject_ref, module_code, enabled, memo } = req.body as {
    subject_type?: string; subject_ref?: string; module_code?: string; enabled?: boolean; memo?: string;
  };
  if (!subject_type || !subject_ref || !module_code || enabled === undefined) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'subject_type, subject_ref, module_code, enabled 필수' } });
    return;
  }

  const ac = await prisma.accessControl.upsert({
    where: { subject_type_subject_ref_module_code: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code } },
    update: { enabled, memo },
    create: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code, enabled, memo },
  });
  res.json({ data: ac });
});
