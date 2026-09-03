/**
 * 서비스워커 — 웹 푸시를 받아 알림으로 띄운다.
 *
 * ⚠️ **캐시는 하지 않는다.** 이 앱은 늘 최신 금액·상태를 보여야 하고, 서비스워커가
 *    옛 화면을 들고 있으면 배포해도 안 바뀌는 일이 생긴다. 여기서는 푸시만 다룬다.
 *
 * ⚠️ 파일 이름을 바꾸지 말 것 — 등록 주소가 바뀌면 기존 구독이 전부 무효가 된다.
 */

self.addEventListener('install', () => {
  // 새 워커를 바로 쓴다 — 알림 문구를 고쳤는데 다음 방문까지 안 바뀌면 곤란하다
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { /* 형식이 깨져도 알림은 띄운다 */ }
  const title = d.title || 'Buildup-EV';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 단계의 알림은 덮어쓴다 — 대화 한 번에 알림이 쌓이지 않게
      tag: d.tag || 'buildup-ev',
      renotify: true,
      data: { url: d.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // 이미 열려 있는 창이 있으면 그것을 쓴다 — 누를 때마다 창이 늘어나면 안 된다
    for (const c of all) {
      if ('focus' in c) { await c.focus(); if ('navigate' in c) await c.navigate(url).catch(() => {}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
