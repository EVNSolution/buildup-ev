/**
 * 튜닝신청서 전자서명.
 *
 * 매매계약서와 **같은 흐름**이다 — 고객 1인이 이메일/카카오로 서명한다.
 * 그래서 상태 매핑(`mapDocStatus`·`mapEventToStatus`)과 모두싸인 클라이언트를 그대로 빌려 쓴다.
 * 여기서 새 어휘를 만들면 두 문서의 상태가 갈라져, 같은 웹훅을 두 벌로 해석하게 된다.
 *
 * 다른 점은 **붙는 대상**뿐이다: 계약은 견적에, 튜닝신청서는 주문에 붙는다
 * (자동차등록증이 나온 뒤에야 만들 수 있어 견적 시점에는 존재할 수 없다).
 *
 * ⚠️ **아직 양식이 없다.** `renderTuningPdf` 가 서식 원본을 받아 구현되기 전까지
 *    발송은 TUNING_FORM_MISSING 으로 거절된다 — 빈 문서가 고객에게 나가는 것보다 낫다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TuningApplication } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { docStorageDir } from '../lib/soffice.js';
import * as modusign from './modusign.js';
import { toKakaoPhone, type SigningMethod } from './modusign.js';
import { mapDocStatus, mapEventToStatus } from './contract.js';

export class TuningEsignError extends Error {
  constructor(message: string, readonly code:
    'NOT_FOUND' | 'NO_CONTACT' | 'DB_UNAVAILABLE' | 'ALREADY_SENT' | 'NEEDS_REVIEW'
    | 'FORM_MISSING' | 'NOT_READY') {
    super(message);
  }
}

/** 되돌리지 않는 종료 상태 — 계약과 같은 기준. */
const TERMINAL = ['COMPLETED', 'REJECTED', 'CANCELED'];

function db() {
  if (!prisma) throw new TuningEsignError('DB 연결 필요', 'DB_UNAVAILABLE');
  return prisma;
}

/** 최신 1건 = 현재 상태(재발송하면 행이 쌓인다). */
export async function getLatestTuning(orderId: number): Promise<TuningApplication | null> {
  const p = db();
  return p.tuningApplication.findFirst({ where: { order_id: orderId }, orderBy: { created_at: 'desc' } });
}

/**
 * 서명본을 내려받아 저장한다. **실패해도 던지지 않는다** — 계약과 같은 이유로,
 * 상태 전이가 부수 작업 때문에 막히면 안 된다.
 */
async function saveTuningSignedPdf(appId: number, orderId: number, documentId: string): Promise<string | null> {
  try {
    const pdf = await modusign.downloadSignedPdf(documentId);
    const dir = path.join(docStorageDir(), 'orders', String(orderId));
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `tuning_signed_${appId}.pdf`);
    await writeFile(filePath, pdf);
    return filePath;
  } catch (e) {
    console.error(`[tuning] 서명본 저장 실패(상태는 반영함) app=${appId}:`, e instanceof Error ? e.message : e);
    return null;
  }
}

/** 서명본 PDF 를 확실히 손에 넣는다 — 없으면 지금 받아서 저장한다(계약과 같은 복구 경로). */
export async function ensureTuningSignedPdf(orderId: number): Promise<string | null> {
  const p = db();
  const app = await getLatestTuning(orderId);
  if (!app || app.status !== 'COMPLETED' || !app.modusign_document_id) return null;
  if (app.signed_pdf_path && existsSync(app.signed_pdf_path)) return app.signed_pdf_path;

  const saved = await saveTuningSignedPdf(app.id, orderId, app.modusign_document_id);
  if (!saved) return null;
  await p.tuningApplication.update({ where: { id: app.id }, data: { signed_pdf_path: saved } });
  return saved;
}

/**
 * 서명본을 **내려받았다**고 기록한다. 실제 다운로드가 일어난 순간에만 부른다 —
 * 화면의 「확인」 클릭이 아니라 파일이 나간 사실을 남기는 것이 목적이다.
 * (예전엔 브라우저 메모리에만 있어 새로고침하면 사라졌고, 서버는 검사하지도 않았다.)
 */
export async function markTuningDownloaded(orderId: number, by: string): Promise<void> {
  const p = db();
  const app = await getLatestTuning(orderId);
  if (!app || app.downloaded_at) return;   // 처음 내려받은 사람·시각만 남긴다
  await p.tuningApplication.update({
    where: { id: app.id },
    data: { downloaded_at: new Date(), downloaded_by: by },
  });
}

/** 「서명 완료」 단계를 넘길 수 있는가 = 서명이 끝났고 서명본을 내려받았는가. */
export async function isTuningSignedAndFetched(orderId: number): Promise<boolean> {
  const app = await getLatestTuning(orderId);
  return !!app && app.status === 'COMPLETED' && !!app.downloaded_at;
}

/**
 * 웹훅 처리 — 계약이 아닌 문서가 오면 여기로 넘어온다.
 * 멱등 처리는 호출부(handleModusignEvent)가 이미 했다.
 */
export async function handleTuningEvent(documentId: string, eventType: string): Promise<void> {
  const p = db();
  const app = await p.tuningApplication.findUnique({ where: { modusign_document_id: documentId } });
  if (!app) return;                                  // 우리 문서가 아니다
  if (TERMINAL.includes(app.status)) return;         // 이미 종료 — 되돌리지 않는다

  // 계약과 같은 교차검증: 이벤트 이름보다 API 실상태를 믿는다(어휘가 다르다)
  let mapped = mapEventToStatus(eventType);
  try {
    const doc = await modusign.getDocument(documentId);
    if (doc.status) {
      const fromApi = mapDocStatus(doc.status);
      if (fromApi) mapped = fromApi;
    }
  } catch { /* 재조회 실패 시 이벤트 매핑값으로 진행 */ }
  if (!mapped) {
    console.warn(`[webhook/tuning] 매핑되지 않은 이벤트 '${eventType}' (document ${documentId}) — 무시`);
    return;
  }

  const data: { status: typeof mapped; signed_pdf_path?: string; completed_at?: Date } = { status: mapped };
  if (mapped === 'COMPLETED') {
    const saved = await saveTuningSignedPdf(app.id, app.order_id, documentId);
    if (saved) data.signed_pdf_path = saved;
    data.completed_at = new Date();
  }
  await p.tuningApplication.update({ where: { id: app.id }, data });
  console.info(`[tuning] 주문 ${app.order_id} 서명 상태 ${app.status} → ${mapped}`);
}

/**
 * 튜닝신청서 PDF.
 *
 * ⚠️ **미구현 — 서식 원본 대기 중.**
 * 여기서 빈 문서나 임시 양식을 만들어 보내면 고객이 엉뚱한 서류에 서명하게 되고,
 * 그 서명본이 관청에 제출된다. 양식이 확정될 때까지 발송을 막는 편이 맞다.
 */
export async function findTuningSignFields(_pdf: Buffer): Promise<modusign.SignField[]> {
  throw new TuningEsignError(
    '튜닝신청서 서명란 위치가 아직 정해지지 않았습니다. 서식 원본이 들어오면 잡습니다.',
    'FORM_MISSING',
  );
}

export async function renderTuningPdf(_orderId: number): Promise<Buffer> {
  throw new TuningEsignError(
    '튜닝신청서 양식이 아직 등록되지 않았습니다. 서식 원본이 들어오면 발송할 수 있습니다.',
    'FORM_MISSING',
  );
}

/**
 * 튜닝신청서 발송 — 고객에게 이메일/카카오로 서명 요청.
 * 계약 발송(`sendContract`)과 같은 안전장치를 둔다: 진행 중인 건은 재발송하지 않는다(건당 과금).
 */
export async function sendTuningApplication(orderId: number, method: SigningMethod): Promise<TuningApplication> {
  const p = db();

  const order = await p.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { customer: true } } },
  });
  if (!order) throw new TuningEsignError('주문을 찾을 수 없습니다', 'NOT_FOUND');

  const latest = await getLatestTuning(orderId);
  // 계약과 같은 판단: documentId 가 있는 DRAFT 는 이미 고객에게 갔을 수 있다
  if (latest?.status === 'DRAFT' && latest.modusign_document_id) {
    throw new TuningEsignError(
      '이전 발송이 끝까지 처리되지 않았습니다. 이미 고객에게 전달되었을 수 있어 자동 재발송을 막았습니다. '
      + '모두싸인에서 문서 상태를 확인한 뒤 진행하세요.',
      'NEEDS_REVIEW',
    );
  }
  if (latest && !['DRAFT', 'REJECTED', 'CANCELED'].includes(latest.status)) {
    throw new TuningEsignError(
      `이미 발송된 튜닝신청서가 있습니다(현재 ${latest.status}). 거절·취소된 경우에만 재발송할 수 있습니다.`,
      'ALREADY_SENT',
    );
  }

  const customer = order.quote.customer;
  if (!customer) throw new TuningEsignError('고객 정보가 없습니다', 'NOT_FOUND');
  const contact = method === 'EMAIL' ? customer.email : toKakaoPhone(customer.phone ?? undefined);
  if (!contact) {
    throw new TuningEsignError(method === 'EMAIL' ? '고객 이메일이 없습니다' : '고객 휴대폰번호가 없습니다', 'NO_CONTACT');
  }

  // 양식이 없으면 여기서 멈춘다 — 행을 만들기 전에 막아, 빈 DRAFT 가 쌓이지 않게 한다
  const pdf = await renderTuningPdf(orderId);

  const app = await p.tuningApplication.create({
    data: {
      order_id: orderId,
      signing_method: method,
      status: 'DRAFT',
      customer_snapshot: { name: customer.name, email: customer.email, phone: customer.phone },
    },
  });

  /*
   * 서명란 좌표는 양식이 확정된 뒤 채운다 — 계약서처럼 PDF 에서 라벨을 찾아 잡는다
   * (services/sign-positions.ts 와 같은 방식). 모두싸인은 signFields 가 비면 발송하지 않는다.
   */
  const signFields = await findTuningSignFields(pdf);

  const { documentId } = await modusign.sendDocument({
    title: `튜닝신청서 (주문 ${orderId})`,
    pdfBase64: pdf.toString('base64'),
    fileName: `튜닝신청서_주문${orderId}.pdf`,
    participant: {
      name: customer.name ?? '고객',
      ...(method === 'EMAIL' ? { email: contact } : { phone: contact }),
      signingMethod: method,
    },
    signFields,
    // 고객 1인이 자필 서명한다 — 법인 직인을 받는 계약서와 달리 튜닝신청서는 소유자 서명이다
    signatureType: 'SIGN',
  });

  return p.tuningApplication.update({
    where: { id: app.id },
    data: { modusign_document_id: documentId, status: 'SENT', sent_at: new Date() },
  });
}
