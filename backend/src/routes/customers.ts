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
import { digitsOnly, lookupWarpCustomer } from '../services/warp-crm.js';

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

// ── GET /customers/warp-lookup?name=&phone= — WARP CRM 완전일치 조회(자동 기입, 부가 기능) ──
// 브라우저가 WARP 를 직접 부르지 않도록 여기서 프록시한다 — API 키는 서버 .env 에만 있다.
// 이름+전화 **둘 다** 완전일치해야 1건이 나온다(부분검색·목록 없음 — /lookup 과 같은 원칙).
// WARP 미설정·다운·미매칭 전부 200 { data: null } — 부가 기능이 견적 입력을 막으면 안 된다.
customersRouter.get('/warp-lookup', rbac('SALES', 'ADMIN'), async (req: Request, res): Promise<void> => {
  const { name, phone } = req.query as Record<string, string | undefined>;
  if (!name?.trim() || digitsOnly(phone).length < 9) {
    res.status(400).json({
      error: { code: 'BAD_INPUT', message: '성명과 휴대폰번호가 모두 필요합니다' },
    });
    return;
  }
  const hit = await lookupWarpCustomer(name, phone!); // 실패는 내부에서 null 로 삼킨다
  res.json({ data: hit });
});
