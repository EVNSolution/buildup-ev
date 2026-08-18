/**
 * 외부 시스템(WARP CRM) 전용 서버 간 API — 역방향 고객 수집(#191).
 *
 * WARP 고객관리의 「buildup에서 불러오기」가 여기서 고객 목록을 가져가고,
 * 승인 후 연결(warp_customer_id)을 되돌려 적는다.
 *
 * 인증: `x-api-key` 공유 비밀키. WARP 조회(warp-crm.ts)에 쓰는 **같은 키**(env
 * WARP_API_KEY)를 역방향 검증에도 쓴다 — 신뢰 쌍이 같으니 키를 늘리지 않는다.
 * SHA-256 후 timingSafeEqual 상수시간 비교 (WARP 쪽과 동일 규약).
 *
 * ⚠️ DTO 는 화이트리스트다. created_by(사내 계정 이메일) 등 내부 정보는 내보내지 않는다.
 */
import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '../lib/prisma.js';

export const externalRouter = Router();

/** 상수시간 키 비교 — 길이가 달라도 안전하게. */
export function safeKeyEqual(expected: string, provided: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

/** 키 미설정 503(기능 꺼짐) / 불일치 401 — 키 문제와 설정 문제를 구분해 준다. */
function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = (process.env['WARP_API_KEY'] ?? '').trim();
  if (!expected) {
    res.status(503).json({ error: { code: 'NOT_CONFIGURED', message: '연동 키가 설정되지 않았습니다' } });
    return;
  }
  const provided = req.header('x-api-key') ?? '';
  if (!provided || !safeKeyEqual(expected, provided)) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: '인증 실패' } });
    return;
  }
  next();
}

externalRouter.use(requireApiKey);

/** 외부(WARP)로 내보내는 고객 필드 — 이 목록 밖의 값은 싣지 않는다. */
const EXPORT_SELECT = {
  id: true, name: true, ceo_name: true, email: true, phone: true, tel: true,
  address: true, address_detail: true, reg_no: true, warp_customer_id: true,
  created_at: true, updated_at: true,
} as const;

/** 한 번에 내보내는 최대 행 수 — 그 이상이면 호출측이 since 로 이어서 받는다. */
const EXPORT_LIMIT = 500;

// ── GET /customers?since=ISO8601 — 생성·수정분 export (updated_at 오름차순) ──
externalRouter.get('/customers', async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const { since } = req.query as Record<string, string | undefined>;
  let sinceDate: Date | undefined;
  if (since !== undefined) {
    sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      res.status(400).json({ error: { code: 'BAD_INPUT', message: 'since 는 ISO8601 형식이어야 합니다' } });
      return;
    }
  }
  try {
    const customers = await prisma.customer.findMany({
      where: sinceDate ? { updated_at: { gt: sinceDate } } : undefined,
      orderBy: { updated_at: 'asc' },
      take: EXPORT_LIMIT,
      select: EXPORT_SELECT,
    });
    res.json({ data: customers, has_more: customers.length === EXPORT_LIMIT });
  } catch (e) {
    console.error('[GET /external/customers]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '고객 export 중 오류' } });
  }
});

// ── POST /customers/link — WARP 승인 후 연결 write-back ──
// body: { links: [{ id: number, warp_customer_id: string }] }
externalRouter.post('/customers/link', async (req: Request, res): Promise<void> => {
  if (!prisma) {
    res.status(503).json({ error: { code: 'DB_UNAVAILABLE', message: 'DB 연결 필요' } });
    return;
  }
  const links = (req.body as { links?: unknown })?.links;
  const valid = Array.isArray(links)
    && links.length > 0
    && links.length <= EXPORT_LIMIT
    && links.every((l): l is { id: number; warp_customer_id: string } =>
      typeof l === 'object' && l !== null
      && Number.isInteger((l as { id?: unknown }).id)
      && typeof (l as { warp_customer_id?: unknown }).warp_customer_id === 'string'
      && (l as { warp_customer_id: string }).warp_customer_id.length > 0
      && (l as { warp_customer_id: string }).warp_customer_id.length <= 40);
  if (!valid) {
    res.status(400).json({ error: { code: 'BAD_INPUT', message: 'links 배열이 필요합니다' } });
    return;
  }
  try {
    // 존재하지 않는 id 는 조용히 0건 갱신 — 부분 성공을 updated 수로 알린다
    const results = await prisma.$transaction(
      links.map(l => prisma!.customer.updateMany({
        where: { id: l.id },
        data: { warp_customer_id: l.warp_customer_id },
      })),
    );
    const updated = results.reduce((n, r) => n + r.count, 0);
    console.info(`[external] warp 연결 write-back: 요청 ${links.length}건 → 갱신 ${updated}건`);
    res.json({ data: { updated } });
  } catch (e) {
    console.error('[POST /external/customers/link]', e);
    res.status(500).json({ error: { code: 'INTERNAL', message: '연결 저장 중 오류' } });
  }
});
