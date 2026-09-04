/**
 * permissions 머지 단위 테스트 + org 격리 stub 테스트
 *
 * 검증 포인트:
 * 1. 역할 기본값만 있을 때 정상 반환
 * 2. 계정 override가 역할 기본값보다 우선
 * 3. GET /auth/me — 역할·조직·권한 포함 응답
 * 4. GET /me/permissions — 활성 모듈코드 배열
 * 5. org 격리 stub — SALES/MAKER는 orgScope 통과, 인증 없으면 403
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { mergePermissions } from '../lib/permissions.js';
import { canSeeQuotePrices, isAdmin, masterBypassEnabled, ownOrgOnly, requirePermission } from '../middleware/rbac.js';
import type { AuthContext } from '../middleware/rbac.js';
import type { AccessControl } from '@buildup-ev/shared/types';
import { authCookie } from './helpers.js';

// ── 단위 테스트용 AC 픽스처 (8모듈 기준) ──────────────────────────────
const ROLE_ACS: AccessControl[] = [
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'quote.create',    enabled: true },
  { subject_type: 'role', subject_ref: 'SALES', module_code: 'order.view',      enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.confirm',   enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'view.all',        enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.view',      enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'order.control',   enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'subsidy.manage',  enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'account.manage',  enabled: true },
  { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'doc.view',        enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'order.view',      enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'order.control',   enabled: true },
  { subject_type: 'role', subject_ref: 'MAKER', module_code: 'doc.view',        enabled: true },
  { subject_type: 'user', subject_ref: 'sales1@evnsolution.com', module_code: 'order.view', enabled: false, memo: '개별 차단 예시' },
];

// ── 단위 테스트: mergePermissions ──────────────────────────────────────

describe('mergePermissions — 권한 머지 로직', () => {
  it('SALES 역할 기본 모듈 2개 반환', () => {
    const perms = mergePermissions('SALES', 'unknown@test.com', ROLE_ACS);
    expect(perms).toContain('quote.create');
    expect(perms).toContain('order.view');
    expect(perms).not.toContain('order.confirm');
    expect(perms).not.toContain('doc.view');
  });

  it('ADMIN 역할 기본 모듈 7개 반환', () => {
    const perms = mergePermissions('ADMIN', 'unknown@test.com', ROLE_ACS);
    expect(perms).toContain('order.confirm');
    expect(perms).toContain('view.all');
    expect(perms).toContain('order.view');
    expect(perms).toContain('order.control');
    expect(perms).toContain('subsidy.manage');
    expect(perms).toContain('account.manage');
    expect(perms).toContain('doc.view');
    expect(perms).not.toContain('quote.create');
  });

  it('MAKER 역할 기본 모듈 3개 반환', () => {
    const perms = mergePermissions('MAKER', 'unknown@test.com', ROLE_ACS);
    expect(perms).toContain('order.view');
    expect(perms).toContain('order.control');
    expect(perms).toContain('doc.view');
    expect(perms).not.toContain('quote.create');
    expect(perms).not.toContain('order.confirm');
  });

  it('계정 override가 역할 기본값보다 우선 — sales1의 order.view 차단', () => {
    const perms = mergePermissions('SALES', 'sales1@evnsolution.com', ROLE_ACS);
    expect(perms).not.toContain('order.view');
  });

  it('override 없는 SALES 계정 — 역할 기본값 그대로', () => {
    const perms = mergePermissions('SALES', 'other@evnsolution.com', ROLE_ACS);
    expect(perms).toContain('quote.create');
    expect(perms).not.toContain('order.confirm');
  });

  // ── 겸직(여러 역할) ──────────────────────────────────────────────────
  it('관리+영업 겸직 — 두 역할의 모듈을 합쳐서 가진다', () => {
    const perms = mergePermissions(['ADMIN', 'SALES'], 'both@evnsolution.com', ROLE_ACS);
    expect(perms).toContain('quote.create');   // 영업 쪽
    expect(perms).toContain('account.manage'); // 관리 쪽
    expect(perms).toContain('order.view');
  });

  it('겸직 — 한 역할이 껐어도 다른 역할이 켰으면 켜진 것으로 본다', () => {
    const acs: AccessControl[] = [
      ...ROLE_ACS,
      { subject_type: 'role', subject_ref: 'ADMIN', module_code: 'quote.create', enabled: false },
    ];
    // 영업 역할로 준 quote.create 를 관리 역할의 끔이 되돌리면, 겸직을 준 의미가 없다
    expect(mergePermissions(['ADMIN', 'SALES'], 'both@evnsolution.com', acs)).toContain('quote.create');
    expect(mergePermissions(['SALES', 'ADMIN'], 'both@evnsolution.com', acs)).toContain('quote.create');
  });

  it('겸직이어도 계정 override 는 마지막 말 — 막으면 막힌다', () => {
    const acs: AccessControl[] = [
      ...ROLE_ACS,
      { subject_type: 'user', subject_ref: 'both@evnsolution.com', module_code: 'quote.create', enabled: false },
    ];
    expect(mergePermissions(['ADMIN', 'SALES'], 'both@evnsolution.com', acs)).not.toContain('quote.create');
  });

  it('역할 하나를 배열로 줘도 결과가 같다 — 호출부가 갈리지 않는다', () => {
    expect(mergePermissions(['SALES'], 'x@test.com', ROLE_ACS).sort())
      .toEqual(mergePermissions('SALES', 'x@test.com', ROLE_ACS).sort());
  });
});

// ── 금액 노출 자격 ────────────────────────────────────────────────────
//
// 특장사에게 견적 금액(공급가·실구매가)이 나가면 안 된다. 위탁 범위(개인정보 처리방침)
// 밖이고, 특장사는 원가 협상 상대라 우리 마진이 그대로 드러난다.
// 예전에 주문 **목록**만 이 판정을 빠뜨려 응답에 금액이 실려 나갔다 — 그 재발을 막는다.

const ctx = (roles: AuthContext['roles'], extra: Partial<AuthContext> = {}): AuthContext => ({
  email: 'x@evnsolution.com', role: roles[0]!, roles, org_code: 'ORG_X', ...extra,
});

describe('canSeeQuotePrices — 금액을 볼 자격', () => {
  it('특장사만 있는 계정은 금액을 볼 수 없다', () => {
    expect(canSeeQuotePrices(ctx(['MAKER']))).toBe(false);
  });

  it('관리자·영업은 볼 수 있다', () => {
    expect(canSeeQuotePrices(ctx(['ADMIN']))).toBe(true);
    expect(canSeeQuotePrices(ctx(['SALES']))).toBe(true);
  });

  it('겸직 — 특장사라도 영업·관리자를 겸하면 볼 수 있다', () => {
    expect(canSeeQuotePrices(ctx(['MAKER', 'SALES']))).toBe(true);
    expect(canSeeQuotePrices(ctx(['MAKER', 'ADMIN']))).toBe(true);
  });

  it('로컬 개발의 마스터 계정은 볼 수 있다', () => {
    expect(canSeeQuotePrices(ctx(['MAKER'], { is_master: true }))).toBe(true);
  });

  it('자료 범위 판정과 어긋나지 않는다 — 순수 특장사는 자기 org 만·금액 없음', () => {
    const maker = ctx(['MAKER']);
    expect(ownOrgOnly(maker)).toBe(true);
    expect(isAdmin(maker)).toBe(false);
    expect(canSeeQuotePrices(maker)).toBe(false);
  });
});

describe('운영 권한 경계', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('🔴 마스터는 운영에서도 통과한다 — 마스터가 아니면 표시만으로 통과하지 못한다', () => {
    /*
     * 규칙이 바뀌었다. 한동안 운영에서는 마스터도 우회하지 않았는데, 그러자 운영의
     * 마스터 계정에서 「옵션DB」·「무게상수」 탭이 보이지 않았다(제보). 시스템 주인이
     * 자기 시스템의 일부를 못 보는 상태였다.
     *
     * 실제 마스터는 `rolesOf` 로 세 역할을 모두 갖는다 — 아래처럼 역할 하나만 준
     * 마스터는 시험을 위한 모양이고, 그 경우에도 통과하는 것이 지금의 규칙이다.
     *
     * ⚠️ 넓어지는 것은 **마스터에게만**이다. 마스터가 아닌 계정은 환경과 무관하게
     *    역할과 소유로만 판단한다 — 그 경계는 그대로다.
     */
    vi.stubEnv('NODE_ENV', 'production');
    const masterMaker = ctx(['MAKER'], { is_master: true });
    expect(masterBypassEnabled(masterMaker)).toBe(true);

    const plainMaker = ctx(['MAKER']);
    expect(masterBypassEnabled(plainMaker)).toBe(false);
    expect(isAdmin(plainMaker)).toBe(false);
    expect(canSeeQuotePrices(plainMaker)).toBe(false);
  });

  it('권한 저장소 조회 실패는 503으로 닫고 다음 핸들러를 실행하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ALLOW_TEST_PERMISSION_BYPASS', 'false');
    const req = { auth: ctx(['ADMIN']) } as Parameters<ReturnType<typeof requirePermission>>[0];
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const next = vi.fn();
    const middleware = requirePermission('account.manage', async () => {
      throw new Error('permission store unavailable');
    });

    await middleware(req, { status } as never, next);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      error: { code: 'PERMISSION_UNAVAILABLE', message: '권한 확인을 사용할 수 없습니다.' },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

// ── API 통합 테스트 (JWT 쿠키, DB 필요 없음 — NODE_ENV=test 경로) ────────

describe('GET /api/v1/auth/me — JWT 인증 (test mode DB skip)', () => {
  const app = createApp();

  it('인증 없음 → 403', async () => {
    await request(app).get('/api/v1/auth/me').expect(403);
  });

  it('ADMIN 쿠키 → 503(DB없음) 또는 200', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', authCookie('admin@evnsolution.com', 'ADMIN', 'ORG_HQ'));
    // DB 없으면 503, 있으면 200 또는 404
    expect([200, 404, 503]).toContain(res.status);
  });

  it('SALES 쿠키 → 503(DB없음) 또는 200', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', authCookie('sales1@evnsolution.com', 'SALES', 'ORG_HQ'));
    expect([200, 404, 503]).toContain(res.status);
  });
});

// ── org 격리 stub 테스트 ──────────────────────────────────────────────

describe('orders RBAC — 인증·권한 검증', () => {
  const app = createApp();

  it('쿠키 없는 GET /orders/:id → 403', async () => {
    await request(app).get('/api/v1/orders/1').expect(403);
  });

  it('SALES — GET /orders/:id RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('Cookie', authCookie('sales1@evnsolution.com', 'SALES', 'ORG_HQ'));
    expect(res.status).not.toBe(403);
  });

  it('MAKER — GET /orders/:id RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('Cookie', authCookie('maker1@partner.com', 'MAKER', 'ORG_BRAIN'));
    expect(res.status).not.toBe(403);
  });

  it('ADMIN — PATCH /orders/:id/status RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/1/status')
      .set('Cookie', authCookie('admin@evnsolution.com', 'ADMIN', 'ORG_HQ'))
      .send({ status: '구조변경' });
    expect(res.status).not.toBe(403);
  });
});
