import { Router } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { MODULE_BY_CODE } from '@buildup-ev/shared/rbac/modules';

export const featureModulesRouter = Router();

/**
 * 기능모듈 목록 — **이름·설명·묶음은 카탈로그(shared/rbac/modules)에서** 온다.
 *
 * DB 의 `feature_module` 은 권한 행이 가리키는 **자리**일 뿐이다. 이름을 DB 에 두면
 * 화면 글자를 고치려고 마이그레이션을 써야 하고, 실제로 이름과 설명이 세 곳으로 갈라져
 * 서로 어긋났다(2026-09-16 전수조사).
 *
 * 물러난 모듈(`retired`)은 내려보내지 않는다 — 켜고 끌 수 없는 것이 목록에 있으면
 * 「이걸 켜면 뭐가 되나」를 계속 묻게 된다.
 */
featureModulesRouter.get('/', rbac('ADMIN'), async (_req, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const rows = await prisma.featureModule.findMany({ select: { code: true } });
  const data = rows
    .map(r => MODULE_BY_CODE[r.code])
    .filter((m): m is NonNullable<typeof m> => !!m && !m.retired)
    // 카탈로그에 적힌 차례대로 — 번호를 따로 매기지 않는다(매기면 겹친다)
    .sort((a, b) => Object.keys(MODULE_BY_CODE).indexOf(a.code) - Object.keys(MODULE_BY_CODE).indexOf(b.code))
    .map(m => ({ code: m.code, name: m.name, desc: m.desc, group: m.group, surface: m.surfaces.join(',') }));
  res.json({ data });
});
