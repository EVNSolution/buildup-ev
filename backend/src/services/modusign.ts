/**
 * 모두싸인(Modusign) 전자계약 API 클라이언트 — 서버 전용.
 * 인증: MODUSIGN_API_KEY = base64("email:api-key") → Authorization: Basic <key>.
 *   ⚠️ 키·시크릿은 .env/시크릿에만. 프론트 노출·커밋 절대 금지. 서버 .env 는 배포담당이 주입.
 *
 * ⚠️ 요청/응답 JSON 스키마는 모두싸인 문서 기준 "초안" 이다. 실제 API 키로 E2E 검증 시
 *   이 파일(요청 body 조립 + 응답 필드 파싱)만 보정하면 됨 — 상위 로직은 안 건드림.
 *   제약: 요청 본문 UTF-8 필수, 서명필드 ≤100 / 전체필드 ≤2000.
 */
import { CONTRACT_ANCHORS } from './contract-pdf.js';

export class ModusignConfigError extends Error {}
export class ModusignApiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export type SigningMethod = 'EMAIL' | 'KAKAO';

const BASE_URL = process.env['MODUSIGN_BASE_URL'] || 'https://api.modusign.co.kr';

function authHeader(): string {
  const key = process.env['MODUSIGN_API_KEY'];
  if (!key) throw new ModusignConfigError('MODUSIGN_API_KEY 환경변수가 설정되지 않았습니다');
  return `Basic ${key}`;
}

async function req(method: string, path_: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path_}`, {
    method,
    headers: {
      'Authorization': authHeader(),
      'Content-Type': 'application/json; charset=utf-8',
      'Accept': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ModusignApiError(`모두싸인 ${method} ${path_} 실패 (${res.status}): ${text.slice(0, 500)}`, res.status);
  }
  return res.json().catch(() => ({}));
}

export interface SendParams {
  title: string;
  pdfBase64: string;         // 서명 대상 문서(계약서)
  fileName: string;
  participant: { name: string; email?: string; phone?: string; signingMethod: SigningMethod };
  // 서명 불필요 첨부(예: 견적서 동봉). 실 API 의 첨부 스키마는 E2E 시 확정.
  attachments?: { fileName: string; base64: string }[];
}

/**
 * 계약서 발송. POST /documents — 서명대상 PDF(계약서) + 고객 1인 participant + anchor 필드.
 * attachments 는 서명 없이 함께 전달(견적서 동봉). 반환: 모두싸인 문서 id.
 */
export async function sendDocument(p: SendParams): Promise<{ documentId: string }> {
  const contact = p.participant.signingMethod === 'EMAIL' ? p.participant.email : p.participant.phone;
  // ── 요청 스키마(초안) — 실 API 로 검증 시 이 블록만 보정 ─────────────────────
  const body = {
    title: p.title,
    file: { name: p.fileName, base64: p.pdfBase64 },
    // 견적서 등 서명불필요 첨부. (모두싸인 첨부 필드명은 실 API 확인 필요.)
    attachments: (p.attachments ?? []).map((a) => ({ name: a.fileName, base64: a.base64 })),
    participants: [
      {
        role: '고객',
        name: p.participant.name,
        signingMethod: { type: p.participant.signingMethod, value: contact },
        fields: [
          { type: 'SIGNATURE', anchor: { text: CONTRACT_ANCHORS.SIGNATURE } },
          { type: 'TEXT', anchor: { text: CONTRACT_ANCHORS.CUSTOMER_NAME } },
          { type: 'SIGNING_DATE', anchor: { text: CONTRACT_ANCHORS.SIGNING_DATE } },
        ],
      },
    ],
  };
  const json = (await req('POST', '/documents', body)) as { id?: string; documentId?: string };
  const documentId = json.id ?? json.documentId;
  if (!documentId) throw new ModusignApiError('발송 응답에 문서 id 가 없습니다 (응답 스키마 확인 필요)');
  return { documentId };
}

export interface ModusignDocStatus {
  documentId: string;
  status?: string; // 모두싸인 원본 상태문자열 (재조회 검증용)
  raw: unknown;
}

/** 문서 상태 재조회 (webhook 위조 방어: 이벤트 수신 시 API 로 실제 상태 확인). */
export async function getDocument(documentId: string): Promise<ModusignDocStatus> {
  const json = (await req('GET', `/documents/${encodeURIComponent(documentId)}`)) as { status?: string };
  return { documentId, status: json.status, raw: json };
}

/** 완료된 서명본 PDF 다운로드. (엔드포인트/응답형식은 실 API 로 확정) */
export async function downloadSignedPdf(documentId: string): Promise<Buffer> {
  const res = await fetch(`${BASE_URL}/documents/${encodeURIComponent(documentId)}/file`, {
    method: 'GET',
    headers: { 'Authorization': authHeader(), 'Accept': 'application/pdf' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ModusignApiError(`서명본 다운로드 실패 (${res.status}): ${text.slice(0, 500)}`, res.status);
  }
  const ct = res.headers.get('content-type') || '';
  // 일부 API 는 { downloadUrl } 를 반환 — 그 경우 한 번 더 받는다.
  if (ct.includes('application/json')) {
    const j = (await res.json()) as { downloadUrl?: string; url?: string };
    const url = j.downloadUrl ?? j.url;
    if (!url) throw new ModusignApiError('서명본 다운로드 URL 이 응답에 없습니다');
    const f = await fetch(url);
    if (!f.ok) throw new ModusignApiError(`서명본 URL 다운로드 실패 (${f.status})`);
    return Buffer.from(await f.arrayBuffer());
  }
  return Buffer.from(await res.arrayBuffer());
}
