/**
 * 외부 webhook 수신 — /api/v1/webhooks/*
 * 모두싸인: 즉시 2xx 응답(10초 내, 아니면 최대 5회 재전송) → 내부에서 멱등 처리.
 * 인증: 커스텀 헤더 X-Webhook-Secret 을 .env 의 MODUSIGN_WEBHOOK_SECRET 과 대조.
 * 불일치면 401 후 처리 중단. 통과해도 contract 서비스가 document 를 API 로 재조회해
 * 실상태를 교차검증한다(이중 방어).
 */
import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { handleModusignEvent, extractWebhookEvent } from '../services/contract.js';

export const webhooksRouter = Router();

// ── POST /webhooks/modusign ──────────────────────────────────────────────────
/** 타이밍 공격 방지용 상수시간 비교. 길이가 다르면 즉시 false. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

webhooksRouter.post('/modusign', (req: Request, res: Response): void => {
  // 0) 커스텀 헤더 검증 — 위조 요청은 여기서 끊는다(값은 절대 로그에 남기지 않는다)
  const expected = process.env['MODUSIGN_WEBHOOK_SECRET'];
  if (!expected) {
    console.error('[webhook/modusign] MODUSIGN_WEBHOOK_SECRET 미설정 — 수신 거부');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const got = req.get('X-Webhook-Secret') ?? '';
  if (!safeEqual(got, expected)) {
    console.warn('[webhook/modusign] 헤더 불일치 — 401');
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  // 1) 즉시 확인응답 (지연 시 재전송 유발)
  res.status(200).json({ ok: true });

  // 2) 이후 비동기 처리 (실패해도 이미 200 응답 — 재조회 검증으로 최종 일관성)
  const evt = extractWebhookEvent(req.body);
  if (!evt) {
    console.warn('[webhook/modusign] 파싱 불가 payload:', JSON.stringify(req.body).slice(0, 300));
    return;
  }
  handleModusignEvent(evt.documentId, evt.eventType).catch((e) => {
    console.error('[webhook/modusign] 처리 실패', evt, e);
  });
});
