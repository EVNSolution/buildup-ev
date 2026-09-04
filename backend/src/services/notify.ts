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
import { notify as pushNotify, pushAllowed } from './push.js';

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
/** 제작 배정 알림을 받겠다고 켜 둔 계정 — 기능모듈 `notify.assign` 로 고른다. */
export const ASSIGN_NOTIFY_MODULE = 'notify.assign';

/**
 * 알림을 **받을 사람**을 고른다.
 *
 * 예전에는 **활성 관리자 전원**에게 보냈다. 관리자 권한만 있으면 배정 업무와 무관한
 * 사람에게도 계속 갔고, 끌 방법이 없었다.
 *
 * 이제 다른 기능과 똑같이 **계정별 토글**로 고른다(관리자 화면 › 계정 관리).
 * 판정은 화면·API 와 같은 `mergePermissions` 를 쓴다 — 역할 기본값을 계정별 설정이 덮는다.
 *
 * ⚠️ **기본은 아무도 안 받는 것이다.** 아무도 켜 두지 않으면 메일이 나가지 않는다.
 *    조용히 사라지면 서명이 끝난 건이 방치되므로, 그때는 로그로 분명히 남긴다.
 */
/**
 * 이 계정이 배정 알림을 받는가 — **판정은 여기 한 곳.**
 *
 * DB 를 타지 않는 순수 함수로 떼어 두어, 「누가 받는가」를 실제로 시험할 수 있게 한다.
 * 규칙이 조건문 안에 묻혀 있으면 눈으로 읽어 맞다고 믿는 수밖에 없다.
 */
export function isAssignRecipient(
  user: { email: string; role: string; extra_roles: string[]; is_master?: boolean },
  acs: { subject_type: string; subject_ref: string; module_code: string; enabled: boolean }[],
): boolean {
  /*
   * **마스터는 토글과 무관하게 늘 받는다.**
   *
   * 실제로 스캔본을 올렸는데 아무에게도 메일이 가지 않은 일이 있었다. 원인은 둘이었고
   * (경로 누락 + 아무도 토글을 켜 두지 않음), 두 번째는 **아무 신호 없이** 조용히
   * 사라진다 — 서버 로그를 열어 보기 전에는 알 방법이 없다.
   * 최소 한 사람은 반드시 받게 두어, 「아무에게도 안 갔다」가 다시는 없게 한다.
   */
  if (user.is_master) return true;
  return mergePermissions(
    [user.role, ...user.extra_roles] as Parameters<typeof mergePermissions>[0],
    user.email, acs,
  ).includes(ASSIGN_NOTIFY_MODULE);
}

export async function adminRecipients(): Promise<string[]> {
  // 비상 우회 — 설정이 꼬였을 때 서버 env 로 강제 지정한다
  const override = process.env['NOTIFY_ADMIN_TO'];
  if (override) return override.split(',').map(s => s.trim()).filter(Boolean);
  if (!prisma) return [];

  const [users, acs] = await Promise.all([
    prisma.user.findMany({
      where: { active: true, status: 'active' },
      select: { email: true, role: true, extra_roles: true, is_master: true },
    }),
    prisma.accessControl.findMany({
      where: { module_code: ASSIGN_NOTIFY_MODULE },
      select: { subject_type: true, subject_ref: true, module_code: true, enabled: true },
    }),
  ]);

  return users
    .filter(u => isAssignRecipient(u, acs))
    .map(u => u.email);
}

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

    const to = await adminRecipients();
    if (to.length === 0) {
      // 조용히 사라지면 배정을 기다리는 건이 방치된다 — 왜 안 갔는지 로그에 남긴다
      console.warn(
        `[notify] ${t.what} 알림을 받도록 켜 둔 계정이 없다 — 견적 ${quoteId} 알림 건너뜀. ` +
        `관리자 › 계정 관리에서 「제작 배정 알림 메일」(${ASSIGN_NOTIFY_MODULE})을 켜야 나간다.`,
      );
      return;
    }

    const no = quote.quote_no ?? `#${quote.id}`;
    const who = quote.customer?.name ?? '';

    /*
     * 앱 알림을 **먼저** 띄운다. 메일은 SMTP 왕복이 있어 몇 초 걸리고, 메일 설정이
     * 빠져 있으면 아예 안 나간다 — 그때도 앱 알림은 가야 한다.
     * 태그를 견적별로 두어 같은 건이 여러 번 쌓이지 않게 한다.
     */
    void pushAllowed(to).then(pushTo => {
      pushNotify(pushTo, {
        title: `${t.what} 필요 — ${no}`,
        body: [who, t.why].filter(Boolean).join(' · '),
        url: ASSIGN_LINK,
        tag: `assign-${kind}-${quote.id}`,
      });
    }).catch(e => console.warn('[notify] 배정 앱 알림 실패', e));

    const tx = transport();
    if (!tx) { console.warn(`[notify] MAIL_SMTP_* 미설정 — ${t.what} 알림 메일 건너뜀(앱 알림은 발송)`); return; }

    const link = `${BASE_URL}${ASSIGN_LINK}`;
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
