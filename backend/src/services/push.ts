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
import { mergePermissions } from '../lib/permissions.js';

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

/** 앱 알림을 받겠다고 켜 둔 계정만 남긴다 — 기능모듈 `notify.push` */
export const PUSH_MODULE = 'notify.push';

/**
 * 후보 중에서 **앱 알림을 받을 수 있는 계정**만 거른다.
 *
 * 판정은 화면·API 와 같은 `mergePermissions` 를 쓴다 — 역할 기본값을 계정별 설정이 덮는다.
 * 실제로 알림이 가려면 본인이 기기에서 구독까지 해야 한다(두 조건이 모두 필요).
 */
export async function pushAllowed(emails: string[]): Promise<string[]> {
  if (!prisma || emails.length === 0) return [];
  const [users, acs] = await Promise.all([
    prisma.user.findMany({
      where: { email: { in: emails }, active: true, status: 'active' },
      select: { email: true, role: true, extra_roles: true },
    }),
    prisma.accessControl.findMany({
      where: { module_code: PUSH_MODULE },
      select: { subject_type: true, subject_ref: true, module_code: true, enabled: true },
    }),
  ]);
  return users
    .filter(u => mergePermissions([u.role, ...u.extra_roles], u.email, acs).includes(PUSH_MODULE))
    .map(u => u.email);
}

export interface PushPayload {
  title: string;
  body: string;
  /** 눌렀을 때 열 주소 */
  url: string;
  /** 같은 태그끼리는 덮어쓴다 — 한 단계에서 여러 개가 쌓이지 않게 */
  tag?: string;
}

/**
 * 사람들에게 보낸다. **기다리지 않는다.**
 *
 * 구독이 만료되면 푸시 서버가 404·410 을 준다 — 그때는 그 구독을 지운다.
 * 지우지 않으면 매번 실패하며 로그만 쌓인다.
 */
export function notify(emails: string[], payload: PushPayload): void {
  if (!pushEnabled() || !prisma || emails.length === 0) return;
  void (async () => {
    try {
      const subs = await prisma!.pushSubscription.findMany({
        where: { user_email: { in: emails } },
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
