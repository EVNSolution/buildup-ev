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
 * 양식과 서명란은 tuning-form.ts 가 맡는다([별지 제33호서식] 재현).
 * 등록증 정보가 비어 있으면 발송이 NOT_READY 로 막힌다 — 관청에 빈칸을 낼 수는 없다.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TuningApplication } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { archiveCustomerDoc } from './doc-archive.js';
import { docStorageDir } from '../lib/soffice.js';
import * as modusign from './modusign.js';
import { toKakaoPhone, type SigningMethod } from './modusign.js';
import { mapDocStatus, mapEventToStatus } from './contract.js';
import { renderTuningFormPdf, findTuningSignFields as findFields, TuningFormError } from './tuning-form.js';

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

    /*
     * 고객별 보관함에도 한 장 — 견적서·계약서와 같은 폴더에 순서대로 쌓인다.
     * 튜닝신청서는 **주문**에 붙지만 보관함은 고객 단위라, 주문 → 견적 → 고객으로 거슬러 간다.
     */
    const o = await prisma?.order.findUnique({
      where: { id: orderId },
      select: { quote: { select: { customer_id: true, quote_no: true, customer: { select: { name: true } } } } },
    });
    if (o?.quote) {
      await archiveCustomerDoc({
        customerId: o.quote.customer_id,
        customerName: o.quote.customer?.name,
        quoteNo: o.quote.quote_no,
        kind: '튜닝신청서_서명본',
        pdf,
      });
    }
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
/*
 * 양식·서명란은 tuning-form.ts 가 맡는다 — 여기서는 발송 흐름만 본다.
 * (예전엔 서식이 없어 이 자리에서 FORM_MISSING 을 던졌다)
 */
export { renderTuningFormPdf as renderTuningPdf, findTuningSignFields } from './tuning-form.js';

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

  /*
   * 「튜닝신청서 생성」이 끝난 뒤에만 보낸다. 이 단계는 자동차등록증 수령을 선행으로 두는데,
   * 등록증이 없으면 신청서의 소유자·등록번호·차대번호를 채울 수 없다 —
   * 단계 순서와 서류가 요구하는 것이 같은 이야기다.
   */
  const drafted = await p.orderStep.findUnique({
    where: { order_id_code: { order_id: orderId, code: 'tuning_drafted' } },
    select: { status: true },
  });
  if (drafted?.status !== 'done') {
    throw new TuningEsignError('「튜닝신청서 생성」 단계를 먼저 완료해야 서명을 요청할 수 있습니다', 'NOT_READY');
  }

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

  /*
   * **서명자 이름은 신청서와 같아야 한다.**
   * 신청인은 자동차등록증상 소유자인데 서명 요청은 견적 고객 이름으로 나가면,
   * 서명본에 적힌 사람과 신청서에 적힌 사람이 달라진다 — 관청에 낼 수 없는 서류가 된다.
   * 연락처는 등록증에 없어 견적 고객의 것을 쓸 수밖에 없다. 그래서 이름이 다르면
   * **누구에게 보내는지 화면에 먼저 보여 준다**(GET /tuning 의 recipient).
   */
  const ownerName = String(((order.vehicle_info ?? {}) as Record<string, unknown>)['소유자성명'] ?? '').trim();
  if (!ownerName) {
    throw new TuningEsignError('자동차등록증상 소유자성명이 입력되지 않았습니다', 'NOT_READY');
  }

  /*
   * 신청서를 **먼저** 만든다 — 행을 만들기 전에 막아, 빈 DRAFT 가 쌓이지 않게 한다.
   * 등록증 정보가 비어 있으면 여기서 걸린다(관청에 빈칸을 낼 수는 없다).
   */
  let pdf: Buffer;
  try {
    pdf = await renderTuningFormPdf(orderId);
  } catch (e) {
    if (e instanceof TuningFormError) throw new TuningEsignError(e.message, 'NOT_READY');
    throw e;
  }

  const app = await p.tuningApplication.create({
    data: {
      order_id: orderId,
      signing_method: method,
      status: 'DRAFT',
      // 보낸 사실을 그대로 남긴다 — 나중에 등록증이나 고객정보가 바뀌어도 이 기록은 안 변한다
      customer_snapshot: {
        owner_name: ownerName, customer_name: customer.name,
        email: customer.email, phone: customer.phone,
      },
    },
  });

  /*
   * 서명란 좌표는 양식이 확정된 뒤 채운다 — 계약서처럼 PDF 에서 라벨을 찾아 잡는다
   * (services/sign-positions.ts 와 같은 방식). 모두싸인은 signFields 가 비면 발송하지 않는다.
   */
  const signFields = await findFields(pdf);
  if (signFields.length === 0) {
    throw new TuningEsignError(
      '신청서에서 서명란을 찾지 못했습니다. 양식이 바뀌었는지 확인이 필요합니다(관리자 문의).',
      'NOT_READY',
    );
  }

  const { documentId } = await modusign.sendDocument({
    title: `튜닝신청서 (주문 ${orderId})`,
    pdfBase64: pdf.toString('base64'),
    fileName: `튜닝신청서_주문${orderId}.pdf`,
    participant: {
      // 신청서의 신청인과 같은 이름 — 서명본과 신청서가 다른 사람을 가리키면 안 된다
      name: ownerName,
      ...(method === 'EMAIL' ? { email: contact } : { phone: contact }),
      signingMethod: method,
    },
    signFields,
    // 고객 1인이 자필 서명한다 — 법인 직인을 받는 계약서와 달리 튜닝신청서는 소유자 서명이다
    signatureType: 'SIGN',
  });

  const sent = await p.tuningApplication.update({
    where: { id: app.id },
    data: { modusign_document_id: documentId, status: 'SENT', sent_at: new Date() },
  });

  /*
   * 「전자서명 요청」은 **보내는 순간 지나가는 단계**다(steps.ts 의 auto).
   * 사람이 따로 완료를 누를 일이 아니다 — 보낸 사실은 발송이 곧 증명한다.
   * 화면이 두 번 부르게 하지 않고 여기서 넘긴다. 발송이 실패하면 여기까지 오지 않는다.
   */
  await p.orderStep.updateMany({
    where: { order_id: orderId, code: 'tuning_sign_sent', status: { not: 'done' } },
    data: { status: 'done', done_at: new Date(), done_by: `system(전자서명 발송 · ${method})` },
  });
  return sent;
}

/**
 * 발송 전에 화면이 보여 줄 수신자.
 *
 * 신청인(등록증상 소유자)과 연락처 주인(견적 고객)이 다를 수 있다 —
 * 등록증에는 연락처가 없어 고객의 것을 쓸 수밖에 없기 때문이다.
 * 다르면 **보내기 전에 사람이 보고 판단**해야 한다. 조용히 보내면
 * 신청서에 적힌 사람과 서명한 사람이 달라진다.
 */
export async function tuningRecipient(orderId: number): Promise<{
  owner_name: string; customer_name: string; email: string; phone: string; mismatch: boolean;
} | null> {
  const p = db();
  const order = await p.order.findUnique({
    where: { id: orderId },
    include: { quote: { include: { customer: true } } },
  });
  if (!order) return null;
  const owner = String(((order.vehicle_info ?? {}) as Record<string, unknown>)['소유자성명'] ?? '').trim();
  const c = order.quote.customer;
  const cname = (c?.name ?? '').trim();
  // 공백만 다른 경우는 같은 것으로 본다 — 「(주)이브이앤」과 「(주) 이브이앤」을 다르다고 하면 안 된다
  const norm = (v: string) => v.replace(/\s+/g, '');
  return {
    owner_name: owner,
    customer_name: cname,
    email: c?.email ?? '',
    phone: c?.phone ?? '',
    mismatch: !!owner && !!cname && norm(owner) !== norm(cname),
  };
}
