/**
 * 고객 마스터 조회 — 견적 입력 시 지난 값 자동 기입용.
 *
 * ⚠️ **완전일치 1건만** 돌려준다. 부분검색·목록 엔드포인트는 만들지 않는다.
 *    이름 일부만으로 고객 목록이 나오면 남의 연락처·주소를 훑을 수 있게 된다.
 *    호출자는 성명과 생년월일(사업자번호)을 **둘 다** 알고 있어야 한다.
 */
import { Router } from 'express';
import type { Request } from 'express';
import { rbac } from '../middleware/rbac.js';
import { prisma } from '../lib/prisma.js';
import { findCustomerByKey, hasMasterKey } from '../services/customer-master.js';

export const customersRouter = Router();

// ── GET /customers/lookup?name=&reg_no= — 완전일치 1건(없으면 data: null) ──
customersRouter.get('/lookup', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { name, reg_no } = req.query as Record<string, string | undefined>;

  // 둘 중 하나라도 없으면 조회하지 않는다 — 한 값만으로 찾게 두면 사실상 목록 조회가 된다.
  if (!hasMasterKey(name, reg_no)) {
    res.status(400).json({
      error: { code: 'BAD_INPUT', message: '성명(상호)과 생년월일(사업자번호)이 모두 필요합니다' },
    });
    return;
  }

  try {
    const found = await findCustomerByKey(name!, reg_no!);
    res.json({ data: found });
  } catch (e) {
    console.error('[GET /customers/lookup]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객 조회 중 오류가 발생했습니다.' } });
  }
});
