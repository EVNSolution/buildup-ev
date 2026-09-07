import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mapEventToStatus, extractWebhookEvent } from '../services/contract.js';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * **모두싸인이 실제로 보내는 이벤트 이름**만 매핑한다.
 *
 * ⚠️ 이 검사는 오래 빨간 채로 있었다. 초안 시절의 이름들(`document_completed`,
 *    `document_viewed`, `document_signing`, `all_signed` …)을 그대로 단정하고 있었는데,
 *    실 연동으로 확정된 어휘는 아래 다섯 개뿐이라 전부 null 이 나왔다.
 *    **빨간 검사가 오래 남으면 같은 파일의 진짜 회귀까지 가린다** — 그래서 사실에 맞췄다.
 *
 * ⚠️ 표에 없는 이름이 와도 계약이 멈추지는 않는다 — `handleModusignEvent` 가 모두싸인
 *    **API 로 실상태를 다시 조회해**(`mapDocStatus`) 덮어쓴다. 이벤트 이름은 신호일 뿐이고
 *    판단의 근거는 API 다. 그 안전망이 살아 있는지도 아래에서 함께 지킨다.
 */
describe('mapEventToStatus — 모두싸인 이벤트 → 내부 상태', () => {
  it('확정된 다섯 가지', () => {
    expect(mapEventToStatus('document_started')).toBe('SENT');
    expect(mapEventToStatus('document_all_signed')).toBe('COMPLETED');
    expect(mapEventToStatus('document_rejected')).toBe('REJECTED');
    expect(mapEventToStatus('document_request_canceled')).toBe('CANCELED');
    // 고객이 서명을 취소한 것 — 요청 자체가 죽은 것이 아니라 발송 대기로 되돌아간다
    expect(mapEventToStatus('document_signing_canceled')).toBe('SENT');
  });

  it('대소문자·공백에 흔들리지 않는다', () => {
    expect(mapEventToStatus('  Document_All_Signed  ')).toBe('COMPLETED');
  });

  it('알 수 없는 이벤트 → null (무시)', () => {
    expect(mapEventToStatus('heartbeat')).toBeNull();
    expect(mapEventToStatus('')).toBeNull();
    // 초안 시절 이름들 — 지금은 오지 않는다. 온다면 아래 안전망이 받는다.
    expect(mapEventToStatus('document_completed')).toBeNull();
  });

  it('🔴 이름을 몰라도 계약이 멈추지 않는다 — API 실상태가 덮어쓴다', () => {
    /*
     * 이 안전망이 없으면, 모두싸인이 이름을 하나 바꾸는 순간 **서명을 마쳐도
     * 계약완료가 되지 않는다.** 실제로 그런 사고가 있었다(event 가 객체로 와서
     * `[object Object]` 가 저장돼 매핑이 전부 실패했다).
     */
    const src = readFileSync(path.join(ROOT, 'backend/src/services/contract.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function handleModusignEvent'));
    expect(fn).toContain('modusign.getDocument');
    expect(fn).toMatch(/const fromApi = mapDocStatus\(doc\.status\)/);
    expect(fn).toMatch(/if \(fromApi\) mapped = fromApi/);   // API 우선
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
