/**
 * 이메일 발송 — 견적서·계약서 PDF 를 고객에게 전달(Gmail SMTP, 회사 공용 계정).
 * 인증: 무료 Gmail + 2단계인증 + '앱 비밀번호'. 자격증명은 서버 .env 에만(커밋·프론트 노출 금지).
 *   MAIL_SMTP_USER = 발신 gmail 주소, MAIL_SMTP_PASS = 앱 비밀번호,
 *   MAIL_FROM_NAME(선택) = 표시이름, MAIL_SMTP_HOST/PORT(선택, 기본 smtp.gmail.com:465).
 * 전자서명(모두싸인)과는 별개 — 이건 서류 '전달' 채널.
 */
import { createTransport } from 'nodemailer';
import { prisma } from '../lib/prisma.js';
import { generateQuotePdf } from './quote-pdf.js';
import { generateContractPdf } from './contract-pdf.js';
import { buildContractInput } from './contract.js';

export class EmailConfigError extends Error {}
export class EmailError extends Error {}

function transport() {
  const user = process.env['MAIL_SMTP_USER'];
  const pass = process.env['MAIL_SMTP_PASS'];
  if (!user || !pass) throw new EmailConfigError('MAIL_SMTP_USER/MAIL_SMTP_PASS 미설정 (배포담당 서버 .env 주입 필요)');
  return createTransport({
    host: process.env['MAIL_SMTP_HOST'] || 'smtp.gmail.com',
    port: Number(process.env['MAIL_SMTP_PORT'] || 465),
    secure: true,
    auth: { user, pass },
  });
}

export interface SendDocsOpts {
  to?: string;              // 미지정 시 고객 이메일 사용
  cc?: string;
  subject?: string;
  message?: string;
  includeContract?: boolean; // 기본 true — 견적서+계약서. false면 견적서만
}

/** 견적서(+계약서) PDF 를 고객 이메일로 발송. */
export async function sendQuoteDocsEmail(quoteId: number, opts: SendDocsOpts): Promise<{ to: string; attachments: string[] }> {
  if (!prisma) throw new EmailConfigError('DB 사용 불가');
  const quote = await prisma.quote.findUnique({ where: { id: quoteId }, include: { customer: true } });
  if (!quote) throw new EmailError('견적을 찾을 수 없습니다');

  const to = (opts.to || quote.customer?.email || '').trim();
  if (!to) throw new EmailError('받는 사람 이메일이 없습니다 (고객 이메일 미등록 — 직접 입력 필요)');

  const includeContract = opts.includeContract !== false;
  const custName = quote.customer?.name ?? '';

  // 첨부 생성: 견적서 (+ 계약서)
  const attachments: { filename: string; content: Buffer }[] = [];
  const q = await generateQuotePdf(quoteId);
  attachments.push({ filename: q.filename, content: q.pdf });
  if (includeContract) {
    const { input } = await buildContractInput(quoteId);
    const cpdf = await generateContractPdf(input);
    attachments.push({ filename: `특장매매계약서_견적${quoteId}.pdf`, content: cpdf });
  }

  const fromName = process.env['MAIL_FROM_NAME'] || 'EV&Solution';
  const fromUser = process.env['MAIL_SMTP_USER']!;
  const subject = opts.subject
    || `[EV&Solution] 견적서${includeContract ? ' 및 계약서' : ''} 안내${custName ? ` - ${custName}` : ''}`;
  const text = opts.message
    || `안녕하세요${custName ? ` ${custName}님` : ''},\n\n요청하신 견적서${includeContract ? '와 계약서' : ''}를 첨부드립니다.\n검토 후 회신 부탁드립니다.\n\n감사합니다.\nEV&Solution`;

  try {
    await transport().sendMail({
      from: `"${fromName}" <${fromUser}>`,
      to,
      cc: opts.cc || undefined,
      subject,
      text,
      attachments,
    });
  } catch (e) {
    throw new EmailError(`이메일 발송 실패: ${e instanceof Error ? e.message : String(e)}`);
  }

  return { to, attachments: attachments.map((a) => a.filename) };
}
