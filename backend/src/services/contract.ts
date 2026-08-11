/**
 * 구매계약 전자서명 오케스트레이션.
 * 발송: 계약서 PDF 생성 → 모두싸인 업로드 → purchase_contract(DRAFT→SENT).
 * webhook: 멱등 dedup → 실상태 재조회(위조 방어) → 상태갱신 → 완료 시 서명본 저장.
 * 양식은 generateContractPdf 뒤에 격리 — 여기 로직은 양식과 무관.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ContractStatus, PurchaseContract, Customer } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { docStorageDir } from '../lib/soffice.js';
import { type ContractInput } from './contract-pdf.js';
import { renderContractPdfForQuote, isCorporateContract } from './contract-docgen.js';
import { freezeQuoteDocs } from './doc-freeze.js';
import { findSignPositions } from './sign-positions.js';
import { generateQuotePdf } from './quote-pdf.js';
import * as modusign from './modusign.js';
import type { SigningMethod } from './modusign.js';
import { toKakaoPhone } from './modusign.js';
import { setQuoteStatus } from './quote-status.js';

export class ContractError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'NO_CUSTOMER' | 'NO_CONTACT' | 'DB_UNAVAILABLE' | 'NOT_SENDABLE' | 'ALREADY_SENT' | 'NEEDS_REVIEW' = 'NOT_FOUND') {
    super(message);
  }
}

function db() {
  if (!prisma) throw new ContractError('DB 사용 불가', 'DB_UNAVAILABLE');
  return prisma;
}

/** 최신(현재) 계약 행. 재발송 이력은 누적되므로 created_at 최신이 현재. */
export async function getLatestContract(quoteId: number): Promise<PurchaseContract | null> {
  return db().purchaseContract.findFirst({
    where: { quote_id: quoteId },
    orderBy: { created_at: 'desc' },
  });
}

/** 견적 → 계약서 입력(ContractInput) + 고객. 계약 발송·이메일 발송이 공유(계약서 PDF 생성용). */
export async function buildContractInput(quoteId: number): Promise<{ input: ContractInput; customer: Customer }> {
  const quote = await db().quote.findUnique({ where: { id: quoteId }, include: { customer: true } });
  if (!quote) throw new ContractError('견적을 찾을 수 없습니다', 'NOT_FOUND');
  const customer = quote.customer;
  if (!customer) throw new ContractError('견적에 고객 정보가 없습니다', 'NO_CUSTOMER');

  const selections = (quote.selections ?? {}) as Record<string, string>;
  const supply = quote.supply_price ?? 0;
  const total = quote.final_price ?? supply;
  const d = quote.created_at ?? new Date();
  const contractDate = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;

  // 특장 사양: 선택 값코드 → 옵션 라벨 해결(quote-pdf 와 동일 패턴)
  const valueCodes = Object.values(selections).filter(Boolean);
  const optVals = valueCodes.length
    ? await db().optionValue.findMany({ where: { code: { in: valueCodes } } })
    : [];
  const nameOf = new Map(optVals.map((v) => [v.code, v.name]));
  const label = (group: string): string => {
    const code = selections[group];
    if (!code) return '';
    // O/X 그룹은 '적용/미적용' 으로 표기
    if (group === 'SPOILER' || group === 'TEMP') {
      if (code.endsWith('_O')) return '적용';
      if (code.endsWith('_X')) return '미적용';
    }
    return nameOf.get(code) ?? '';
  };
  const spec: Record<string, string> = {
    탑종류: label('BODYTYPE'),   // 냉동/내장
    탑높이: label('TOP'),        // 저상/표준
    도어옵션: label('DOORTYPE'), // 여닫이/슬라이딩/…
    스포일러: label('SPOILER'),  // 적용/미적용
    도어추가: label('DOORADD'),  // 추가없음/운전석측추가
    온도기록계: label('TEMP'),   // 적용/미적용
    격벽: label('PARTITION'),    // 없음/그물망/이동식
  };

  const input: ContractInput = {
    order_id: String(quote.id), // 계약번호 표기용(견적 기준)
    contract_date: contractDate,
    customer: {
      name: customer.name,
      email: customer.email ?? undefined,
      phone: customer.phone ?? undefined,
      address: customer.address ?? undefined,
      address_detail: customer.address_detail ?? undefined,
      biz_no: customer.reg_no ?? undefined,
    },
    vehicle: { model: quote.model_code, options: Object.values(selections) },
    spec,
    // ⚠️ 특장가격(VAT포함) 매핑은 잠정 = final_price. 계약금/잔금 분할은 시스템 미보유(수기).
    price: { supply, vat: Math.round(supply * 0.1), total },
    terms: {},
  };
  return { input, customer };
}

/**
 * 계약서 발송. 계약은 견적(확정 시점)에 연결 — 주문 생성 전에도 영업이 발송 가능.
 * 전자서명용 계약서(placeholder) + 견적서 동봉(영업 프로세스)을 함께 보낸다.
 */
export async function sendContract(quoteId: number, signingMethod: SigningMethod): Promise<PurchaseContract> {
  const p = db();

  // ── 비용 안전장치 ── 서명요청 1건마다 과금된다.
  // (1) 확정 전 견적은 발송 불가 — 임시저장 상태로 고객에게 서명을 요청할 일은 없다.
  const q = await p.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (!q) throw new ContractError('견적을 찾을 수 없습니다', 'NOT_FOUND');
  if (q.status === 'draft') {
    throw new ContractError('견적을 먼저 확정해야 서명을 요청할 수 있습니다', 'NOT_SENDABLE');
  }
  // (2) 진행 중이거나 이미 완료된 계약이 있으면 재발송 차단.
  //     거절·취소된 건만 다시 보낼 수 있다.
  const latest = await getLatestContract(quoteId);
  // DRAFT = 발송을 시도했으나 완료되지 않은 흔적. 두 경우를 구분해야 한다.
  //  · documentId 없음 = 모두싸인이 문서를 만들지 못함(스키마 오류·인증 실패·요금제 소진 등)
  //    → 과금되지 않았으므로 재시도해도 안전.
  //  · documentId 있음 = 문서는 만들어졌는데 우리가 응답 처리에 실패(타임아웃 등)
  //    → 이미 고객에게 갔을 수 있다. 그냥 재시도하면 이중 발송·이중 과금이 된다.
  if (latest?.status === 'DRAFT' && latest.modusign_document_id) {
    throw new ContractError(
      '이전 발송이 끝까지 처리되지 않았습니다. 이미 고객에게 전달되었을 수 있어 자동 재발송을 막았습니다. ' +
      '모두싸인에서 문서 상태를 확인한 뒤 진행하세요.',
      'NEEDS_REVIEW',
    );
  }
  if (latest && !['DRAFT', 'REJECTED', 'CANCELED'].includes(latest.status)) {
    throw new ContractError(
      `이미 발송된 계약이 있습니다(현재 ${latest.status}). 거절·취소된 경우에만 재발송할 수 있습니다.`,
      'ALREADY_SENT',
    );
  }

  const { customer } = await buildContractInput(quoteId);
  // 알림톡은 숫자만 남긴 번호로 보낸다 — 저장 형식(010-1234-5678)과 다르다.
  const contact = signingMethod === 'EMAIL' ? customer.email : toKakaoPhone(customer.phone ?? undefined);
  if (!contact) {
    throw new ContractError(signingMethod === 'EMAIL' ? '고객 이메일이 없습니다' : '고객 휴대폰번호가 없습니다', 'NO_CONTACT');
  }

  // 계약서(서명대상) + 견적서(동봉) 생성.
  // 계약서는 영업페이지 미리보기·이메일과 **같은 렌더 경로**(새 양식) — 양식이 갈라지지 않게 한다.
  const contractPdf = (await renderContractPdfForQuote(quoteId)).pdf;
  const quotePdf = await generateQuotePdf(quoteId);

  // 발송시점 고객 스냅샷 고정 + DRAFT 행 선생성
  const contract = await p.purchaseContract.create({
    data: {
      quote_id: quoteId,
      signing_method: signingMethod,
      status: 'DRAFT',
      customer_snapshot: { name: customer.name, email: customer.email, phone: customer.phone, reg_no: customer.reg_no },
    },
  });

  // 날인칸 좌표를 계약서 PDF 에서 직접 찾는다(라벨 '자필성명' 과 같은 줄의 '(인)').
  // 매수인 블록은 개인/법인 중 한 줄에만 놓는다 — 판정 기준은 계약서 토큰과 동일해야 한다.
  const inputs = (await p.quote.findUnique({ where: { id: quoteId }, select: { inputs: true } }))?.inputs;
  const inp = (inputs as Record<string, unknown> | null) ?? {};
  const isCorp = isCorporateContract(inp['biz_type']);
  // 법인은 두 갈래 — 대리인 이름이 있으면 대리인이 **서명**, 없으면 회사 **직인**.
  // 한 서명자는 한 종류만 쓸 수 있으므로(모두싸인 제약) 여기서 하나로 정한다.
  const signatureType: 'SIGN' | 'STAMP' =
    isCorp && !String(inp['buyer_agent'] ?? '').trim() ? 'STAMP' : 'SIGN';
  const signFields = await findSignPositions(contractPdf, isCorp);
  console.info(`[contract] 견적 ${quoteId} ${isCorp ? '법인' : '개인'} ${signatureType} 날인칸 ${signFields.length}개 ` +
    signFields.map((f) => `${f.slot}@${f.page}p(${f.x.toFixed(3)},${f.y.toFixed(3)})`).join(' '));

  let documentId: string;
  try {
    ({ documentId } = await modusign.sendDocument({
      title: `특장매매계약서_견적${quoteId}`,
      fileName: `contract_quote${quoteId}.pdf`,
      pdfBase64: contractPdf.toString('base64'),
      participant: { name: customer.name, email: customer.email ?? undefined, phone: customer.phone ?? undefined, signingMethod },
      attachments: [{ fileName: quotePdf.filename, base64: quotePdf.pdf.toString('base64') }], // 견적서 동봉
      signFields,
      signatureType,
    }));
  } catch (e) {
    // 발송 실패 — 방금 만든 DRAFT 껍데기를 지운다.
    // 남겨두면 '준비' 상태로 목록에 뜨고 재발송까지 막혀 손쓸 수 없게 된다.
    await p.purchaseContract.delete({ where: { id: contract.id } }).catch(() => {});
    throw e;
  }

  // ★ 서류 고정은 **발송이 성공한 뒤**에만. 고객에게 실제로 나간 문서를 정본으로 굳힌다.
  //   발송 전에 굳히면, 실패했을 때 수정도 재발송도 못 하는 상태로 잠긴다.
  await freezeQuoteDocs(quoteId);

  return p.purchaseContract.update({
    where: { id: contract.id },
    data: { modusign_document_id: documentId, status: 'SENT', sent_at: new Date() },
  });
}

/**
 * 전자서명이 완료되면 견적 단계를 **계약완료(contracted)** 로 올린다.
 * 이미 더 진행된 단계(배정·주문·완료)면 되돌리지 않는다.
 */
async function advanceQuoteToContracted(quoteId: number): Promise<void> {
  const p = db();
  const q = await p.quote.findUnique({ where: { id: quoteId }, select: { status: true } });
  if (!q || !['draft', 'confirmed'].includes(q.status)) return;
  await setQuoteStatus(quoteId, 'contracted', 'system(전자서명 완료)');
  console.info(`[contract] 견적 ${quoteId} 단계 ${q.status} → contracted(계약완료)`);
}

/**
 * 완료된 서명본 PDF 를 내려받아 저장한다. **실패해도 예외를 던지지 않는다**(경로 or null).
 * 서명 완료 상태 전이가 부수 작업 때문에 막히면 안 된다.
 */
async function saveSignedPdf(contractId: number, quoteId: number, documentId: string): Promise<string | null> {
  try {
    const pdf = await modusign.downloadSignedPdf(documentId);
    const dir = path.join(docStorageDir(), 'quotes', String(quoteId));
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `contract_signed_${contractId}.pdf`);
    await writeFile(filePath, pdf);
    return filePath;
  } catch (e) {
    console.error(`[contract] 서명본 저장 실패(상태는 반영함) contract=${contractId}:`,
      e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 서명본 PDF 를 **확실히 손에 넣는다** — 없으면 지금 받아서 저장한다.
 *
 * 서명본 저장은 상태 전이의 부수 작업이라 실패해도 넘어간다(그래야 단계가 막히지 않는다).
 * 그래서 완료됐는데 파일이 없는 계약이 남을 수 있다 — 실제로 다운로드 방식이 틀려
 * 한동안 전부 비어 있었다. 열람 시점에 다시 시도해 메꾼다.
 *
 * @returns 저장된 파일 경로. 아직 완료 전이거나 받지 못하면 null.
 */
export async function ensureSignedPdf(quoteId: number): Promise<string | null> {
  const p = db();
  const contract = await getLatestContract(quoteId);
  if (!contract || contract.status !== 'COMPLETED' || !contract.modusign_document_id) return null;

  if (contract.signed_pdf_path && existsSync(contract.signed_pdf_path)) return contract.signed_pdf_path;

  const saved = await saveSignedPdf(contract.id, quoteId, contract.modusign_document_id);
  if (!saved) return null;
  await p.purchaseContract.update({ where: { id: contract.id }, data: { signed_pdf_path: saved } });
  console.info(`[contract] 견적 ${quoteId} 서명본 저장 완료 — ${saved}`);
  return saved;
}

/**
 * 모두싸인 API 로 실제 상태를 다시 읽어 반영한다 — **웹훅 유실 복구용**.
 *
 * 웹훅은 유실되거나(네트워크·배포 중 재시작) 스펙 불일치로 무시될 수 있다.
 * 실제로 event 가 객체로 와서 전부 무시된 사고가 있었고, 그동안 서명을 마쳐도
 * 단계가 넘어가지 않았다. 그때 손으로 되살릴 방법이 필요하다.
 *
 * 웹훅 처리(handleModusignEvent)와 같은 갱신 경로를 쓰되, 이쪽은 사람이 부른다.
 */
export async function refreshContractStatus(quoteId: number): Promise<PurchaseContract | null> {
  const p = db();
  const contract = await getLatestContract(quoteId);
  if (!contract?.modusign_document_id) return contract;
  if (TERMINAL.includes(contract.status)) return contract;   // 이미 종료 — 되돌리지 않는다

  const doc = await modusign.getDocument(contract.modusign_document_id);
  // ⚠️ 문서 상태는 **웹훅 이벤트 이름과 다른 어휘**다(이벤트: document_all_signed /
  //    문서상태: COMPLETED 같은 식). 이벤트 매핑을 그대로 쓰면 항상 null 이 나온다.
  const mapped = mapDocStatus(doc.status);
  console.info(`[contract] 견적 ${quoteId} 문서상태 raw='${doc.status ?? ''}' → ${mapped ?? '매핑없음'}`);
  if (!mapped || mapped === contract.status) return contract;

  const data: { status: ContractStatus; signed_pdf_path?: string; completed_at?: Date } = { status: mapped };
  if (mapped === 'COMPLETED') {
    data.completed_at = new Date();
    // ⚠️ 서명본 저장은 **부수 작업**이다. 실패해도 상태 전이는 반영한다 —
    //    예전엔 여기서 던져 전체가 롤백돼, 서명이 끝났는데도 계약이 SENT 로 남았다.
    //    (다운로드는 signedUrlToken 이 필요해 실패했다. 나중에 재조회로 다시 시도할 수 있다)
    const saved = await saveSignedPdf(contract.id, contract.quote_id, contract.modusign_document_id);
    if (saved) data.signed_pdf_path = saved;
  }
  console.info(`[contract] 견적 ${quoteId} 상태 재조회 ${contract.status} → ${mapped}`);
  const updated = await p.purchaseContract.update({ where: { id: contract.id }, data });
  if (mapped === 'COMPLETED') await advanceQuoteToContracted(quoteId);
  return updated;
}

/**
 * 모두싸인 **문서 상태**(getDocument) → 내부 상태.
 * 웹훅 이벤트 이름과 어휘가 다르다. 정확한 값 목록이 문서로 확인되지 않아
 * 대표 문자열을 포함 여부로 판정하고, **원본을 로그에 남겨** 나중에 좁힌다.
 */
export function mapDocStatus(raw: unknown): ContractStatus | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim().toUpperCase();
  if (v.includes('COMPLET') || v.includes('ALL_SIGNED') || v === 'DONE') return 'COMPLETED';
  if (v.includes('REJECT')) return 'REJECTED';
  if (v.includes('CANCEL') || v.includes('EXPIRE')) return 'CANCELED';
  if (v.includes('SIGNING') || v.includes('ON_GOING') || v.includes('ONGOING')
      || v.includes('SENT') || v.includes('START') || v.includes('PROGRESS')) return 'SENT';
  return null;
}

// ── webhook 처리 ────────────────────────────────────────────────────────────

/**
 * 모두싸인 이벤트타입 → 내부 상태. ⚠️ 이벤트 문자열은 실 webhook 로 확정 필요(초안).
 * 실제 값 확인되면 이 매핑만 보정.
 */
/**
 * 모두싸인 이벤트 → 내부 상태. **구독 중인 5개만** 매핑한다(모르는 이벤트는 무시).
 *
 * ⚠️ 서명자가 1명이라 document_signed 는 발생하지 않는다(모두싸인 사양: 마지막
 *    서명자 서명 시 미발행). 따라서 SENT → COMPLETED 로 바로 전이하며 SIGNING 은
 *    실제로 쓰이지 않는다(enum 은 향후 다자서명 대비로 남겨둠).
 * ⚠️ document_signing_canceled = 고객이 서명을 취소한 것 → 발송 대기(SENT)로 복귀.
 *    document_request_canceled = 요청 자체 취소 → CANCELED(종료).
 */
const EVENT_STATUS: Record<string, ContractStatus> = {
  document_started:           'SENT',
  document_all_signed:        'COMPLETED',
  document_rejected:          'REJECTED',
  document_request_canceled:  'CANCELED',
  document_signing_canceled:  'SENT',
};

export function mapEventToStatus(eventType: string): ContractStatus | null {
  return EVENT_STATUS[eventType.trim().toLowerCase()] ?? null;
}

const TERMINAL: ContractStatus[] = ['COMPLETED', 'REJECTED', 'CANCELED'];

/**
 * webhook 이벤트 반영. 멱등(dedup) + 실상태 재조회(위조 방어) + 상태갱신 + 완료 시 서명본 저장.
 * 라우트에서 즉시 2xx 응답 후 호출(비동기). 예외는 호출부에서 로깅.
 */
export async function handleModusignEvent(documentId: string, eventType: string): Promise<void> {
  const p = db();

  // 멱등: (document_id, event_type) 유일 제약. 중복이면 여기서 조용히 종료.
  try {
    await p.modusignWebhookEvent.create({ data: { document_id: documentId, event_type: eventType } });
  } catch {
    return; // 이미 처리한 이벤트
  }

  const contract = await p.purchaseContract.findUnique({ where: { modusign_document_id: documentId } });
  if (!contract) return; // 우리 계약이 아님
  if (TERMINAL.includes(contract.status)) return; // 이미 종료상태 — 되돌리지 않음

  // 위조 방어: webhook 서명검증 secret 미확정 → API 로 실제 상태 재조회해 교차검증.
  let mapped = mapEventToStatus(eventType);
  try {
    const doc = await modusign.getDocument(documentId);
    if (doc.status) {
      // ⚠️ 문서 상태는 이벤트 이름과 **어휘가 다르다**(document_all_signed vs COMPLETED).
      //    여기서 이벤트 매핑을 쓰면 항상 null 이라 교차검증이 사실상 꺼져 있었다.
      const fromApi = mapDocStatus(doc.status);
      if (fromApi) mapped = fromApi; // API 실상태 우선
    }
  } catch {
    // 재조회 실패 시 이벤트 매핑값으로 진행(로그는 호출부)
  }
  if (!mapped) {
    console.warn(`[webhook/modusign] 매핑되지 않은 이벤트 '${eventType}' (document ${documentId}) — 무시`);
    return;
  }

  const data: { status: ContractStatus; signed_pdf_path?: string; completed_at?: Date } = { status: mapped };

  if (mapped === 'COMPLETED') {
    const filePath = await saveSignedPdf(contract.id, contract.quote_id, documentId);
    if (filePath) data.signed_pdf_path = filePath;
    data.completed_at = new Date();
  }

  await p.purchaseContract.update({ where: { id: contract.id }, data });
  // ⚠️ 이 한 줄이 빠져 있었다. 계약은 COMPLETED 가 되는데 견적은 confirmed 에 머물러,
  //    서명을 마쳐도 「배정」 버튼이 계속 잠겨 있었다(수동 재조회 경로에만 있었다).
  if (mapped === 'COMPLETED') await advanceQuoteToContracted(contract.quote_id);
}

/** 모두싸인 webhook body 에서 문서id·이벤트타입 추출(스키마 초안 — 실 webhook 로 확정). */
/**
 * webhook payload → { documentId, eventType }.
 *
 * ⚠️ 모두싸인은 `event` 를 **객체**로 보낸다(문자열이 아니다). 예전 구현이 그대로
 *    String() 으로 감싸 `[object Object]` 가 저장됐고, 상태 매핑이 전부 실패해
 *    **서명을 완료해도 단계가 넘어가지 않았다**(실제 사고). 값이 객체면 안쪽에서
 *    타입 문자열을 꺼낸다.
 */
export function extractWebhookEvent(body: unknown): { documentId: string; eventType: string } | null {
  const b = (body ?? {}) as Record<string, any>;

  /** 문자열이면 그대로, 객체면 흔한 키에서 타입 문자열을 꺼낸다. */
  const asType = (v: unknown): string | null => {
    if (typeof v === 'string') return v.trim() || null;
    if (v && typeof v === 'object') {
      for (const k of ['type', 'name', 'eventType', 'event_type', 'event']) {
        const inner = (v as Record<string, unknown>)[k];
        if (typeof inner === 'string' && inner.trim()) return inner.trim();
      }
    }
    return null;
  };

  const documentId = b.documentId ?? b.document_id ?? b.document?.id ?? b.data?.documentId ?? b.data?.document?.id;
  const eventType =
    asType(b.event) ?? asType(b.eventType) ?? asType(b.event_type) ?? asType(b.type) ?? asType(b.data?.event);

  if (!documentId || !eventType) {
    // 파싱 실패는 스펙 불일치다 — 원본을 남겨야 다음에 고칠 수 있다(자격증명 없음).
    console.error('[webhook/modusign] 파싱 실패 payload:', JSON.stringify(body).slice(0, 800));
    return null;
  }
  return { documentId: String(documentId), eventType };
}
