import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { mapEventToStatus } from '../services/contract.js';
import { isDryRun } from '../services/modusign.js';
import { webhooksRouter } from '../routes/webhooks.js';

const SECRET = 'test-secret-value';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/v1/webhooks', webhooksRouter);
  return a;
}

describe('모두싸인 이벤트 매핑 — 구독 중인 5개만', () => {
  it('document_started → SENT', () => expect(mapEventToStatus('document_started')).toBe('SENT'));
  it('document_all_signed → COMPLETED', () => expect(mapEventToStatus('document_all_signed')).toBe('COMPLETED'));
  it('document_rejected → REJECTED', () => expect(mapEventToStatus('document_rejected')).toBe('REJECTED'));
  it('document_request_canceled → CANCELED (요청 취소=종료)', () =>
    expect(mapEventToStatus('document_request_canceled')).toBe('CANCELED'));
  it('document_signing_canceled → SENT (서명 취소=대기 복귀)', () =>
    expect(mapEventToStatus('document_signing_canceled')).toBe('SENT'));

  it('서명자 1명이라 발생하지 않는 document_signed 는 매핑하지 않는다', () =>
    expect(mapEventToStatus('document_signed')).toBeNull());
  it('모르는 이벤트는 무시(null) — 추측 매칭하지 않는다', () => {
    expect(mapEventToStatus('document_viewed')).toBeNull();
    expect(mapEventToStatus('completed')).toBeNull();
    expect(mapEventToStatus('')).toBeNull();
  });
});

describe('webhook 커스텀 헤더 검증', () => {
  const orig = process.env['MODUSIGN_WEBHOOK_SECRET'];
  beforeEach(() => { process.env['MODUSIGN_WEBHOOK_SECRET'] = SECRET; });
  afterEach(() => {
    if (orig === undefined) delete process.env['MODUSIGN_WEBHOOK_SECRET'];
    else process.env['MODUSIGN_WEBHOOK_SECRET'] = orig;
  });

  const body = { documentId: 'doc-1', eventType: 'document_started' };

  it('헤더가 없으면 401', async () => {
    const r = await request(app()).post('/api/v1/webhooks/modusign').send(body);
    expect(r.status).toBe(401);
  });

  it('헤더가 틀리면 401', async () => {
    const r = await request(app()).post('/api/v1/webhooks/modusign')
      .set('X-Webhook-Secret', 'wrong').send(body);
    expect(r.status).toBe(401);
  });

  it('헤더가 맞으면 즉시 200 (10초 이내)', async () => {
    const t0 = Date.now();
    const r = await request(app()).post('/api/v1/webhooks/modusign')
      .set('X-Webhook-Secret', SECRET).send(body);
    expect(r.status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(10_000);
  });

  it('secret 미설정이면 수신 거부(401) — 무방비 공개 금지', async () => {
    delete process.env['MODUSIGN_WEBHOOK_SECRET'];
    const r = await request(app()).post('/api/v1/webhooks/modusign')
      .set('X-Webhook-Secret', SECRET).send(body);
    expect(r.status).toBe(401);
  });

  it('401 응답에 secret 값이 새지 않는다', async () => {
    const r = await request(app()).post('/api/v1/webhooks/modusign')
      .set('X-Webhook-Secret', 'wrong').send(body);
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
  });
});

describe('DRY_RUN — 실수 발송 방지', () => {
  const orig = process.env['MODUSIGN_DRY_RUN'];
  afterEach(() => {
    if (orig === undefined) delete process.env['MODUSIGN_DRY_RUN'];
    else process.env['MODUSIGN_DRY_RUN'] = orig;
  });

  it('미설정이면 기본 true — 과금되는 실발송을 기본으로 두지 않는다', () => {
    delete process.env['MODUSIGN_DRY_RUN'];
    expect(isDryRun()).toBe(true);
  });
  it("'false' 로 명시할 때만 실발송", () => {
    process.env['MODUSIGN_DRY_RUN'] = 'false';
    expect(isDryRun()).toBe(false);
  });
  it("'true'/오타 값은 안전하게 DRY_RUN 유지", () => {
    for (const v of ['true', 'TRUE', 'no', '0', '']) {
      process.env['MODUSIGN_DRY_RUN'] = v;
      expect(isDryRun()).toBe(true);
    }
  });
});

