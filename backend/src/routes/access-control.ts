import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { LOCK_MODULE, mergePermissions } from '../lib/permissions.js';
import { rolesOf, type Role } from '@buildup-ev/shared/types';

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

  /*
   * **역할 토글은 「앞으로 만들 계정의 기본값」이다** — 이미 있는 계정은 건드리지 않는다.
   *
   * 예전에는 역할 값을 켜고 끄면 그 역할을 가진 **모든 계정이 즉시 함께** 바뀌었다.
   * 새 기능을 열어 주려고 역할을 켰을 뿐인데, 일부러 꺼 두었던 계정까지 함께 열렸다.
   * 반대로 끄면 잘 쓰던 사람들의 화면이 한꺼번에 사라졌다.
   *
   * 그래서 바꾸기 **직전에** 각 계정이 지금 무엇을 갖고 있는지 계산해 계정별 값으로
   * 굳혀 둔다. 그러면 역할 값이 바뀌어도 그들의 결과는 그대로다 —
   * 계정별 값이 마지막 말이기 때문이다(`mergePermissions`).
   *
   * ⚠️ 이미 계정별 값이 있는 사람은 **덮어쓰지 않는다.** 그건 누군가 손으로 정해 둔
   *    결정이고, 역할을 만지는 김에 지워 버릴 것이 아니다.
   * ⚠️ 마스터는 굳히지 않는다 — 어차피 모든 모듈을 갖는다.
   */
  if (subject_type === 'role') {
    const [users, sameModule] = await Promise.all([
      prisma.user.findMany({ select: { email: true, role: true, extra_roles: true, is_master: true } }),
      prisma.accessControl.findMany({ where: { module_code } }),
    ]);
    const hasOwnRow = new Set(
      sameModule.filter(a => a.subject_type === 'user').map(a => a.subject_ref),
    );
    const frozen = users
      // 이 역할을 가진 계정만 영향을 받는다 — 나머지는 굳힐 이유가 없다
      .filter(u => !u.is_master && !hasOwnRow.has(u.email)
        && rolesOf({ role: u.role as Role, extra_roles: u.extra_roles as Role[], is_master: u.is_master })
          .includes(subject_ref as Role))
      .map(u => ({
        subject_type: 'user' as const,
        subject_ref: u.email,
        module_code,
        enabled: mergePermissions(
          rolesOf({ role: u.role as Role, extra_roles: u.extra_roles as Role[], is_master: u.is_master }),
          u.email, sameModule, { is_master: u.is_master },
        ).includes(module_code),
        memo: '역할 기본값 변경 시점의 상태를 유지',
      }));
    if (frozen.length > 0) {
      await prisma.accessControl.createMany({ data: frozen, skipDuplicates: true });
    }
  }

  const ac = await prisma.accessControl.upsert({
    where: { subject_type_subject_ref_module_code: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code } },
    update: { enabled, memo },
    create: { subject_type: subject_type as 'role' | 'user', subject_ref, module_code, enabled, memo },
  });
  res.json({ data: ac });
});
