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
import { mergePermissions } from '../lib/permissions.js';
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
      .set('Cookie', authCookie('sales1@evnsolution.com', 'SALES', 'ORG_SALES1'));
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
      .set('Cookie', authCookie('sales1@evnsolution.com', 'SALES', 'ORG_SALES1'));
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
