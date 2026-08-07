/**
 * 모두싸인(Modusign) 전자계약 API 클라이언트 — 서버 전용.
 * 인증: MODUSIGN_API_KEY = base64("email:api-key") → Authorization: Basic <key>.
 *   ⚠️ 키·시크릿은 .env/시크릿에만. 프론트 노출·커밋 절대 금지. 서버 .env 는 배포담당이 주입.
 *
 * ⚠️ 요청/응답 JSON 스키마는 모두싸인 문서 기준 "초안" 이다. 실제 API 키로 E2E 검증 시
 *   이 파일(요청 body 조립 + 응답 필드 파싱)만 보정하면 됨 — 상위 로직은 안 건드림.
 *   제약: 요청 본문 UTF-8 필수, 서명필드 ≤100 / 전체필드 ≤2000.
 */
/**
 * 서명 필드 anchor — 새 계약서 양식(contract-template.docx)에 실제로 있는 문구.
 * '자필성명 / 서명 / (인)' 이 영수증·개인정보동의·매수인 3곳에 반복 존재하며,
 * 매칭 개수만큼 필드가 자동 생성되고 dataLabel 이 자동 넘버링된다(3곳 모두 서명 대상).
 */
export const CONTRACT_ANCHORS = {
  /**
   * 서명 위치 마커 — 계약서 서명란 3곳(영수증·개인정보동의·매수인)에 각각 하나씩.
   *
   * 한글 '서명' 을 앵커로 쓰면 모두싸인이 "Anchor text not found in PDF" 를 냈다.
   * PDF 에 텍스트로 분명히 있고 poppler 는 찾는데도 그렇다(추출기 차이 추정).
   * 그래서 각 자리에 **고유한 영문 마커**를 넣고 그것을 앵커로 쓴다.
   * 마커는 셀 배경색과 같은 글자색 + 6pt 라 화면·인쇄에 보이지 않는다.
   * ⚠️ 템플릿에서 이 마커를 지우면 서명란이 안 잡힌다.
   */
  SIGN_SPOTS: ['#SIGN1#', '#SIGN2#', '#SIGN3#'] as const,
} as const;

export class ModusignConfigError extends Error {}
export class ModusignApiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export type SigningMethod = 'EMAIL' | 'KAKAO';

const BASE_URL = process.env['MODUSIGN_BASE_URL'] || 'https://api.modusign.co.kr';

/**
 * 실발송 차단 스위치 — **기본 true**. 서명요청 1건마다 과금되므로 개발 중 실수 발송을 막는다.
 * 실제로 보내려면 서버 .env 에 MODUSIGN_DRY_RUN=false 를 명시해야 한다.
 */
export function isDryRun(): boolean {
  return (process.env['MODUSIGN_DRY_RUN'] ?? 'true').toLowerCase() !== 'false';
}

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
    // 검증 실패(400)는 어느 필드가 왜 틀렸는지가 전부다. 잘라내면 고칠 단서를 잃는다.
    // 응답 본문에는 자격증명이 없으므로 서버 로그에는 **전문**을 남긴다.
    console.error(`[modusign] ${method} ${path_} → ${res.status}\n${text}`);
    // 화면에는 요약만(길면 UI 가 깨진다). 전문은 로그에서 확인.
    throw new ModusignApiError(
      `모두싸인 ${method} ${path_} 실패 (${res.status}): ${text.slice(0, 800)}${text.length > 800 ? ' …(전문은 서버 로그)' : ''}`,
      res.status,
    );
  }
  return res.json().catch(() => ({}));
}

/** 서명 필드 위치 — 좌표는 sign-positions 서비스가 PDF 에서 뽑아 준다. */
export interface SignField {
  kind: 'SIGN' | 'STAMP';
  page: number; x: number; y: number;
}

export interface SendParams {
  title: string;
  pdfBase64: string;         // 서명 대상 문서(계약서)
  fileName: string;
  participant: { name: string; email?: string; phone?: string; signingMethod: SigningMethod };
  // 서명 불필요 첨부(예: 견적서 동봉). 실 API 의 첨부 스키마는 E2E 시 확정.
  attachments?: { fileName: string; base64: string }[];
  /** 비어 있으면 발송하지 않는다 — 서명란 없는 계약서를 보내면 안 된다. */
  signFields: SignField[];
}

/**
 * 계약서 발송. POST /documents — 서명대상 PDF(계약서) + 고객 1인 participant + anchor 필드.
 * attachments 는 서명 없이 함께 전달(견적서 동봉). 반환: 모두싸인 문서 id.
 */
export async function sendDocument(p: SendParams): Promise<{ documentId: string }> {
  if (!p.signFields.length) {
    throw new ModusignApiError('서명란 위치를 찾지 못했습니다 (계약서 템플릿의 #SIGN 마커 확인 필요)');
  }
  const contact = p.participant.signingMethod === 'EMAIL' ? p.participant.email : p.participant.phone;
  // ── 요청 스키마(초안) — 실 API 로 검증 시 이 블록만 보정 ─────────────────────
  // 확장자는 파일명에서 뽑되, 없으면 pdf. (모두싸인은 name 과 별개로 extension 을 요구한다)
  const extOf = (fname: string) => (fname.split('.').pop() ?? '').toLowerCase() || 'pdf';

  const body = {
    title: p.title,
    // ⚠️ 실 API 검증 결과 반영(400 ValidationFailedException):
    //    - file.extension 필수 (pdf/hwp/docx/… 중 하나)
    //    - participants[].signingOrder 필수. 전원 1(동시) 또는 순차([1,2,3])여야 한다.
    //      서명자가 고객 1명이므로 1.
    file: { name: p.fileName, extension: extOf(p.fileName), base64: p.pdfBase64 },
    // 견적서 등 서명불필요 첨부
    attachments: (p.attachments ?? []).map((a) => ({
      name: a.fileName, extension: extOf(a.fileName), base64: a.base64,
    })),
    participants: [
      {
        role: '고객',
        name: p.participant.name,
        signingOrder: 1,
        signingMethod: { type: p.participant.signingMethod, value: contact },
        // 실 API 검증에서 확정된 규약:
        //  · signatureTypes 는 SIGN | STAMP 만 허용(DRAW 아님)
        //  · anchor 는 field 최상위가 아니라 **position 안**에 넣는다.
        //    "either (x,y,page) or anchor, not both or neither" — 둘 중 하나만.
        //  · TEXT 필드는 textStyle 이 필수라 규격을 모르면 400 이 난다.
        //    자필성명·서명 모두 손으로 쓰는 칸이므로 SIGNATURE 로 통일해 TEXT 를 쓰지 않는다.
        // anchor 방식은 우리 PDF 에서 동작하지 않아 좌표로 배치한다(sign-positions 참고).
        fields: p.signFields.map((f) => ({
          type: 'SIGNATURE',
          signatureTypes: [f.kind],
          position: { page: f.page, x: Math.round(f.x), y: Math.round(f.y) },
        })),
      },
    ],
  };
  if (isDryRun()) {
    // 실제 API 를 부르지 않는다. 문서 id 는 추적 가능한 가짜값으로 — 웹훅 모의에도 쓸 수 있다.
    const fake = `dryrun-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    console.warn(`[modusign] DRY_RUN — 실제 발송하지 않음. title=${p.title} participant=${p.participant.name} documentId=${fake}`);
    return { documentId: fake };
  }
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
