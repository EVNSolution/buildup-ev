/**
 * 웹 푸시 켜기/끄기 — **못 하는 환경이 많다는 전제로 짠다.**
 *
 *   · 아이폰은 **홈 화면에 설치한 뒤에만** 된다(iOS 16.4+). 사파리로 열어 두면 안 온다.
 *   · 브라우저 권한을 한 번 거부하면 코드로는 되돌릴 수 없다 — 설정에서 직접 풀어야 한다.
 *   · 서버에 VAPID 키가 없으면 아예 꺼져 있다.
 *
 * 그래서 「왜 안 되는지」를 문구로 돌려준다. 조용히 실패하면 사용자는 버튼만 계속 누른다.
 */

export type PushState =
  | { kind: 'unsupported'; why: string }
  | { kind: 'off' }          // 켤 수 있다
  | { kind: 'on' }           // 이미 켜져 있다
  | { kind: 'denied'; why: string }

/** 홈 화면에 설치된 상태로 실행 중인가 — 아이폰은 이때만 푸시가 된다 */
export function isInstalled(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as { standalone?: boolean }).standalone === true
}

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return {
      kind: 'unsupported',
      why: isIOS() && !isInstalled()
        ? '아이폰은 홈 화면에 설치한 뒤에만 알림을 받을 수 있습니다'
        : '이 브라우저는 알림을 지원하지 않습니다',
    }
  }
  if (Notification.permission === 'denied') {
    return { kind: 'denied', why: '브라우저에서 알림이 차단돼 있습니다. 사이트 설정에서 허용으로 바꿔 주세요' }
  }
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? { kind: 'on' } : { kind: 'off' }
}

/** 서버가 준 공개키(base64url) → 브라우저가 요구하는 바이트 배열 */
function toBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const b64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function enablePush(publicKey: string): Promise<void> {
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('알림 권한이 필요합니다')

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,     // 규격상 필수 — 안 보이는 알림은 금지
    applicationServerKey: toBytes(publicKey),
  })
  const res = await fetch('/api/v1/push/subscribe', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
  if (!res.ok) throw new Error('알림 등록에 실패했습니다')
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await fetch('/api/v1/push/unsubscribe', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => { /* 서버에 못 알려도 기기에서는 끈다 */ })
  await sub.unsubscribe()
}

export async function pushConfig(): Promise<{ enabled: boolean; publicKey: string }> {
  const res = await fetch('/api/v1/push/config', { credentials: 'include' })
  if (!res.ok) return { enabled: false, publicKey: '' }
  const b = await res.json() as { data: { enabled: boolean; publicKey: string } }
  return b.data
}
