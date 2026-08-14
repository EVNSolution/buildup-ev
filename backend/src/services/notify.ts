/**
 * 내부 알림 — **사람이 기다리고 있는 것만** 즉시 보낸다.
 *
 * 단계가 늘어날수록 건건이 보내면 하루에 열 통이 되고, 열 통이 되는 순간 아무도 안 본다.
 * 나머지는 매일 아침 한 통으로 묶는다(4단계 예정 — docs/process-redesign.md §6).
 * 지금 즉시 보내는 것은 하나뿐이다: **서명 완료 → 관리자에게 제작 배정 요청.**
 *
 * ⚠️ 알림 실패가 본 작업을 막지 않는다. 계약이 성사됐는데 메일이 안 나갔다고
 *    상태 전이가 롤백되면 더 큰 사고다 — 여기서는 삼키고 로그만 남긴다.
 */
import { createTransport } from 'nodemailer';
import { prisma } from '../lib/prisma.js';

const BASE_URL = process.env['PUBLIC_BASE_URL'] || 'https://buildup-ev.cleversystem.ai';

function transport() {
  const user = process.env['MAIL_SMTP_USER'];
  const pass = process.env['MAIL_SMTP_PASS'];
  if (!user || !pass) return null;
  return createTransport({
    host: process.env['MAIL_SMTP_HOST'] || 'smtp.gmail.com',
    port: Number(process.env['MAIL_SMTP_PORT'] || 465),
    secure: true,
    auth: { user, pass },
  });
}

/**
 * 받는 사람 — 기본은 **활성 관리자 계정 전원**.
 *
 * `NOTIFY_ADMIN_TO` 가 있으면 그것만 쓴다(제조운영 그룹 메일 하나로 받고 싶을 때).
 * 나중에 기능모듈 `order.po.issue` 가 생기면 그 권한을 가진 계정으로 좁힌다.
 */
async function adminRecipients(): Promise<string[]> {
  const override = process.env['NOTIFY_ADMIN_TO'];
  if (override) return override.split(',').map(s => s.trim()).filter(Boolean);
  if (!prisma) return [];
  const admins = await prisma.user.findMany({
    where: { active: true, status: 'active', OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }] },
    select: { email: true },
  });
  return admins.map(a => a.email);
}

const won = (n: number | null | undefined) => (n == null ? '—' : '₩' + Math.round(n).toLocaleString('ko-KR'));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * 전자서명이 완료됐다 = **제작 배정을 기다리는 건이 생겼다.**
 * 관리자가 목록을 새로고침하다 발견하는 대신 먼저 알린다.
 */
export async function notifyContractSigned(quoteId: number): Promise<void> {
  try {
    if (!prisma) return;
    const tx = transport();
    if (!tx) { console.warn('[notify] MAIL_SMTP_* 미설정 — 배정 요청 알림 건너뜀'); return; }

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true, quote_no: true, model_code: true, final_price: true, sales_user_id: true,
        customer: { select: { name: true } },
      },
    });
    if (!quote) return;

    const to = await adminRecipients();
    if (to.length === 0) { console.warn('[notify] 받는 관리자 계정이 없어 배정 요청 알림 건너뜀'); return; }

    const no = quote.quote_no ?? `#${quote.id}`;
    const link = `${BASE_URL}/`;
    const rows: [string, string][] = [
      ['견적번호', no],
      ['고객', quote.customer?.name ?? '—'],
      ['차종', quote.model_code],
      ['실구매가', won(quote.final_price)],
      ['담당 영업', quote.sales_user_id ?? '—'],
    ];

    await tx.sendMail({
      from: `"${process.env['MAIL_FROM_NAME'] || 'EV&Solution'}" <${process.env['MAIL_SMTP_USER']}>`,
      to: to.join(','),
      subject: `[buildup-ev] 제작 배정 요청 — ${no} ${quote.customer?.name ?? ''}`.trim(),
      text: [
        `전자서명이 완료되어 제작 배정을 기다리고 있습니다.`,
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
        '',
        `관리자 > 견적 목록에서 「제작 배정」을 눌러 특장사를 지정해 주세요.`,
        link,
      ].join('\n'),
      html: `
        <div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#333;font-size:14px;line-height:1.7">
          <p style="margin:0 0 16px"><b style="color:#1A1A1A">전자서명이 완료되어 제작 배정을 기다리고 있습니다.</b></p>
          <table style="border-collapse:collapse;font-size:13px">
            ${rows.map(([k, v]) => `
              <tr>
                <td style="padding:5px 16px 5px 0;color:#8A8F98;white-space:nowrap">${esc(k)}</td>
                <td style="padding:5px 0;color:#1A1A1A">${esc(v)}</td>
              </tr>`).join('')}
          </table>
          <p style="margin:20px 0 0">관리자 &gt; 견적 목록에서 「제작 배정」을 눌러 특장사를 지정해 주세요.</p>
          <p style="margin:8px 0 0"><a href="${link}" style="color:#6F7A00">${esc(link)}</a></p>
        </div>`,
    });
    console.info(`[notify] 배정 요청 알림 발송 — 견적 ${no} → ${to.length}명`);
  } catch (e) {
    // 알림 실패로 서명 완료 처리를 막지 않는다
    console.error('[notify] 배정 요청 알림 실패', e);
  }
}
