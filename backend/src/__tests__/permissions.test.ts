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
    expect(perms).not.toContain('order.verify');
    expect(perms).not.toContain('doc.generate');
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
    const permsWithOverride = mergePermissions('SALES', 'sales1@evnsolution.com');
    expect(permsWithOverride).not.toContain('subsidy.manage');
  });

  it('override 없는 SALES 계정 — 역할 기본값 그대로', () => {
    const perms = mergePermissions('SALES', 'other@evnsolution.com');
    expect(perms).toContain('quote.create');
    expect(perms).not.toContain('order.verify');
  });
});

// ── API 통합 테스트 (mock 폴백, DB 불필요) ────────────────────────────

describe('GET /api/v1/auth/me', () => {
  const app = createApp();

  it('ADMIN — user·org·permissions 포함', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-User', 'admin@evnsolution.com')
      .expect(200);

    expect(res.body.data.user.email).toBe('admin@evnsolution.com');
    expect(res.body.data.user.role).toBe('ADMIN');
    expect(res.body.data.org.code).toBe('ORG_HQ');
    expect(res.body.data.permissions).toContain('order.verify');
  });

  it('SALES — 영업 모듈만 포함', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('X-User', 'sales1@evnsolution.com')
      .expect(200);

    expect(res.body.data.user.role).toBe('SALES');
    expect(res.body.data.permissions).toContain('quote.create');
    expect(res.body.data.permissions).not.toContain('order.verify');
    expect(res.body.data.permissions).not.toContain('subsidy.manage');
  });

  it('X-User 없음 → 403', async () => {
    await request(app).get('/api/v1/auth/me').expect(403);
  });
});

describe('GET /api/v1/auth/me/permissions', () => {
  const app = createApp();

  it('MAKER — 활성 모듈코드 배열 반환', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me/permissions')
      .set('X-User', 'maker1@partner.com')
      .expect(200);

    expect(Array.isArray(res.body.data.permissions)).toBe(true);
    expect(res.body.data.permissions).toContain('doc.generate');
    expect(res.body.data.permissions).toContain('loadcalc.run');
    expect(res.body.data.permissions).not.toContain('quote.create');
  });
});

// ── org 격리 stub 테스트 ──────────────────────────────────────────────

describe('orders RBAC — 인증·권한 검증', () => {
  const app = createApp();

  it('X-User 없는 GET /orders/:id → 403', async () => {
    await request(app).get('/api/v1/orders/1').expect(403);
  });

  it('SALES — GET /orders/:id RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('X-User', 'sales1@evnsolution.com');
    expect(res.status).not.toBe(403);
  });

  it('MAKER — GET /orders/:id RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .get('/api/v1/orders/1')
      .set('X-User', 'maker1@partner.com');
    expect(res.status).not.toBe(403);
  });

  it('ADMIN — PATCH /orders/:id/status RBAC 통과 (403 아님)', async () => {
    const res = await request(app)
      .patch('/api/v1/orders/1/status')
      .set('X-User', 'admin@evnsolution.com')
      .send({ status: '구조변경' });
    expect(res.status).not.toBe(403);
  });
});
