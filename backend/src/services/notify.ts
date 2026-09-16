/**
 * 내부 알림 — **사람이 기다리고 있는 것만** 즉시 보낸다.
 *
 * 단계가 늘어날수록 건건이 보내면 하루에 열 통이 되고, 열 통이 되는 순간 아무도 안 본다.
 * 나머지는 매일 아침 한 통으로 묶는다(4단계 예정 — docs/process-redesign.md §6).
 * 지금 즉시 보내는 것은 하나뿐이다: **배정을 기다리는 건이 생겼다.**
 *
 * ⚠️ 알림 실패가 본 작업을 막지 않는다. 계약이 성사됐는데 메일이 안 나갔다고
 *    상태 전이가 롤백되면 더 큰 사고다 — 여기서는 삼키고 로그만 남긴다.
 */
import { createTransport } from 'nodemailer';
import { mergePermissions } from '../lib/permissions.js';
import { prisma } from '../lib/prisma.js';
import { notify as pushNotify } from './push.js';
import { topicRecipients } from './notify-targets.js';

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
/**
 * ⚠️ 옛 「제작 배정 알림 메일」 기능모듈(`notify.assign`)로 받는 사람을 고르던 코드는 걷어냈다(2026-09-16).
 *    그 모듈은 **역할을 보지 않아** 특장사·영업 계정에 켜 두면 고객 이름·실구매가가 담긴 메일이 갔다.
 *    이제 받는 사람은 역할 프리셋이 정한다 — `services/notify-targets.ts` · `shared/rbac/presets.ts`.
 */

const won = (n: number | null | undefined) => (n == null ? '—' : '₩' + Math.round(n).toLocaleString('ko-KR'));
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/**
 * 배정을 기다리는 일의 **종류**.
 *
 *  · `maker` — 계약이 끝났고 만들 특장사를 정해야 한다
 *  · `sales` — 공개 창구로 문의가 들어왔고 담당 영업을 정해야 한다
 *
 * 둘 다 「누가 받을지 정해 주기 전까지 아무도 손대지 않는 상태」다. 화면에서 같은 표시를
 * 주고 있으므로(`needsAssign`) 알림도 한 벌로 묶는다.
 */
export type AssignKind = 'maker' | 'sales';

const ASSIGN_TEXT: Record<AssignKind, { what: string; why: string; todo: string }> = {
  maker: {
    what: '제작 배정',
    why: '계약이 완료되어 제작 배정을 기다리고 있습니다.',
    todo: '관리자 > 견적 목록에서 「제작 배정」을 눌러 특장사를 지정해 주세요.',
  },
  sales: {
    what: '영업 배정',
    why: '공개 창구로 문의가 접수되어 담당 영업 배정을 기다리고 있습니다.',
    todo: '관리자 > 견적 목록에서 「영업 배정」을 눌러 담당자를 지정해 주세요.',
  },
};

/**
 * 알림을 눌렀을 때 여는 곳 — **관리자 견적 목록.**
 *
 * 배정 버튼이 거기 있다. 첫 화면(`/`)으로 보내면 마스터처럼 역할이 여럿인 계정은
 * 영업 화면으로 떨어져 다시 찾아 들어가야 한다.
 */
const ASSIGN_LINK = '/admin';
/**
 * 제작 배정은 **주문 진행 탭의 배정 대기**로 연다 — 배정부터 조회·관리까지 한 탭에서(2026-09-14).
 * 영업 배정(공개 문의)은 견적 목록에서 한다.
 */
const ASSIGN_LINKS: Record<AssignKind, string> = { maker: '/admin?view=assign', sales: ASSIGN_LINK };

/**
 * **배정을 기다리는 건이 생겼다**고 알린다 — 메일과 앱 알림을 함께 보낸다.
 *
 * ⚠️ 이 함수를 부르는 곳을 늘리지 말 것. 제작 배정은 `setQuoteStatus` 가 계약완료로
 *    바뀌는 **모든** 경로에서 대신 부른다. 예전에는 전자서명 경로에만 매달려 있어서
 *    서면계약 스캔본을 올린 건은 알림이 나가지 않았다(실제 제보 — 화이트축산 건).
 */
export async function notifyAssignNeeded(kind: AssignKind, quoteId: number): Promise<void> {
  try {
    if (!prisma) return;
    const t = ASSIGN_TEXT[kind];

    const quote = await prisma.quote.findUnique({
      where: { id: quoteId },
      select: {
        id: true, quote_no: true, model_code: true, final_price: true, sales_user_id: true,
        customer: { select: { name: true } },
      },
    });
    if (!quote) return;

    const no = quote.quote_no ?? `#${quote.id}`;
    const who = quote.customer?.name ?? '';

    /*
     * 앱 알림(알림함·푸시)을 **먼저, 메일과 따로** 보낸다 — 받는 사람은 활성 관리자 전원.
     * 기능모듈 「제작 배정 알림 메일」은 **메일만** 정한다(지시 2026-09-14). 그래서 메일 받을 사람이
     * 아무도 없어도 앱 알림은 나간다. 메일은 SMTP 왕복이 있어 몇 초 걸리고, 설정이 빠지면 안 나간다.
     * 태그를 견적별로 두어 같은 건이 여러 번 쌓이지 않게 한다.
     */
    // 받는 사람은 **자리(프리셋)** 가 정한다 — 제작 배정은 영업관리·PM·생산관리·마스터(2026-09-16)
    void topicRecipients(kind === 'maker' ? 'assign.maker' : 'assign.sales').then(appTo => {
      pushNotify(appTo, {
        title: `${t.what} 필요 — ${no}`,
        body: [who, t.why].filter(Boolean).join(' · '),
        url: ASSIGN_LINKS[kind],
        tag: `assign-${kind}-${quote.id}`,
      });
    }).catch(e => console.warn('[notify] 배정 앱 알림 실패', e));

    /*
     * 메일도 **같은 자리(프리셋)** 로 보낸다(2026-09-16).
     * 예전에는 기능모듈 하나로 골랐고 그 모듈은 역할을 보지 않아, 특장사·영업 계정에 켜 두면
     * 고객 이름·실구매가가 담긴 메일이 그대로 갔다. 비상 우회(NOTIFY_ADMIN_TO)는 남긴다.
     */
    const override = process.env['NOTIFY_ADMIN_TO'];
    const to = override
      ? override.split(',').map(x => x.trim()).filter(Boolean)
      : await topicRecipients(kind === 'maker' ? 'assign.maker' : 'assign.sales');
    if (to.length === 0) {
      // 조용히 사라지면 배정을 기다리는 건이 방치된다 — 왜 안 갔는지 로그에 남긴다
      console.warn(`[notify] ${t.what} 알림을 받을 자리가 없다 — 견적 ${quoteId} 메일 건너뜀(앱 알림은 발송)`);
      return;
    }

    const tx = transport();
    if (!tx) { console.warn(`[notify] MAIL_SMTP_* 미설정 — ${t.what} 알림 메일 건너뜀(앱 알림은 발송)`); return; }

    const link = `${BASE_URL}${ASSIGN_LINKS[kind]}`;
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
      subject: `[buildup-ev] ${t.what} 요청 — ${no} ${who}`.trim(),
      text: [
        t.why,
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
        '',
        t.todo,
        link,
      ].join('\n'),
      html: `
        <div style="font-family:-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#333;font-size:14px;line-height:1.7">
          <p style="margin:0 0 16px"><b style="color:#1A1A1A">${esc(t.why)}</b></p>
          <table style="border-collapse:collapse;font-size:13px">
            ${rows.map(([k, v]) => `
              <tr>
                <td style="padding:5px 16px 5px 0;color:#8A8F98;white-space:nowrap">${esc(k)}</td>
                <td style="padding:5px 0;color:#1A1A1A">${esc(v)}</td>
              </tr>`).join('')}
          </table>
          <p style="margin:20px 0 0">${esc(t.todo)}</p>
          <p style="margin:8px 0 0"><a href="${link}" style="color:#6F7A00">${esc(link)}</a></p>
        </div>`,
    });
    console.info(`[notify] ${t.what} 알림 발송 — 견적 ${no} → ${to.length}명`);
  } catch (e) {
    // 알림 실패로 상태 전이를 막지 않는다
    console.error('[notify] 배정 알림 실패', e);
  }
}
