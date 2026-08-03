/**
 * 구매계약서 PDF 생성 — ⚠️ 지금은 placeholder.
 * 실계약서 양식(법무 검토본)이 확정되면 이 파일의 buildContractHtml 만 교체한다.
 * generateContractPdf 의 시그니처(ContractInput → PDF)와 anchor 텍스트 규약은 유지 →
 * 발송기(modusign)·상태모델·webhook·UI 는 손대지 않아도 된다.
 *
 * 서명 필드는 좌표가 아니라 anchor 텍스트로 잡는다. 실양식에도 아래 3개 텍스트만 포함시키면 됨:
 *   [고객서명]  → SIGNATURE
 *   [서명일자]  → SIGNING_DATE
 *   [고객성명]  → TEXT(성명 확인)
 */
import { htmlToPdf } from '../lib/soffice.js';

export const CONTRACT_ANCHORS = {
  SIGNATURE: '[고객서명]',
  SIGNING_DATE: '[서명일자]',
  CUSTOMER_NAME: '[고객성명]',
} as const;

export interface ContractInput {
  order_id: string;
  customer: { name: string; email?: string; phone?: string; biz_no?: string };
  vehicle: { model: string; options: string[] };
  price: { supply: number; vat: number; total: number };
  terms: Record<string, string | number>; // 납기·특약 등 가변
}

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
}
function won(n: number): string {
  return '₩' + Math.round(n || 0).toLocaleString('ko-KR');
}

/** ⚠️ placeholder 레이아웃. 실양식 확정 시 교체. anchor 텍스트는 반드시 유지. */
function buildContractHtml(input: ContractInput): string {
  const { customer, vehicle, price, terms } = input;
  const optRows = vehicle.options.map((o) => `<li>${esc(o)}</li>`).join('') || '<li>-</li>';
  const termRows = Object.entries(terms)
    .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
    .join('') || '<tr><td colspan="2">-</td></tr>';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Noto Sans CJK KR','맑은 고딕',sans-serif;font-size:12px;color:#000;padding:24px;}
    h1{font-size:20px;text-align:center;margin-bottom:20px;}
    table{width:100%;border-collapse:collapse;margin:8px 0;}
    th,td{border:1px solid #000;padding:6px 8px;text-align:left;vertical-align:top;}
    th{width:130px;background:#f0f0f0;}
    .sign{margin-top:36px;}
    .sign td{border:none;padding:10px 8px;}
    .note{color:#666;font-size:10px;margin-top:24px;}
  </style></head><body>
    <h1>전기특장차 구매계약서 (예시본)</h1>
    <p>⚠️ 본 문서는 연동 테스트용 placeholder 이며, 실제 계약 효력이 없습니다. 실계약서 양식 확정 시 교체됩니다.</p>

    <table>
      <tr><th>주문번호</th><td>${esc(input.order_id)}</td></tr>
      <tr><th>차종</th><td>${esc(vehicle.model)}</td></tr>
      <tr><th>선택옵션</th><td><ul style="margin:0;padding-left:16px;">${optRows}</ul></td></tr>
    </table>

    <table>
      <tr><th>공급가액</th><td>${won(price.supply)}</td></tr>
      <tr><th>부가세</th><td>${won(price.vat)}</td></tr>
      <tr><th>합계</th><td><b>${won(price.total)}</b></td></tr>
    </table>

    <table>${termRows}</table>

    <table>
      <tr><th>매수인(고객)</th><td>${esc(customer.name)}</td></tr>
      <tr><th>연락처</th><td>${esc(customer.email || customer.phone || '')}</td></tr>
      ${customer.biz_no ? `<tr><th>사업자번호</th><td>${esc(customer.biz_no)}</td></tr>` : ''}
    </table>

    <table class="sign">
      <tr>
        <td>성명 확인: ${CONTRACT_ANCHORS.CUSTOMER_NAME}</td>
        <td>서명일자: ${CONTRACT_ANCHORS.SIGNING_DATE}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding-top:24px;">고객 서명: ${CONTRACT_ANCHORS.SIGNATURE}</td>
      </tr>
    </table>

    <div class="note">anchor: 서명=${CONTRACT_ANCHORS.SIGNATURE}, 일자=${CONTRACT_ANCHORS.SIGNING_DATE}, 성명=${CONTRACT_ANCHORS.CUSTOMER_NAME}</div>
  </body></html>`;
}

/** 계약서 PDF(Buffer). 실양식 확정 전까지 placeholder. */
export async function generateContractPdf(input: ContractInput): Promise<Buffer> {
  return htmlToPdf(buildContractHtml(input));
}
