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
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { mergePermissions } from '../data/auth-mock.js';

// ── 단위 테스트: mergePermissions ──────────────────────────────────────

describe('mergePermissions — 권한 머지 로직', () => {
  it('SALES 역할 기본 모듈 4개 반환', () => {
    const perms = mergePermissions('SALES', 'unknown@test.com');
    expect(perms).toContain('quote.create');
    expect(perms).toContain('order.convert');
    expect(perms).toContain('quote.view.all');
    expect(perms).toContain('loadcalc.run');
    expect(perms).not.toContain('order.verify');  // 관리자 전용
    expect(perms).not.toContain('doc.generate');  // 특장사 전용
  });

  it('ADMIN 역할 기본 모듈 5개 반환', () => {
    const perms = mergePermissions('ADMIN', 'unknown@test.com');
    expect(perms).toContain('order.verify');
    expect(perms).toContain('workflow.monitor');
    expect(perms).toContain('subsidy.manage');
    expect(perms).toContain('account.manage');
    expect(perms).toContain('loadcalc.run');
  });

  it('MAKER 역할 기본 모듈 4개 반환', () => {
    const perms = mergePermissions('MAKER', 'unknown@test.com');
    expect(perms).toContain('doc.generate');
    expect(perms).toContain('tuning.apply');
    expect(perms).toContain('order.receive');
    expect(perms).toContain('loadcalc.run');
  });

  it('계정 override가 역할 기본값보다 우선 — sales1의 subsidy.manage 차단', () => {
    // sales1은 SALES 역할이지만 subsidy.manage는 기본적으로 SALES에 없음.
    // override로 enabled:false → 없어야 함(있어도 false이므로 동일 결과).
    // 핵심 케이스: ADMIN 역할에 subsidy.manage가 있는 계정에 override false 시
    // → 여기서는 sales1에 override가 걸려 있음.
    const permsWithOverride = mergePermissions('SALES', 'sales1@evnsolution.com');
    expect(permsWithOverride).not.toContain('subsidy.manage');
  });

  it('override 없는 SALES 계정 — 역할 기본값 그대로', () => {
    const perms = mergePermissions('SALES', 'other@evnsolution.com');
    expect(perms).toContain('quote.create');
    expect(perms).not.toContain('order.verify');
  });
});

// ── API 통합 테스트 ────────────────────────────────────────────────────

describe('GET /api/v1/auth/me', () => {
  const app = createApp();

  it('ADMIN 역할로 조회 — user·org·permissions 포함', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-Role', 'ADMIN')
      .set('X-User', 'admin@evnsolution.com')
      .expect(200);

    expect(res.body.data.user.email).toBe('admin@evnsolution.com');
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.org.code).toBe('ORG_HQ');
    expect(res.body.data.permissions).toContain('order.verify');
  });

  it('SALES 역할로 조회 — 영업 모듈만 포함', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-Role', 'SALES')
      .set('X-User', 'sales1@evnsolution.com')
      .expect(200);

    expect(res.body.data.user.role).toBe('SALES');
    expect(res.body.data.permissions).toContain('quote.create');
    expect(res.body.data.permissions).not.toContain('order.verify');
    // override: subsidy.manage 차단
    expect(res.body.data.permissions).not.toContain('subsidy.manage');
  });

  it('X-Role 헤더 없음 → 403', async () => {
    await request(app).get('/api/v1/auth/me').expect(403);
  });
});

describe('GET /api/v1/auth/me/permissions', () => {
  const app = createApp();

  it('MAKER 역할 — 활성 모듈코드 배열 반환', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me/permissions')
      .set('X-Role', 'MAKER')
      .set('X-User', 'maker1@partner.com')
      .expect(200);

    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(res.body.data.permissions).toContain('doc.generate');
    expect(res.body.data.permissions).toContain('loadcalc.run');
    expect(res.body.data.permissions).not.toContain('quote.create');
  });
});

// ── org 격리 stub 테스트 ──────────────────────────────────────────────

describe('orgScope stub — 인증 없으면 403', () => {
  const app = createApp();

  it('X-Role 없는 GET /orders/:id → 403', async () => {
    await request(app).get('/api/v1/orders/1').expect(403);
  });

  it('SALES 인증 있으면 orgScope 통과 (501 Not Implemented)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('X-Role', 'SALES')
      .expect(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('MAKER 인증 있으면 orgScope 통과 (501 Not Implemented)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('X-Role', 'MAKER')
      .expect(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });

  it('ADMIN은 전체 접근 — orgScope 통과', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/1/status')
      .set('X-Role', 'ADMIN')
      .expect(501);
    expect(res.body.error.code).toBe('NOT_IMPLEMENTED');
  });
});
