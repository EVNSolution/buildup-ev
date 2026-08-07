/**
 * 서류 고정 — 전자서명 '요청 발송' 시점에 견적서·계약서 PDF 를 파일로 굳힌다.
 *
 * 왜 필요한가:
 *   견적서·계약서 PDF 는 요청할 때마다 즉석 렌더한다. 무엇을 골랐는지(quote.selections)는
 *   스냅샷이지만 **단가·세율·보조금은 매번 DB 현재값을 읽는다**. 그래서 옵션 단가를 바꾸면
 *   지난 견적서를 다시 열었을 때 금액이 달라진다. 고객이 서명한(또는 서명하러 받은) 문서와
 *   시스템이 어긋나면 안 되므로, 그 시점의 PDF 를 **바이트 그대로** 보관한다.
 *
 * 왜 값 스냅샷이 아니라 파일인가:
 *   값만 저장하고 다시 렌더하면 계산 코드나 템플릿이 바뀔 때 결과가 달라질 수 있다.
 *   파일을 보관하면 무엇이 바뀌든 절대 변하지 않는다.
 */
import path from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { prisma } from '../lib/prisma.js';
import { generateQuotePdf } from './quote-pdf.js';
import { renderContractPdfForQuote } from './contract-docgen.js';

export class DocFreezeError extends Error {}

/** 서류 저장 루트 — 배포 워크트리 밖(재배포로 지워지면 안 된다). */
function storageRoot(): string {
  const dir = process.env['DOC_STORAGE_DIR'];
  if (dir) return dir;
  if (process.env['NODE_ENV'] === 'production') {
    throw new DocFreezeError('DOC_STORAGE_DIR 미설정(프로덕션 필수)');
  }
  return path.resolve(process.cwd(), '../.local-doc-storage');
}

export interface FrozenDocs {
  frozenAt: Date;
  quotePath: string;
  contractPath: string;
  /** 이미 고정돼 있어 다시 굳히지 않은 경우 true */
  alreadyFrozen: boolean;
}

/**
 * 견적의 서류를 고정한다. **이미 고정돼 있으면 아무것도 하지 않는다**(재발송 시 옛 문서 보존).
 * 서명 요청 발송 직전에 호출한다.
 */
export async function freezeQuoteDocs(quoteId: number): Promise<FrozenDocs> {
  if (!prisma) throw new DocFreezeError('DB 연결 필요');

  const quote = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { id: true, docs_frozen_at: true, docs_frozen_quote_path: true, docs_frozen_contract_path: true },
  });
  if (!quote) throw new DocFreezeError('견적을 찾을 수 없습니다');

  // 이미 고정 — 재발송해도 처음 보낸 문서가 정본이다.
  if (quote.docs_frozen_at && quote.docs_frozen_quote_path && quote.docs_frozen_contract_path) {
    return {
      frozenAt: quote.docs_frozen_at,
      quotePath: quote.docs_frozen_quote_path,
      contractPath: quote.docs_frozen_contract_path,
      alreadyFrozen: true,
    };
  }

  const [q, c] = await Promise.all([generateQuotePdf(quoteId), renderContractPdfForQuote(quoteId)]);

  const dir = path.join(storageRoot(), 'quotes', String(quoteId));
  await mkdir(dir, { recursive: true });
  const quotePath = path.join(dir, 'frozen_quote.pdf');
  const contractPath = path.join(dir, 'frozen_contract.pdf');
  await writeFile(quotePath, q.pdf);
  await writeFile(contractPath, c.pdf);

  const frozenAt = new Date();
  await prisma.quote.update({
    where: { id: quoteId },
    data: { docs_frozen_at: frozenAt, docs_frozen_quote_path: quotePath, docs_frozen_contract_path: contractPath },
  });

  return { frozenAt, quotePath, contractPath, alreadyFrozen: false };
}

/**
 * 고정된 서류가 있으면 그 파일을 돌려준다(없으면 null → 호출부가 즉석 렌더).
 * 파일이 사라졌다면 null 을 반환해 최소한 문서는 열리게 한다(로그만 남긴다).
 */
export async function readFrozenDoc(quoteId: number, kind: 'quote' | 'contract'): Promise<Buffer | null> {
  if (!prisma) return null;
  const q = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { docs_frozen_at: true, docs_frozen_quote_path: true, docs_frozen_contract_path: true },
  });
  if (!q?.docs_frozen_at) return null;
  const p = kind === 'quote' ? q.docs_frozen_quote_path : q.docs_frozen_contract_path;
  if (!p) return null;
  try {
    return await readFile(p);
  } catch {
    console.error(`[readFrozenDoc] 고정 서류 파일 없음 — 즉석 렌더로 대체: quote=${quoteId} ${kind} ${p}`);
    return null;
  }
}

/** 고정 여부 — 입력 수정 차단 판정에 쓴다. */
export async function isFrozen(quoteId: number): Promise<boolean> {
  if (!prisma) return false;
  const q = await prisma.quote.findUnique({ where: { id: quoteId }, select: { docs_frozen_at: true } });
  return !!q?.docs_frozen_at;
}

export const FROZEN_MESSAGE =
  '전자서명 요청이 발송되어 서류가 고정되었습니다. 고객이 받은 문서와 어긋나지 않도록 수정할 수 없습니다.';
