import { describe, it, expect } from 'vitest';
import { mapEventToStatus, extractWebhookEvent } from '../services/contract.js';

describe('mapEventToStatus — 모두싸인 이벤트 → 내부 상태', () => {
  it('완료/거절/취소 (종료상태)', () => {
    expect(mapEventToStatus('document_all_signed')).toBe('COMPLETED');
    expect(mapEventToStatus('document_completed')).toBe('COMPLETED');
    expect(mapEventToStatus('document_rejected')).toBe('REJECTED');
    expect(mapEventToStatus('document_canceled')).toBe('CANCELED');
  });
  it('진행상태', () => {
    expect(mapEventToStatus('document_started')).toBe('SENT');
    expect(mapEventToStatus('document_viewed')).toBe('VIEWED');
    expect(mapEventToStatus('document_signing')).toBe('SIGNING');
    expect(mapEventToStatus('document_signed')).toBe('SIGNING');
  });
  it('완료는 서명/거절 키워드보다 우선 (all_signed)', () => {
    expect(mapEventToStatus('all_signed')).toBe('COMPLETED');
  });
  it('알 수 없는 이벤트 → null (무시)', () => {
    expect(mapEventToStatus('heartbeat')).toBeNull();
    expect(mapEventToStatus('')).toBeNull();
  });
});

describe('extractWebhookEvent — payload 파싱(스키마 초안 허용폭)', () => {
  it('평면 형태', () => {
    expect(extractWebhookEvent({ documentId: 'doc1', event: 'document_started' }))
      .toEqual({ documentId: 'doc1', eventType: 'document_started' });
  });
  it('중첩 document.id + type', () => {
    expect(extractWebhookEvent({ document: { id: 'doc2' }, type: 'document_all_signed' }))
      .toEqual({ documentId: 'doc2', eventType: 'document_all_signed' });
  });
  it('data 래핑', () => {
    expect(extractWebhookEvent({ data: { documentId: 'doc3', event: 'document_rejected' } }))
      .toEqual({ documentId: 'doc3', eventType: 'document_rejected' });
  });
  it('필수 필드 없으면 null', () => {
    expect(extractWebhookEvent({ foo: 'bar' })).toBeNull();
    expect(extractWebhookEvent(null)).toBeNull();
  });
});
