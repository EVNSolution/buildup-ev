/**
 * 구매계약 전자서명 오케스트레이션.
 * 발송: 계약서 PDF 생성 → 모두싸인 업로드 → purchase_contract(DRAFT→SENT).
 * webhook: 멱등 dedup → 실상태 재조회(위조 방어) → 상태갱신 → 완료 시 서명본 저장.
 * 양식은 generateContractPdf 뒤에 격리 — 여기 로직은 양식과 무관.
 */
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { ContractStatus, PurchaseContract, Customer } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { docStorageDir } from '../lib/soffice.js';
import { type ContractInput } from './contract-pdf.js';
import { renderContractPdfForQuote } from './contract-docgen.js';
import { freezeQuoteDocs } from './doc-freeze.js';
import { generateQuotePdf } from './quote-pdf.js';
import * as modusign from './modusign.js';
import type { SigningMethod } from './modusign.js';

export class ContractError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'NO_CUSTOMER' | 'NO_CONTACT' | 'DB_UNAVAILABLE' = 'NOT_FOUND') {
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
  const { customer } = await buildContractInput(quoteId);
  const contact = signingMethod === 'EMAIL' ? customer.email : customer.phone;
  if (!contact) {
    throw new ContractError(signingMethod === 'EMAIL' ? '고객 이메일이 없습니다' : '고객 휴대폰번호가 없습니다', 'NO_CONTACT');
  }

  // 계약서(서명대상) + 견적서(동봉) 생성.
  // 계약서는 영업페이지 미리보기·이메일과 **같은 렌더 경로**(새 양식) — 양식이 갈라지지 않게 한다.
  // ★ 서류 고정 — 고객에게 보내는 순간의 문서를 정본으로 굳힌다.
  //   이후 단가·세율이 바뀌어도 견적서·계약서는 이 파일 그대로 나간다.
  //   재발송이면 처음 굳힌 문서를 그대로 쓴다(alreadyFrozen).
  await freezeQuoteDocs(quoteId);

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

  const { documentId } = await modusign.sendDocument({
    title: `특장매매계약서_견적${quoteId}`,
    fileName: `contract_quote${quoteId}.pdf`,
    pdfBase64: contractPdf.toString('base64'),
    participant: { name: customer.name, email: customer.email ?? undefined, phone: customer.phone ?? undefined, signingMethod },
    attachments: [{ fileName: quotePdf.filename, base64: quotePdf.pdf.toString('base64') }], // 견적서 동봉
  });

  return p.purchaseContract.update({
    where: { id: contract.id },
    data: { modusign_document_id: documentId, status: 'SENT', sent_at: new Date() },
  });
}

// ── webhook 처리 ────────────────────────────────────────────────────────────

/**
 * 모두싸인 이벤트타입 → 내부 상태. ⚠️ 이벤트 문자열은 실 webhook 로 확정 필요(초안).
 * 실제 값 확인되면 이 매핑만 보정.
 */
export function mapEventToStatus(eventType: string): ContractStatus | null {
  const e = eventType.toLowerCase();
  if (e.includes('all_signed') || e.includes('completed')) return 'COMPLETED';
  if (e.includes('reject')) return 'REJECTED';
  if (e.includes('cancel')) return 'CANCELED';
  if (e.includes('signing') || e.includes('signed')) return 'SIGNING';
  if (e.includes('viewed') || e.includes('opened')) return 'VIEWED';
  if (e.includes('started') || e.includes('sent') || e.includes('requested')) return 'SENT';
  return null;
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
      const fromApi = mapEventToStatus(doc.status);
      if (fromApi) mapped = fromApi; // API 실상태 우선
    }
  } catch {
    // 재조회 실패 시 이벤트 매핑값으로 진행(로그는 호출부)
  }
  if (!mapped) return;

  const data: { status: ContractStatus; signed_pdf_path?: string; completed_at?: Date } = { status: mapped };

  if (mapped === 'COMPLETED') {
    const pdf = await modusign.downloadSignedPdf(documentId);
    const dir = path.join(docStorageDir(), 'quotes', String(contract.quote_id));
    await mkdir(dir, { recursive: true });
    const filePath = path.join(dir, `contract_signed_${contract.id}.pdf`);
    await writeFile(filePath, pdf);
    data.signed_pdf_path = filePath;
    data.completed_at = new Date();
  }

  await p.purchaseContract.update({ where: { id: contract.id }, data });
}

/** 모두싸인 webhook body 에서 문서id·이벤트타입 추출(스키마 초안 — 실 webhook 로 확정). */
export function extractWebhookEvent(body: unknown): { documentId: string; eventType: string } | null {
  const b = (body ?? {}) as Record<string, any>;
  const documentId = b.documentId ?? b.document_id ?? b.document?.id ?? b.data?.documentId ?? b.data?.document?.id;
  const eventType = b.event ?? b.eventType ?? b.event_type ?? b.type ?? b.data?.event;
  if (!documentId || !eventType) return null;
  return { documentId: String(documentId), eventType: String(eventType) };
}
