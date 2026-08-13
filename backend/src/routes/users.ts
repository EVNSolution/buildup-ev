import { Router } from 'express';
import type { Request } from 'express';
import { rbac, requirePermission } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword, generateTempPassword } from '../lib/password.js';
import type { Role } from '@buildup-ev/shared/types';

export const usersRouter = Router();

const ROLES = ['SALES', 'ADMIN', 'MAKER'] as const;

/**
 * 겸직 역할 입력 정리 — 유효하지 않은 값이 하나라도 있으면 null(=400).
 * 주 역할은 겸직 목록에서 지운다(한 역할이 두 자리에 있으면 해제할 때 한쪽만 지워진다).
 */
function normalizeExtraRoles(input: string[] | undefined, primary: string): Role[] | null {
  if (input === undefined) return [];
  if (!Array.isArray(input)) return null;
  if (input.some(r => !ROLES.includes(r as typeof ROLES[number]))) return null;
  return [...new Set(input)].filter(r => r !== primary) as Role[];
}

function safeUser(u: { email: string; org_code: string; role: string; extra_roles?: string[]; name: string; phone: string | null; status: string; must_change_pw: boolean; invited_by: string | null; active: boolean; is_master: boolean; created_at: Date; org?: { code: string; name: string; type: string } }) {
  return {
    email: u.email,
    org_code: u.org_code,
    role: u.role,
    extra_roles: u.extra_roles ?? [],
    name: u.name,
    phone: u.phone ?? undefined,
    status: u.status,
    must_change_pw: u.must_change_pw,
    invited_by: u.invited_by ?? undefined,
    active: u.active,
    is_master: u.is_master, // DEV: master surface switcher
    created_at: u.created_at,
    org: u.org,
  };
}

// ── GET /users ────────────────────────────────────────────────────────────

usersRouter.get('/', rbac('ADMIN'), async (_req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      include: { org: { select: { code: true, name: true, type: true } } },
    });
    res.json({ data: users.map(safeUser) });
  } catch (e) {
    console.error('[GET /users]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '사용자 목록 조회 중 오류가 발생했습니다.' } });
  }
});

// ── POST /users — 계정 발급 ───────────────────────────────────────────────

usersRouter.post('/', rbac('ADMIN'), requirePermission('account.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { email, name, role, org_code, extra_roles } = req.body as
    { email?: string; name?: string; role?: string; org_code?: string; extra_roles?: string[] };
  if (!email || !name || !role || !org_code) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'email, name, role, org_code 필수' } });
    return;
  }
  if (!['SALES', 'ADMIN', 'MAKER'].includes(role)) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 역할' } });
    return;
  }
  const extra = normalizeExtraRoles(extra_roles, role);
  if (extra === null) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 겸직 역할' } });
    return;
  }

  const tempPw = generateTempPassword();
  const hash   = await hashPassword(tempPw);

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        role: role as Role,
        extra_roles: extra,
        org_code,
        status: 'invited',
        must_change_pw: true,
        active: true,
        password_hash: hash,
        invited_by: req.auth?.email,
      },
      include: { org: { select: { code: true, name: true, type: true } } },
    });
    // temp_password returned ONCE — never stored in plaintext
    res.status(201).json({ data: { user: safeUser(user), temp_password: tempPw } });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2002') {
      res.status(409).json({ error: { code: 'CONFLICT', message: '이미 존재하는 이메일입니다.' } });
    } else {
      console.error('[POST /users]', e);
      res.status(500).json({ error: { code: 'INTERNAL', message: '계정 생성 중 오류가 발생했습니다.' } });
    }
  }
});

// ── PATCH /users/:email ───────────────────────────────────────────────────

usersRouter.patch('/:email', rbac('ADMIN'), requirePermission('account.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { email } = req.params as { email: string };
  const { role, org_code, status, extra_roles } = req.body as
    { role?: string; org_code?: string; status?: string; extra_roles?: string[] };

  const data: Record<string, unknown> = {};
  if (role)     { if (!['SALES','ADMIN','MAKER'].includes(role)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 역할' } }); return; } data['role'] = role; }
  /*
   * 겸직 역할 — 통째로 덮어쓴다(추가·삭제를 한 번에). 주 역할은 목록에서 빼 둔다:
   * 둘 다 들고 있으면 나중에 주 역할이 바뀔 때 지워야 할 자리가 두 곳이 된다.
   */
  if (extra_roles !== undefined) {
    const base = role ?? (await prisma.user.findUnique({ where: { email } }))?.role;
    const extra = normalizeExtraRoles(extra_roles, base ?? '');
    if (extra === null) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 겸직 역할' } }); return; }
    data['extra_roles'] = extra;
  } else if (role) {
    // 주 역할만 바꿀 때 — 새 주 역할이 겸직에 남아 있으면 같은 역할이 두 자리에 생긴다
    const cur = await prisma.user.findUnique({ where: { email } });
    if (cur) data['extra_roles'] = (cur.extra_roles as Role[]).filter(r => r !== role);
  }
  if (org_code) data['org_code'] = org_code;
  if (status)   { if (!['active','invited','suspended'].includes(status)) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '유효하지 않은 상태' } }); return; } data['status'] = status; }

  if (Object.keys(data).length === 0) { res.status(400).json({ error: { code: 'BAD_INPUT', message: '변경할 필드 없음' } }); return; }

  try {
    // 마스터 계정 상태 변경 금지
    if (status) {
      const target = await prisma.user.findUnique({ where: { email } });
      if (target?.is_master) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '마스터 계정 상태는 변경할 수 없습니다.' } });
        return;
      }
    }

    const user = await prisma.user.update({
      where: { email },
      data,
      include: { org: { select: { code: true, name: true, type: true } } },
    });
    res.json({ data: safeUser(user) });
  } catch (e) {
    console.error('[PATCH /users/:email]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '사용자 수정 중 오류가 발생했습니다.' } });
  }
});

// ── DELETE /users/:email ──────────────────────────────────────────────────
// ?cascade=true: is_master 전용 — 연결 데이터 전체 cascade 삭제 (테스트 정리용)
// 기본(cascade 없음): 일반 ADMIN — 참조 없는 계정만 삭제

usersRouter.delete('/:email', rbac('ADMIN'), requirePermission('account.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { email } = req.params as { email: string };
  const cascade = req.query['cascade'] === 'true';

  // 공통 가드: 본인 계정 삭제 금지
  if (email === req.auth!.email) {
    res.status(403).json({ error: { code: 'SELF_DELETE_FORBIDDEN', message: '본인 계정은 삭제할 수 없습니다.' } });
    return;
  }

  try {
    const target = await prisma.user.findUnique({ where: { email } });
    if (!target) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' } }); return; }

    // 마스터 계정 삭제 금지 (누구든)
    if (target.is_master) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '마스터 계정은 삭제할 수 없습니다.' } });
      return;
    }

    // 공통 가드: 마지막 ADMIN 삭제 금지
    if (target.role === 'ADMIN' || (target.extra_roles as Role[]).includes('ADMIN')) {
      // 겸직으로 관리자인 계정도 관리자로 센다 — 안 그러면 마지막 관리자가 지워질 수 있다
      const adminCount = await prisma.user.count({
        where: { OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }] },
      });
      if (adminCount <= 1) {
        res.status(409).json({ error: { code: 'LAST_ADMIN', message: '마지막 관리자 계정은 삭제할 수 없습니다.' } });
        return;
      }
    }

    if (cascade) {
      // is_master 전용 cascade 삭제
      if (!req.auth!.is_master) {
        res.status(403).json({ error: { code: 'FORBIDDEN', message: '강제 삭제는 마스터 관리자만 가능합니다.' } });
        return;
      }
      await prisma.$transaction(async (tx) => {
        // invited_by·created_by FK를 null로 해제
        await tx.user.updateMany({ where: { invited_by: email }, data: { invited_by: null } });
        await tx.customer.updateMany({ where: { created_by: email }, data: { created_by: null } });
        // quote → order → order_option·document cascade
        const quotes = await tx.quote.findMany({ where: { sales_user_id: email }, select: { id: true } });
        const quoteIds = quotes.map(q => q.id);
        if (quoteIds.length > 0) {
          const orders = await tx.order.findMany({ where: { quote_id: { in: quoteIds } }, select: { id: true } });
          const orderIds = orders.map(o => o.id);
          if (orderIds.length > 0) {
            await tx.document.deleteMany({ where: { order_id: { in: orderIds } } });
            await tx.orderOption.deleteMany({ where: { order_id: { in: orderIds } } });
            await tx.order.deleteMany({ where: { id: { in: orderIds } } });
          }
          await tx.quote.deleteMany({ where: { id: { in: quoteIds } } });
        }
        await tx.user.delete({ where: { email } });
      });
      res.json({ data: { ok: true } });
      return;
    }

    // 일반 삭제: FK 참조 있으면 409
    const [quoteCount, inviteeCount, customerCount] = await Promise.all([
      prisma.quote.count({ where: { sales_user_id: email } }),
      prisma.user.count({ where: { invited_by: email } }),
      prisma.customer.count({ where: { created_by: email } }),
    ]);
    if (quoteCount + inviteeCount + customerCount > 0) {
      res.status(409).json({ error: { code: 'HAS_REFERENCES', message: '관련 견적/주문이 있어 삭제할 수 없습니다. 비활성화를 사용하세요.' } });
      return;
    }
    await prisma.user.delete({ where: { email } });
    res.json({ data: { ok: true } });
  } catch (e: unknown) {
    if ((e as { code?: string }).code === 'P2003') {
      res.status(409).json({ error: { code: 'HAS_REFERENCES', message: '관련 견적/주문이 있어 삭제할 수 없습니다. 비활성화를 사용하세요.' } });
    } else {
      console.error('[DELETE /users/:email]', e);
      res.status(500).json({ error: { code: 'INTERNAL', message: '계정 삭제 중 오류가 발생했습니다.' } });
    }
  }
});

// ── POST /users/:email/reset-password ─────────────────────────────────────

usersRouter.post('/:email/reset-password', rbac('ADMIN'), requirePermission('account.manage'), async (req: Request, res): Promise<void> => {
  if (!prisma) { res.status(503).json({ error: { code: 'DB_UNAVAILABLE' } }); return; }
  const { email } = req.params as { email: string };

  const tempPw = generateTempPassword();
  const hash   = await hashPassword(tempPw);

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) { res.status(404).json({ error: { code: 'NOT_FOUND', message: '사용자를 찾을 수 없습니다.' } }); return; }

    // 마스터 비번 재설정은 마스터 본인만
    if (user.is_master && !req.auth!.is_master) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: '마스터 계정 비밀번호는 마스터 본인만 재설정할 수 있습니다.' } });
      return;
    }

    await prisma.user.update({ where: { email }, data: { password_hash: hash, must_change_pw: true } });
    // temp_password returned ONCE — never stored in plaintext
    res.json({ data: { temp_password: tempPw } });
  } catch (e) {
    console.error('[POST /users/:email/reset-password]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '비밀번호 초기화 중 오류가 발생했습니다.' } });
  }
});
