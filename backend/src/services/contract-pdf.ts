/**
 * 특장 매매 및 구조변경 계약서 PDF 생성.
 * 양식: doc-templates/contract/특장매매계약서_template.docx (원본 .docx 그대로 + {태그}·서명앵커·Noto폰트).
 *   - 템플릿 재생성: python3 doc-templates/builders/gen_contract_template.py <원본.docx> <template.docx>
 *   - 양식이 바뀌면 원본 .docx 교체 후 위 스크립트로 템플릿만 다시 생성(코드 불변).
 * generateContractPdf 시그니처(ContractInput → PDF)와 anchor 규약은 유지 →
 * 발송기(modusign)·상태모델·webhook·UI 는 손대지 않아도 된다.
 *
 * 서명 앵커(템플릿 하단 매수인 서명란에 각 1회): [고객성명]=TEXT, [고객서명]=SIGNATURE, [서명일자]=SIGNING_DATE.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { docxToPdf } from '../lib/soffice.js';

export const CONTRACT_ANCHORS = {
  SIGNATURE: '[고객서명]',
  SIGNING_DATE: '[서명일자]',
  CUSTOMER_NAME: '[고객성명]',
} as const;

export interface ContractInput {
  order_id: string;              // 계약번호 표기용(견적 id)
  contract_date?: string;        // 계약일자 (예: "2026년 8월 3일")
  customer: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    address_detail?: string;     // 동·호수 등 상세주소
    biz_no?: string;             // 생년월일(사업자번호)
  };
  vehicle: { model: string; options: string[] };
  /** 특장 사양(계약서 필드명→표시 라벨). buildContractInput 에서 옵션코드→라벨로 해결. */
  spec?: Record<string, string>;
  price: { supply: number; vat: number; total: number };
  terms: Record<string, string | number>;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.resolve(__dirname, '../../..', 'doc-templates/contract/특장매매계약서_template.docx');

function won(n: number): string {
  return (Math.round(n || 0)).toLocaleString('ko-KR');
}

/** ContractInput → 템플릿 {태그} 데이터. 없는 값은 빈 문자열(수기 기입). */
function tagData(input: ContractInput): Record<string, string> {
  const spec = input.spec ?? {};
  return {
    계약번호: input.order_id ?? '',
    계약일자: input.contract_date ?? '',
    성명: input.customer.name ?? '',
    사업자번호: input.customer.biz_no ?? '',
    주소: [input.customer.address, input.customer.address_detail].filter(Boolean).join(' ').trim(),
    휴대폰: input.customer.phone ?? '',
    이메일: input.customer.email ?? '',
    // 특장 사양(옵션코드→라벨은 buildContractInput 에서 해결)
    탑종류: spec['탑종류'] ?? '',
    탑높이: spec['탑높이'] ?? '',
    도어옵션: spec['도어옵션'] ?? '',
    스포일러: spec['스포일러'] ?? '',
    도어추가: spec['도어추가'] ?? '',
    온도기록계: spec['온도기록계'] ?? '',
    격벽: spec['격벽'] ?? '',
    특장가격: won(input.price.total),
    계약금: '', // 시스템 미보유(수기)
    잔금: '',   // 시스템 미보유(수기)
  };
}

/** 특장매매계약서 PDF(Buffer). 템플릿 docx 를 docxtemplater 로 채운 뒤 soffice 로 PDF 변환. */
export async function generateContractPdf(input: ContractInput): Promise<Buffer> {
  const templateBuf = await readFile(TEMPLATE_PATH);
  const zip = new PizZip(templateBuf);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '', // 미제공 태그는 공란
  });
  doc.render(tagData(input));
  const filled = doc.getZip().generate({ type: 'nodebuffer' }) as Buffer;
  return docxToPdf(filled);
}
