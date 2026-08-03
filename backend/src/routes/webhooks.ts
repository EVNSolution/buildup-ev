/**
 * 외부 webhook 수신 — /api/v1/webhooks/*
 * 모두싸인: 즉시 2xx 응답(10초 내, 아니면 최대 5회 재전송) → 내부에서 멱등 처리.
 * 인증 없음(공개 엔드포인트). webhook 서명검증 secret 미확정 → contract 서비스가
 * document 를 API 로 재조회해 실상태 교차검증(위조 방어).
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { handleModusignEvent, extractWebhookEvent } from '../services/contract.js';

export const webhooksRouter = Router();

// ── POST /webhooks/modusign ──────────────────────────────────────────────────
webhooksRouter.post('/modusign', (req: Request, res: Response): void => {
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
