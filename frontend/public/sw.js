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
  event.waitUntil(Promise.all([
    // 열려 있는 화면에 알린다 — 헤더 종 아이콘의 빨간 점을 기다리지 않고 바로 켠다
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((cs) => cs.forEach((c) => c.postMessage({ type: 'notification' }))),
    self.registration.showNotification(title, {
      body: d.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // 같은 단계의 알림은 덮어쓴다 — 대화 한 번에 알림이 쌓이지 않게
      tag: d.tag || 'buildup-ev',
      renotify: true,
      data: { url: d.url || '/' },
    }),
  ]));
});

/**
 * 알림을 누르면 그 자리로 간다.
 *
 * ⚠️ **열려 있는 창에는 「여기로 가라」고 말한다**(2026-09-16 제보 — 설치한 앱에서 알림을 눌러도 아무 일도 없었다).
 *    `client.navigate()` 는 설치한 앱(독립 실행)에서 조용히 실패하는 일이 잦다. 화면이 스스로 옮기면(라우터)
 *    실패하지 않고, 보던 상태도 그대로 남는다. 말이 닿지 않을 때만 예전 방식으로 창을 옮기거나 새로 연다.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = all.find((c) => 'focus' in c);
    if (open) {
      try { await open.focus(); } catch { /* 초점은 못 줘도 이동은 해 본다 */ }
      try { open.postMessage({ type: 'navigate', url }); return; } catch { /* 말이 안 닿는다 — 아래로 */ }
      if ('navigate' in open) { await open.navigate(url).catch(() => {}); return; }
    }
    await self.clients.openWindow(url);
  })());
});
