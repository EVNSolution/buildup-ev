import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { LOCK_MODULE, mergePermissions } from '../lib/permissions.js';

export const accessControlRouter = Router();

// ── GET /access-control ───────────────────────────────────────────────────

accessControlRouter.get('/', rbac('ADMIN'), async (_req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const acs = await prisma.accessControl.findMany({ orderBy: [{ subject_type: 'asc' }, { subject_ref: 'asc' }] });
  res.json({ data: acs });
});

// ── POST /access-control — upsert ────────────────────────────────────────

accessControlRouter.post('/', rbac('ADMIN'), requirePermission('account.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { subject_type, subject_ref, module_code, enabled, memo } = req.body as {
    subject_type?: string; subject_ref?: string; module_code?: string; enabled?: boolean; memo?: string;
  };
  if (!subject_type || !subject_ref || !module_code || enabled === undefined) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'subject_type, subject_ref, module_code, enabled 필수' } });
    return;
  }

  // 마스터 유저의 모듈은 항상 전체 ON — 변경 금지
  if (subject_type === 'user') {
    const target = await prisma.user.findUnique({ where: { email: subject_ref } });
    if (target?.is_master) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '마스터 계정의 모듈은 변경할 수 없습니다.' } });
      return;
    }
  }

  /*
   * **자기 손으로 문을 잠그지 못하게 한다.**
   *
   * `account.manage` 를 끄면 「계정 관리」·「기능모듈」 탭이 **함께** 사라진다.
   * 되돌릴 화면이 없어지고, 운영에서는 마스터 우회도 꺼져 있어 아무도 복구할 수 없다.
   * 실제로 그렇게 막힌 적이 있다.
   *
   * 무조건 막지는 않는다 — **바꾼 뒤 내 권한을 실제로 계산해** 내가 잃을 때만 거절한다.
   * 겸직으로 다른 역할이 켜 두었다면 잃지 않으므로 그대로 통과한다.
   */
  if (module_code === LOCK_MODULE && enabled === false) {
    const me = req.auth!;
    const acs = await prisma.accessControl.findMany({
      where: { OR: [{ subject_type: 'role', subject_ref: { in: me.roles } }, { subject_type: 'user', subject_ref: me.email }] },
    });
    const after = acs.filter(a => !(a.subject_type === subject_type && a.subject_ref === subject_ref && a.module_code === module_code));
    after.push({ subject_type, subject_ref, module_code, enabled: false } as (typeof acs)[number]);
    if (!mergePermissions(me.roles, me.email, after, me).includes(LOCK_MODULE)) {
      res.status(400).json({
        error: {
          code: 'WOULD_LOCK_OUT',
          message: `이 설정을 끄면 본인이 '${LOCK_MODULE}' 권한을 잃어 계정 관리·기능모듈 탭이 사라집니다. 되돌릴 수 없어 막았습니다.`,
        },
      });
      return;
    }
  }

  const ac = await prisma.accessControl.upsert({
    where: { subject_type_subject_ref_module_code: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code } },
    update: { enabled, memo },
    create: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code, enabled, memo },
  });
  res.json({ data: ac });
});
