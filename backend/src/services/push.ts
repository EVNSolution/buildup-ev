/**
 * 웹 푸시 — **없으면 조용히 꺼진다.**
 *
 * VAPID 키 한 쌍(`VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY`)이 환경변수에 있어야 보낼 수 있다.
 * 키는 구글·애플의 푸시 서버에게 「이 서버가 보낸 것이 맞다」를 증명하는 인감이다.
 *
 * ⚠️ 키가 없어도 **앱은 정상 동작해야 한다.** 댓글·읽음 표시는 푸시와 무관하고,
 *    키를 못 넣은 상태에서 배포했다고 주문 화면이 죽으면 안 된다.
 *    그래서 여기서는 「보낼 수 있으면 보내고, 아니면 아무 일도 안 한다」로 둔다.
 *
 * ⚠️ 보내기는 **절대 기다리지 않는다**(fire-and-forget). 푸시 서버가 느리다고
 *    댓글 작성이 느려지면 안 된다 — 계약서 동기화에서 같은 실수를 했다(#…).
 */
import webpush from 'web-push';
import { prisma } from '../lib/prisma.js';

const PUBLIC = process.env['VAPID_PUBLIC_KEY']?.trim() ?? '';
const PRIVATE = process.env['VAPID_PRIVATE_KEY']?.trim() ?? '';
/** 푸시 서버가 문제 생겼을 때 연락할 곳 — 규격상 mailto: 가 필요하다 */
const CONTACT = process.env['VAPID_CONTACT']?.trim() || 'mailto:info@evnsolution.com';

/** 키가 갖춰졌는가 — 화면에도 알려 준다(구독 버튼을 띄울지 판단) */
export const pushEnabled = (): boolean => PUBLIC !== '' && PRIVATE !== '';

if (pushEnabled()) {
  webpush.setVapidDetails(CONTACT, PUBLIC, PRIVATE);
} else {
  console.warn('[push] VAPID 키가 없어 푸시 알림이 꺼져 있습니다 (댓글 기능은 정상 동작)');
}

/** 화면이 구독할 때 필요한 공개키. 비밀키는 **절대** 내보내지 않는다 */
export const publicKey = (): string => PUBLIC;

/**
 * **앱 알림(알림함·휴대폰 푸시)을 받을 계정** — 활성 계정만 남긴다.
 *
 * ⚠️ 기능모듈로 거르지 않는다(지시 2026-09-14). 기능모듈 토글은 **메일을 보낼지**만 정한다
 *    (`notify.assign`). 예전에는 「앱 알림」 모듈(`notify.push`)이 꺼진 계정에는 알림이 아예
 *    안 갔는데, 무엇을 받을지는 계정 설정이 아니라 **기기에서 알림을 허용했는지**로 정한다 —
 *    알림함에는 늘 쌓이고, 푸시는 그 기기가 허용했을 때만 뜬다(헤더 종 아이콘에서 허용).
 */
export async function appRecipients(emails: string[]): Promise<string[]> {
  if (!prisma || emails.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { email: { in: [...new Set(emails)] }, active: true, status: 'active' },
    select: { email: true },
  });
  return users.map(u => u.email);
}

/** 활성 관리자 — 겸직 관리자·마스터 포함. 관리자에게 가는 앱 알림의 받는 사람 */
export async function activeAdmins(): Promise<string[]> {
  if (!prisma) return [];
  const users = await prisma.user.findMany({
    where: { active: true, status: 'active', OR: [{ role: 'ADMIN' }, { extra_roles: { has: 'ADMIN' } }, { is_master: true }] },
    select: { email: true },
  });
  return users.map(u => u.email);
}

export interface PushPayload {
  title: string;
  body: string;
  /** 눌렀을 때 열 주소 */
  url: string;
  /** 같은 태그끼리는 덮어쓴다 — 한 단계에서 여러 개가 쌓이지 않게 */
  tag?: string;
}

/** DB 칸 길이에 맞춰 자른다 — 긴 대화 한 줄 때문에 기록이 통째로 실패하면 안 된다 */
const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);

/**
 * 사람들에게 보낸다. **기다리지 않는다.**
 *
 * 1) **알림함에 먼저 남긴다** — 푸시 키가 없거나 기기가 구독하지 않았어도 헤더의 종 아이콘에서
 *    볼 수 있어야 한다. 받는 사람은 부르는 쪽이 고른다(`appRecipients`·`activeAdmins` — 활성 계정).
 *    기능모듈로 거르지 않는다 — 기능모듈은 메일 여부만 정한다(지시 2026-09-14).
 * 2) 그다음 푸시. 구독이 만료되면 푸시 서버가 404·410 을 준다 — 그때는 그 구독을 지운다.
 *    지우지 않으면 매번 실패하며 로그만 쌓인다.
 */
export function notify(emails: string[], payload: PushPayload): void {
  if (!prisma || emails.length === 0) return;
  const to = [...new Set(emails)];
  void (async () => {
    try {
      await prisma!.notification.createMany({
        data: to.map(user_email => ({
          user_email,
          title: clip(payload.title, 200),
          body: clip(payload.body, 1000),
          url: clip(payload.url, 500),
          tag: payload.tag ? clip(payload.tag, 100) : null,
        })),
      });
    } catch (e) {
      // 알림함 기록이 실패해도 푸시는 보낸다 — 둘 중 하나라도 닿는 게 낫다
      console.error('[notify] 알림함 기록 실패', e);
    }
    if (!pushEnabled()) return;
    try {
      const subs = await prisma!.pushSubscription.findMany({
        where: { user_email: { in: to } },
      });
      const data = JSON.stringify(payload);
      await Promise.all(subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            data,
          );
          await prisma!.pushSubscription.update({
            where: { id: s.id }, data: { last_ok_at: new Date() },
          });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            // 기기에서 지웠거나 만료됐다 — 남겨 두면 계속 실패한다
            await prisma!.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          } else {
            console.warn('[push] 보내기 실패', code ?? e);
          }
        }
      }));
    } catch (e) {
      console.error('[push] 대상 조회 실패', e);
    }
  })();
}
