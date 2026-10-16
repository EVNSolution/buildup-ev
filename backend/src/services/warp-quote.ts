import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { VISIBLE } from '../lib/visibility.js';
import { generateQuotePdf, type WarpQuoteFacts } from './quote-pdf.js';

export class WarpQuoteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validWarpCustomerId(id: string): boolean { return /^[A-Za-z0-9_-]{1,40}$/.test(id); }
export function validFacts(facts: unknown): facts is WarpQuoteFacts {
  if (!facts || typeof facts !== 'object') return false;
  const f = facts as WarpQuoteFacts;
  return typeof f.model === 'string' && !!f.model.trim() && f.model.length <= 500
    && typeof f.spec === 'string' && !!f.spec.trim() && f.spec.length <= 500
    && Number.isSafeInteger(f.grossAmountWon) && f.grossAmountWon >= 0
    && Number.isSafeInteger(f.amountWon) && f.amountWon >= 0;
}
export function readFrozenFacts(raw: string, pdf: Buffer): WarpQuoteFacts {
  try {
    const saved = JSON.parse(raw);
    if (saved.version === 1 && saved.pdfSha256 === createHash('sha256').update(pdf).digest('hex') && validFacts(saved.facts)) return saved.facts;
  } catch { /* Missing or invalid historical facts must not be recalculated at current prices. */ }
  throw new WarpQuoteError(409, '고정 견적서의 금액·사양 원본을 확인할 수 없습니다. 기존 PDF를 확인하여 WARP에 직접 입력해 주세요.');
}
function linkedWhere(warpCustomerId: string) {
  return { ...VISIBLE, customer: { ...VISIBLE, warp_customer_id: warpCustomerId } };
}
export async function listWarpQuotes(warpCustomerId: string) {
  if (!prisma) throw new WarpQuoteError(503, 'DB 연결 필요');
  // shortcut: show the newest 100 quotes per customer; add pagination if older-quote selection is needed.
  const quotes = await prisma.quote.findMany({
    where: linkedWhere(warpCustomerId), orderBy: [{ updated_at: 'desc' }, { id: 'desc' }], take: 101,
    select: { id: true, quote_no: true, status: true, updated_at: true, docs_emailed_at: true,
      docs_frozen_at: true, model: { select: { name: true } } },
  });
  return { quotes: quotes.slice(0, 100).map(q => ({
    id: q.id, quoteNo: q.quote_no, status: q.status, updatedAt: q.updated_at.toISOString(),
    model: q.model.name, sentAt: q.docs_emailed_at?.toISOString() ?? null,
    frozenAt: q.docs_frozen_at?.toISOString() ?? null,
  })), hasMore: quotes.length > 100 };
}
export async function exportWarpQuote(warpCustomerId: string, quoteId: number) {
  if (!prisma) throw new WarpQuoteError(503, 'DB 연결 필요');
  const where = { ...linkedWhere(warpCustomerId), id: quoteId };
  const quote = await prisma.quote.findFirst({ where });
  if (!quote) throw new WarpQuoteError(404, '연결된 고객의 견적서를 찾을 수 없습니다.');
  let pdf: Buffer;
  let facts: WarpQuoteFacts;
  if (quote.docs_frozen_at) {
    try {
      if (!quote.docs_frozen_quote_path) throw new Error('missing');
      pdf = await readFile(quote.docs_frozen_quote_path);
      facts = readFrozenFacts(await readFile(`${quote.docs_frozen_quote_path}.warp.json`, 'utf8'), pdf);
    } catch {
      throw new WarpQuoteError(409, '고정 견적서의 수치 원본이 없습니다. 과거 PDF 금액을 추정하지 않으므로 WARP에서 직접 입력해 주세요.');
    }
  } else {
    const generated = await generateQuotePdf(quote.id, { archive: false });
    pdf = generated.pdf; facts = generated.warpFacts;
  }
  if (!validFacts(facts) || pdf.length === 0 || pdf.length > 20 * 1024 * 1024 || !pdf.subarray(0, 5).equals(Buffer.from('%PDF-')))
    throw new WarpQuoteError(409, '견적서 파일과 수치를 확인해 주세요. 자동 입력할 수 없습니다.');
  // Recheck ownership and revision after rendering; reassigned/edited quotes must never cross customers.
  const current = await prisma.quote.findFirst({ where });
  if (!current || current.updated_at.getTime() !== quote.updated_at.getTime())
    throw new WarpQuoteError(409, '견적서 또는 고객 연결이 변경되었습니다. 다시 조회해 주세요.');
  const data = {
    quoteId: quote.id, quoteNo: quote.quote_no, warpCustomerId,
    updatedAt: quote.updated_at.toISOString(), frozen: !!quote.docs_frozen_at,
    ...facts,
  };
  // PDF creation timestamps vary between renders. Preview validity follows the exact displayed business facts.
  const version = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return { ...data, version, pdfBase64: pdf.toString('base64'), pdfSha256: createHash('sha256').update(pdf).digest('hex') };
}
