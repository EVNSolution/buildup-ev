/**
 * 견적서 PDF 생성 — quoteId → PDF(Buffer). 라우트(GET /quotes/:id/pdf)와 계약서 발송(견적서 동봉)이 공유.
 * 렌더 로직 단일화 — 두 곳에서 같은 견적서가 나오도록.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prisma } from '../lib/prisma.js';

const TEMPLATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../templates/quote-pdf.html'),
  'utf-8',
);

export class QuotePdfError extends Error {
  constructor(message: string, public code: 'NOT_FOUND' | 'DB_UNAVAILABLE' = 'NOT_FOUND') { super(message); }
}

export interface QuotePdfResult { pdf: Buffer; filename: string; customerName: string | null }

export async function generateQuotePdf(quoteId: number): Promise<QuotePdfResult> {
  if (!prisma) throw new QuotePdfError('DB 연결 필요', 'DB_UNAVAILABLE');

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    include: {
      customer: true,
      order: { select: { maker_org: { select: { code: true, name: true } } } },
    },
  });
  if (!quote) throw new QuotePdfError('견적을 찾을 수 없습니다', 'NOT_FOUND');

  const selections = (quote.selections ?? {}) as Record<string, string>;
  const valueCodes = Object.values(selections).filter(Boolean);
  const groupCodes = Object.keys(selections).filter(Boolean);

  const [optionValues, optionGroups, optionPrices] = await Promise.all([
    prisma.optionValue.findMany({ where: { code: { in: valueCodes } } }),
    prisma.optionGroup.findMany({ where: { code: { in: groupCodes } } }),
    prisma.optionPrice.findMany({ where: { model_code: quote.model_code, value_code: { in: valueCodes } } }),
  ]);

  const valueMap = new Map(optionValues.map((v) => [v.code, v.name]));
  const groupMap = new Map(optionGroups.map((g) => [g.code, g.name]));
  const priceMap = new Map(optionPrices.map((p) => [p.value_code, p.supply_price]));

  const OPTION_ROWS = Object.entries(selections).map(([gCode, vCode]) => {
    const gName = groupMap.get(gCode) ?? gCode;
    const vName = valueMap.get(vCode) ?? vCode;
    const price = priceMap.has(vCode) ? `₩${Number(priceMap.get(vCode)).toLocaleString()}` : '포함';
    return `<tr><td><div class="opt-group">${gName}</div><div class="opt-val">${vName}</div></td>`
         + `<td>${vCode}</td><td>${price}</td></tr>`;
  }).join('\n');

  const STATUS_KO: Record<string, string> = { draft: '임시저장', confirmed: '확정', ordered: '주문', expired: '만료' };
  const supplyPrice = Number(quote.supply_price);
  const finalPrice = Number(quote.final_price);
  const fmt = (n: number | null) => (n != null ? `₩${n.toLocaleString()}` : '—');

  const makerOrg = quote.order?.maker_org;
  const MAKER_BANNER = makerOrg
    ? `<div class="maker-banner"><div class="maker-banner-dot"></div><div>` +
      `<div class="maker-banner-label">배정 특장사</div>` +
      `<div class="maker-banner-name">${makerOrg.name} (${makerOrg.code})</div></div></div>`
    : '';

  const html = TEMPLATE
    .replace('{{QUOTE_NO}}', quote.quote_no ?? `Q-${String(quoteId).padStart(5, '0')}`)
    .replace('{{QUOTE_DATE}}', quote.created_at.toISOString().slice(0, 10))
    .replace('{{MODEL_CODE}}', quote.model_code)
    .replace('{{QUOTE_STATUS}}', STATUS_KO[quote.status] ?? quote.status)
    .replace('{{CUSTOMER_NAME}}', quote.customer?.name ?? '—')
    .replace('{{BIZ_TYPE}}', '—')
    .replace('{{REGION}}', '—')
    .replace('{{IS_SOSANG}}', '—')
    .replace('{{MAKER_BANNER}}', MAKER_BANNER)
    .replace('{{OPTION_ROWS}}', OPTION_ROWS)
    .replace('{{SUPPLY_PRICE}}', fmt(supplyPrice))
    .replace('{{VAT}}', '—')
    .replace('{{VEHICLE_PRICE}}', '—')
    .replace('{{SUBSIDY_NATIONAL}}', '—')
    .replace('{{SUBSIDY_LOCAL}}', '—')
    .replace('{{SUBSIDY_SOSANG}}', '—')
    .replace('{{TOTAL_SUBSIDY}}', '—')
    .replace('{{SUBSIDY_APPLIED}}', '—')
    .replace('{{VAT_REFUND_PRICE}}', '—')
    .replace('{{REG_FEE}}', '—')
    .replace('{{FINAL_PRICE}}', fmt(finalPrice));

  const { default: puppeteer } = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    // @ts-expect-error puppeteer 타입이 setContent 의 'networkidle0' 을 좁게 잡음(런타임 지원 — 웹폰트 로드 대기)
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = Buffer.from(await page.pdf({
      format: 'A4', printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' },
    }));
    const customerSlug = (quote.customer?.name ?? '').replace(/\s+/g, '_') || 'unknown';
    return { pdf, filename: `견적서_${customerSlug}_${quoteId}.pdf`, customerName: quote.customer?.name ?? null };
  } finally {
    await browser.close();
  }
}
